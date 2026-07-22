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
const { spawn, execFile } = require("node:child_process");
const util = require("node:util");
const execFileP = util.promisify(execFile);

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
  getDeployProject,
  listDeployProjects,
  updateDeployProjectBranches,
} = require(path.join(REPO_ROOT, "dist", "ops", "deploy-data.js"));

const POLL_MS = 2000;
const BRANCHES_REFRESH_MS = 20_000;
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

function resolveLocalPath(localPath) {
  return path.isAbsolute(localPath) ? localPath : path.join(REPO_ROOT, localPath);
}

async function runSelfHosted(row, project) {
  const { id, branch, action } = row;
  if (!BRANCH_RE.test(branch)) throw new Error(`branch inválida: ${branch}`);
  const cwd = resolveLocalPath(project.local_path);
  if (!fs.existsSync(cwd)) throw new Error(`local_path não existe no host: ${cwd}`);
  const service = project.compose_service;

  await runStreamed(id, "git", ["fetch", "origin"], { cwd });
  try {
    await runStreamed(id, "git", ["checkout", branch], { cwd });
  } catch {
    await runStreamed(id, "git", ["checkout", "-b", branch, `origin/${branch}`], { cwd });
  }
  await runStreamed(id, "git", ["pull", "origin", branch], { cwd });

  if (action === "rebuild") {
    await runStreamed(id, "docker", ["compose", "build", service], { cwd });
  } else if (action === "up") {
    await runStreamed(id, "docker", ["compose", "up", "-d", service], { cwd });
  } else {
    await runStreamed(id, "docker", ["compose", "up", "-d", "--build", service], { cwd });
  }
}

async function runVercel(row, project) {
  const { id } = row;
  const hookUrl = project.vercel_deploy_hook_url || process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    await appendDeployLog(id, `VERCEL_DEPLOY_HOOK_URL não configurado (nem no projeto "${project.slug}", nem no .env) — nada a disparar.`);
    throw new Error("VERCEL_DEPLOY_HOOK_URL ausente");
  }
  await appendDeployLog(id, `Disparando deploy hook Vercel de ${project.display_name}…`);
  const r = await fetch(hookUrl, { method: "POST" });
  const text = await r.text().catch(() => "");
  await appendDeployLog(id, `Vercel respondeu HTTP ${r.status}: ${text.slice(0, 300)}`);
  if (!r.ok) throw new Error(`Vercel hook HTTP ${r.status}`);
}

// Roda em paralelo ao tick de deploy — mantém deploy_projects.branches em dia pro
// seletor do painel, sem depender do usuário digitar o nome do branch de cabeça.
async function refreshBranchesForProject(project) {
  const cwd = resolveLocalPath(project.local_path);
  if (!fs.existsSync(cwd)) return;
  try {
    await execFileP("git", ["fetch", "--prune", "origin"], { cwd, timeout: 30_000 });
  } catch {
    // Sem rede/remote configurado — segue só com o que já existe localmente.
  }
  try {
    const { stdout } = await execFileP(
      "git",
      ["for-each-ref", "--format=%(refname:short)", "refs/heads/", "refs/remotes/origin/"],
      { cwd, timeout: 15_000 }
    );
    const names = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^origin\//, ""))
      .filter((l) => l !== "HEAD");
    const unique = [...new Set(names)].sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)));
    await updateDeployProjectBranches(project.slug, unique);
  } catch (e) {
    console.error(`[deploy-worker] falha ao listar branches de ${project.slug}:`, e.message || e);
  }
}

async function refreshBranchesLoop() {
  try {
    const projects = await listDeployProjects();
    for (const p of projects) await refreshBranchesForProject(p);
  } catch (e) {
    console.error("[deploy-worker] erro no refresh de branches:", e.message || e);
  }
}

async function tick() {
  const row = await claimNextPendingDeployRequest();
  if (!row) return;
  console.log(`[deploy-worker] processando ${row.id} — ${row.project_slug}/${row.target}/${row.action}/${row.branch}`);
  try {
    const project = await getDeployProject(row.project_slug);
    if (!project) throw new Error(`projeto "${row.project_slug}" não cadastrado em deploy_projects`);
    if (row.target === "vercel") await runVercel(row, project);
    else await runSelfHosted(row, project);
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

setInterval(() => { refreshBranchesLoop().catch((e) => console.error("[deploy-worker] erro no refresh de branches:", e)); }, BRANCHES_REFRESH_MS);
refreshBranchesLoop().catch((e) => console.error("[deploy-worker] erro no refresh de branches inicial:", e));
