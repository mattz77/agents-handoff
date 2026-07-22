#!/usr/bin/env node
// Roda SOLTO no host (fora de qualquer container) — nunca dentro do handoff-daemon.
// O daemon não pode disparar docker compose nele mesmo (sem docker.sock, e recriar o
// próprio container mataria o processo no meio do deploy). Este worker faz o trabalho
// real: poll na tabela deploy_requests, executa git+docker, escreve log de volta na
// mesma linha pra o painel /ops ler via SSE (GET /ops/api/deploy/stream).
//
// Registrar no Task Scheduler (roda continuamente, reinicia com o Windows):
//   schtasks /create /tn "handoff-deploy-worker" /tr "node C:\Users\olive\Documents\handoff-daemon\scripts\deploy-worker.js" /sc onstart /ru SYSTEM
// Ou rodar manual num terminal enquanto testa: node scripts/deploy-worker.js

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.replace(/\r$/, "").match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvFile();

const {
  claimNextPendingDeployRequest,
  appendDeployLog,
  finishDeployRequest,
} = require(path.join(REPO_ROOT, "dist", "ops", "deploy-data.js"));

const POLL_MS = 2000;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;

function runStreamed(id, cmd, args, opts) {
  return new Promise((resolve, reject) => {
    appendDeployLog(id, `$ ${cmd} ${args.join(" ")}`).catch(() => {});
    const child = spawn(cmd, args, { ...opts, shell: false });
    const onChunk = (buf) => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) appendDeployLog(id, line).catch(() => {});
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} saiu com código ${code}`));
    });
  });
}

async function runSelfHosted(row) {
  const { id, branch, action } = row;
  if (!BRANCH_RE.test(branch)) throw new Error(`branch inválida: ${branch}`);

  await runStreamed(id, "git", ["fetch", "origin"], { cwd: REPO_ROOT });
  try {
    await runStreamed(id, "git", ["checkout", branch], { cwd: REPO_ROOT });
  } catch {
    await runStreamed(id, "git", ["checkout", "-b", branch, `origin/${branch}`], { cwd: REPO_ROOT });
  }
  await runStreamed(id, "git", ["pull", "origin", branch], { cwd: REPO_ROOT });

  if (action === "rebuild") {
    await runStreamed(id, "docker", ["compose", "build", "handoff-daemon"], { cwd: REPO_ROOT });
  } else if (action === "up") {
    await runStreamed(id, "docker", ["compose", "up", "-d", "handoff-daemon"], { cwd: REPO_ROOT });
  } else {
    await runStreamed(id, "docker", ["compose", "up", "-d", "--build", "handoff-daemon"], { cwd: REPO_ROOT });
  }
}

async function runVercel(row) {
  const { id } = row;
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    await appendDeployLog(id, "VERCEL_DEPLOY_HOOK_URL não configurado no .env — nada a disparar.");
    throw new Error("VERCEL_DEPLOY_HOOK_URL ausente");
  }
  await appendDeployLog(id, `Disparando deploy hook Vercel…`);
  const r = await fetch(hookUrl, { method: "POST" });
  const text = await r.text().catch(() => "");
  await appendDeployLog(id, `Vercel respondeu HTTP ${r.status}: ${text.slice(0, 300)}`);
  if (!r.ok) throw new Error(`Vercel hook HTTP ${r.status}`);
}

async function tick() {
  const row = await claimNextPendingDeployRequest();
  if (!row) return;
  console.log(`[deploy-worker] processando ${row.id} — ${row.target}/${row.action}/${row.branch}`);
  try {
    if (row.target === "vercel") await runVercel(row);
    else await runSelfHosted(row);
    await finishDeployRequest(row.id, "done");
    console.log(`[deploy-worker] ${row.id} concluído`);
  } catch (e) {
    await finishDeployRequest(row.id, "failed", e.message || String(e));
    console.error(`[deploy-worker] ${row.id} falhou:`, e.message || e);
  }
}

console.log("[deploy-worker] iniciado — polling deploy_requests a cada", POLL_MS, "ms");
setInterval(() => { tick().catch((e) => console.error("[deploy-worker] erro no tick:", e)); }, POLL_MS);
tick().catch((e) => console.error("[deploy-worker] erro no tick inicial:", e));
