#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Redis = require("ioredis");

// Script roda solto no host (fora do container) — carrega .env manualmente, sem sobrescrever env já setado.
function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
loadEnvFile();

const arg = (k) => {
  const match = process.argv.find((a) => a.startsWith(`--${k}=`));
  return match ? match.split("=")[1] : "";
};

const project = arg("project") || "LLM-Brain";
const status = arg("status") || "AWAITING_HANDOFF_DEV";
const sender = arg("sender") || "Antigravity";
const receiver = arg("receiver") || "Claude";
const action = arg("action") || "Continuar desenvolvimento";

const env = {
  task_id: crypto.randomUUID(),
  idempotency_key: crypto.randomUUID(), // Para bypass dedupe neste nível, ou usar um hash real se preferir
  schema_version: "7.0",
  timestamp: new Date().toISOString(),
  correlation_id: crypto.randomUUID(),
  project: project,
  current_branch: "main",
  lifecycle_status: status,
  attempt: 1,
  payload: {
    macro_goal: "Handoff Voluntário",
    completed_milestones: [],
    pending_action_item: action,
    git_context: {
      commit_sha: "HEAD",
      diff_uri: "",
      untracked_files: []
    },
    environment_state: {}
  },
  signatures: {
    sender: sender,
    receiver: receiver
  }
};

const { spawnSync } = require("node:child_process");

// Valida `project` contra o registry (tabela `projects`) antes de publicar — evita slug
// divergente (typo, casing, "commitBriefing" vs "commit-briefing") poluindo o handoff/RAG.
async function validateProject(slug) {
  if (!process.env.DATABASE_URL) {
    console.warn("[handoff] DATABASE_URL indisponível — pulando validação de projeto no registry.");
    return true;
  }
  const { Pool } = require("pg");
  const isSupabase = process.env.DATABASE_URL.includes("supabase.com");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 8000,
    ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  try {
    const { rows } = await pool.query("select slug from handoff_projects where slug = $1", [slug]);
    if (rows.length) return true;
    const all = await pool.query("select slug from handoff_projects order by slug");
    console.error(`[handoff] Projeto "${slug}" não existe no registry (tabela handoff_projects).`);
    console.error(`[handoff] Slugs válidos: ${all.rows.map((r) => r.slug).join(", ") || "(nenhum cadastrado ainda)"}`);
    return false;
  } catch (e) {
    console.warn(`[handoff] Falha ao validar projeto no registry (${e.message}) — seguindo sem bloquear.`);
    return true;
  } finally {
    await pool.end();
  }
}

(async () => {
  try {
    const known = await validateProject(project);
    if (!known) {
      process.exitCode = 1;
      return;
    }

    let redisPass = "";
    try {
      redisPass = fs.readFileSync("c:/Users/olive/Documents/handoff-daemon/secrets/redis_secret.txt", "utf8").trim();
    } catch (e) {}

    const payload = JSON.stringify(env);
    
    const args = ["exec", "-i", "handoff-redis-master", "redis-cli"];
    if (redisPass) {
      args.push("-a", redisPass);
    }
    args.push("XADD", "handoff:stream", "MAXLEN", "~", "100000", "*", "data", payload);

    const result = spawnSync("docker", args, { stdio: "inherit" });
    
    if (result.status === 0) {
      console.log(`[handoff] evento publicado com sucesso em handoff:stream via docker exec!`);
    } else {
      console.error("Falha ao publicar evento no Redis via Docker. Status:", result.status);
    }
  } catch (error) {
    console.error("Falha ao publicar evento no Redis via Docker:", error.message);
  }
})();
