#!/usr/bin/env node
// Ingestão do LLM-Brain no AnythingLLM (RAG) com REDAÇÃO de segredos + UPSERT real.
// CRÍTICO (§5b do plano V4): nunca embebir segredos — eles vazariam via query do RAG.
//   - Blacklist de arquivos: *-secrets.md, .env, qualquer coisa em n8n-scripts/
//   - Redação inline de padrões de segredo
// UPSERT (TASK 38 — Frente B): sem isso, cada save do active-context.md cria doc novo
// e nunca remove o antigo — workspace acumula dezenas de cópias da mesma versão.
// Usa scripts/.anythingllm-state.json (arquivo -> {location, sha256}) pra:
//   - hash igual → skip (não re-sobe o que não mudou)
//   - hash diferente → deleta a versão antiga no workspace antes de subir a nova
//
// Uso: node scripts/anythingllm-ingest.js
// Env: ANYTHINGLLM_BASE_URL, ANYTHINGLLM_API_KEY, ANYTHINGLLM_WORKSPACE (slug, default "llm-brain")
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const BASE = process.env.ANYTHINGLLM_BASE_URL;
const KEY = process.env.ANYTHINGLLM_API_KEY;
const WORKSPACE = process.env.ANYTHINGLLM_WORKSPACE || "llm-brain";
const BRAIN = "G:/Meu Drive/LLM-Brain";
const STATE_PATH = path.join(__dirname, ".anythingllm-state.json");

// Arquivos que NUNCA podem ser ingeridos (contêm segredos por natureza).
const FILE_BLACKLIST = [
  /-secrets?\.md$/i,
  /(^|[\\/])\.env(\.|$)/i,
  /[\\/]n8n-scripts[\\/]/i,
];

// Padrões de segredo redigidos inline antes de embebir.
const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]+/g,
  /nvapi-[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /AKIA[0-9A-Z]+/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /postgres(?:ql)?:\/\/[^\s'"]+/gi,
  /redis:\/\/[^\s'"]+/gi,
  /[A-Za-z0-9!@#$%^&*]{6,}@[0-9]{6}\b/g,
  /(api[_-]?key|apikey|password|senha|secret|token)["'\s:=]+[A-Za-z0-9._\-@!#$%^&*]{8,}/gi,
];

// Mapeia diretório de origem -> slug de projeto, pra taguear a metadata do documento.
// Ajustar conforme novas pastas do DataLake/Brain entrarem na ingestão.
const PROJECT_DIR_MAP = [
  [/xone/i, "xone"],
  [/commit-?briefing/i, "commit-briefing"],
  [/luma/i, "luma-app"],
  [/cordena-?ai/i, "cordena-ai"],
  [/handoff-daemon/i, "handoff-daemon"],
];

function redact(text) {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

function isBlacklisted(p) {
  return FILE_BLACKLIST.some((re) => re.test(p));
}

function inferProject(relPath) {
  for (const [re, slug] of PROJECT_DIR_MAP) if (re.test(relPath)) return slug;
  return "llm-brain";
}

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) { walk(full, acc); continue; }
    if (!/\.md$/i.test(name)) continue;
    if (isBlacklisted(full)) { console.log(`[skip blacklist] ${full}`); continue; }
    acc.push(full);
  }
  return acc;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function uploadRawText(title, content, project) {
  const res = await fetch(`${BASE}/api/v1/document/raw-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      textContent: content,
      metadata: { title, source: "llm-brain", project, ingestedAt: new Date().toISOString() },
    }),
  });
  if (!res.ok) throw new Error(`raw-text HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.documents?.[0]?.location;
}

async function removeDocuments(locations) {
  if (!locations.length) return;
  const res = await fetch(`${BASE}/api/v1/system/remove-documents`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ names: locations }),
  });
  if (!res.ok) console.warn(`[ingest] falha ao remover docs antigos (HTTP ${res.status}) — seguindo mesmo assim`);
}

async function updateEmbeddings(adds, deletes) {
  const res = await fetch(`${BASE}/api/v1/workspace/${WORKSPACE}/update-embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ adds, deletes }),
  });
  if (!res.ok) throw new Error(`update-embeddings HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  if (!BASE || !KEY) {
    console.error("Faltam ANYTHINGLLM_BASE_URL / ANYTHINGLLM_API_KEY no ambiente.");
    process.exit(1);
  }
  const state = loadState();
  const files = walk(BRAIN);
  console.log(`[ingest] ${files.length} arquivos .md elegíveis (após blacklist).`);

  const adds = [];
  const deletes = [];
  let skipped = 0;

  for (const f of files) {
    const rel = path.relative(BRAIN, f);
    const raw = fs.readFileSync(f, "utf8");
    const safe = redact(raw);
    const hash = sha256(safe);
    const prev = state[rel];

    if (prev && prev.sha256 === hash) {
      skipped++;
      continue;
    }
    if (safe.includes("[REDACTED]")) console.log(`[redacted] segredos removidos de ${path.basename(f)}`);

    try {
      const project = inferProject(rel);
      const loc = await uploadRawText(`[${project}] ${rel}`, safe, project);
      if (!loc) continue;
      if (prev?.location) deletes.push(prev.location);
      adds.push(loc);
      state[rel] = { location: loc, sha256: hash };
    } catch (e) {
      console.error(`[erro] ${f}: ${e.message}`);
    }
  }

  console.log(`[ingest] ${skipped} arquivos inalterados (skip), ${adds.length} novos/atualizados.`);

  if (adds.length || deletes.length) {
    await updateEmbeddings(adds, deletes);
    if (deletes.length) await removeDocuments(deletes);
    console.log(`[ingest] ${adds.length} documentos embebidos, ${deletes.length} versões antigas removidas.`);
    saveState(state);
  } else {
    console.log("[ingest] nada a embebir.");
  }
}

main();
