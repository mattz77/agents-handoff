#!/usr/bin/env node
// One-shot: limpa duplicatas acumuladas no workspace AnythingLLM (TASK 38 — Frente B).
// Causa raiz corrigida em anythingllm-ingest.js (upsert); este script só limpa o que já existe.
// Agrupa documentos do workspace por título, mantém só o mais recente (ingestedAt), remove o resto.
//
// Uso: node scripts/anythingllm-dedupe.js [--dry-run]
const BASE = process.env.ANYTHINGLLM_BASE_URL;
const KEY = process.env.ANYTHINGLLM_API_KEY;
const WORKSPACE = process.env.ANYTHINGLLM_WORKSPACE || "llm-brain";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!BASE || !KEY) {
    console.error("Faltam ANYTHINGLLM_BASE_URL / ANYTHINGLLM_API_KEY no ambiente.");
    process.exit(1);
  }

  const res = await fetch(`${BASE}/api/v1/workspace/${WORKSPACE}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`GET workspace HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const docs = data?.workspace?.[0]?.documents || data?.documents || [];

  console.log(`[dedupe] ${docs.length} documentos no workspace "${WORKSPACE}".`);

  const byTitle = new Map();
  for (const d of docs) {
    const title = d.title || d.metadata?.title || d.name;
    const list = byTitle.get(title) || [];
    list.push(d);
    byTitle.set(title, list);
  }

  const toRemove = [];
  for (const [title, list] of byTitle) {
    if (list.length <= 1) continue;
    list.sort((a, b) => new Date(b.metadata?.ingestedAt || 0) - new Date(a.metadata?.ingestedAt || 0));
    const [keep, ...dupes] = list;
    console.log(`[dedupe] "${title}": ${list.length} cópias, mantendo a mais recente, removendo ${dupes.length}`);
    toRemove.push(...dupes.map((d) => d.location || d.name));
  }

  if (!toRemove.length) {
    console.log("[dedupe] nenhuma duplicata encontrada.");
    return;
  }

  if (DRY_RUN) {
    console.log(`[dedupe] --dry-run: removeria ${toRemove.length} documentos:\n${toRemove.join("\n")}`);
    return;
  }

  const embRes = await fetch(`${BASE}/api/v1/workspace/${WORKSPACE}/update-embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ deletes: toRemove }),
  });
  if (!embRes.ok) throw new Error(`update-embeddings HTTP ${embRes.status}: ${await embRes.text()}`);

  const rmRes = await fetch(`${BASE}/api/v1/system/remove-documents`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ names: toRemove }),
  });
  if (!rmRes.ok) console.warn(`[dedupe] falha ao remover docs (HTTP ${rmRes.status})`);

  console.log(`[dedupe] ${toRemove.length} duplicatas removidas.`);
}

main().catch((e) => {
  console.error("[dedupe] falhou:", e.message);
  process.exit(1);
});
