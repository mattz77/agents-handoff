#!/usr/bin/env node
// Linter Hermes — modo CLI/manual. Lê o active-context, audita via Ollama e publica
// um envelope event_kind="hermes.audit" no handoff:stream (o daemon persiste em hermes_audits).
// O gatilho automático em produção é o worker in-process (src/hermes/linter.ts) no AWAITING_*.
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const HERMES_MODEL = process.env.HERMES_MODEL || "hermes3:8b";
const TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 45000);
const REDIS_CONTAINER = process.env.REDIS_CONTAINER || "handoff-redis-master";

const SYSTEM = `Você é o Hermes 3, auditor sênior da trinca LLM-Brain.
Analise a atualização de contexto e responda SOMENTE com JSON válido neste formato exato:
{"nota": <int 0-10>, "severidade": "low"|"medium"|"high", "riscos": ["..."], "resumo": "<1 linha>"}
Sem texto fora do JSON. Português do Brasil.`;

function coerceAudit(raw) {
  try {
    const o = JSON.parse(raw);
    const sev = ["low", "medium", "high"].includes(o.severidade) ? o.severidade : "unknown";
    return {
      nota: Number.isFinite(o.nota) ? Math.max(0, Math.min(10, Math.round(o.nota))) : 0,
      severidade: sev,
      riscos: Array.isArray(o.riscos) ? o.riscos.map(String).slice(0, 12) : [],
      resumo: typeof o.resumo === "string" ? o.resumo.slice(0, 400) : "(sem resumo)",
    };
  } catch {
    return { nota: 0, severidade: "unknown", riscos: [], resumo: "Saída do Hermes malformada" };
  }
}

async function callHermes(context) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: HERMES_MODEL, system: SYSTEM,
        prompt: `CONTEXTO RECENTE:\n${context}`, format: "json", stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return coerceAudit(data.response ?? "");
  } catch (e) {
    return { nota: 0, severidade: "unknown", riscos: [], resumo: `Hermes indisponível: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

async function main() {
  const contextPath = "G:/Meu Drive/LLM-Brain/active-context.md";
  if (!fs.existsSync(contextPath)) {
    console.error("[Hermes Linter] active-context.md não encontrado.");
    process.exit(1);
  }
  const context = fs.readFileSync(contextPath, "utf8").substring(0, 3000);
  console.log(`[Hermes Linter] Auditando via ${OLLAMA_URL} (${HERMES_MODEL})...`);
  const audit = await callHermes(context);
  console.log(`[Hermes Linter] severidade=${audit.severidade} nota=${audit.nota} — ${audit.resumo}`);

  const correlationId = crypto.randomUUID();
  const envelope = {
    task_id: crypto.randomUUID(),
    // Determinístico: dedupe por (correlation + resumo).
    idempotency_key: sha256(`LLM-Brain|${correlationId}|${audit.resumo}`),
    schema_version: "7.0",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
    project: "LLM-Brain",
    current_branch: "main",
    lifecycle_status: "ACKNOWLEDGED", // status válido; roteamento real é por event_kind
    attempt: 1,
    payload: {
      macro_goal: "Auditoria Hermes 3 (CLI)",
      completed_milestones: [],
      pending_action_item: audit.resumo,
      git_context: { commit_sha: "HEAD", diff_uri: "", untracked_files: [] },
      environment_state: { active_containers: [], affected_databases: [] },
    },
    signatures: { sender: "Hermes_Linter", receiver: "Antigravity_Daemon" },
    event_kind: "hermes.audit",
    hermes_audit: audit,
  };

  let redisPass = "";
  try {
    redisPass = fs.readFileSync("c:/Users/olive/Documents/handoff-daemon/secrets/redis_secret.txt", "utf8").trim();
  } catch {}

  const args = ["exec", "-i", REDIS_CONTAINER, "redis-cli"];
  if (redisPass) args.push("-a", redisPass);
  args.push("XADD", "handoff:stream", "MAXLEN", "~", "100000", "*", "data", JSON.stringify(envelope));

  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.status === 0) {
    console.log("[Hermes Linter] Auditoria publicada em handoff:stream.");
  } else {
    console.error(`[Hermes Linter] Falha ao publicar no Redis (container=${REDIS_CONTAINER}, status=${result.status}).`);
    process.exit(1);
  }
}

main();
