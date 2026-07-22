// Daemon-TaskAgent: executa task delegada por humano (texto livre) numa branch isolada e
// abre PR pra revisão. Dois motores: "nim" (search/replace via GitHub API, mesmo padrão do
// Daemon-FixAgent) ou "claude-cli" (clone temporário + `claude -p` headless + push).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGithubToken } from "../infra/postgres";
import { providerChat, extractJson } from "./provider-client";
import { taskPlanSkill, taskEditSkill, taskPrSkill } from "./skills";
import { ProjectRow } from "./git-collector";
import { RECOMMENDED_MODELS } from "./skills";
import { appendAgentTaskLog, updateAgentTask, AgentTask } from "../ops/agent-tasks";
import { detectStackFacts, staticGuard } from "./agent-safety";

const execFileAsync = promisify(execFile);
const MODEL = process.env.LINTER_MODEL || "minimaxai/minimax-m3";
const GH_TIMEOUT_MS = 30_000;
const GH_MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CLAUDE_TIMEOUT_MS = Number(process.env.TASK_CLAUDE_TIMEOUT_MS || 600_000);

async function ghOnce(path: string, init?: RequestInit): Promise<any> {
  const token = await getGithubToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`GitHub API HTTP ${res.status} em ${path}: ${text.slice(0, 300)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function gh(path: string, init?: RequestInit): Promise<any> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= GH_MAX_RETRIES; attempt++) {
    try {
      return await ghOnce(path, init);
    } catch (e) {
      lastErr = e as Error;
      const status = (e as Error & { status?: number }).status;
      const glitch = e instanceof Error && (e.name === "AbortError" || /aborted|fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message));
      if (!(status === 429 || (status !== undefined && status >= 500) || glitch) || attempt === GH_MAX_RETRIES) throw lastErr;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

const b64decode = (s: string) => Buffer.from(s, "base64").toString("utf8");
const b64encode = (s: string) => Buffer.from(s, "utf8").toString("base64");

function applyEdits(content: string, edits: Array<{ search: string; replace: string }>): { ok: boolean; content: string; error?: string } {
  let out = content;
  for (const e of edits) {
    if (typeof e.replace !== "string") return { ok: false, content, error: "edit sem replace" };
    if (e.search === "") {
      if (out !== "") return { ok: false, content: out, error: "arquivo já tem conteúdo — search vazio só vale pra arquivo novo" };
      out = e.replace;
      continue;
    }
    const first = out.indexOf(e.search);
    if (first === -1) return { ok: false, content: out, error: "search não encontrado no arquivo" };
    if (out.indexOf(e.search, first + 1) !== -1) return { ok: false, content: out, error: "search ambíguo (ocorre 2+ vezes)" };
    out = out.slice(0, first) + e.replace + out.slice(first + e.search.length);
  }
  return { ok: true, content: out };
}

type TaskProject = ProjectRow & { display_name: string };

/** Motor "nim": planeja arquivos, edita via search/replace pela GitHub Contents API, abre PR. */
export async function runNimTask(task: AgentTask, project: TaskProject): Promise<{ ok: boolean; error?: string }> {
  const { git_owner: owner, git_repo: repo, default_branch: baseBranch } = project;
  if (!owner || !repo) return { ok: false, error: `Projeto ${project.slug} sem git_owner/git_repo` };
  const model = task.model || project.codereview_model || RECOMMENDED_MODELS.fix[0] || MODEL;
  let createdBranch: string | undefined;

  try {
    await appendAgentTaskLog(task.id, `Coletando árvore do repositório (${owner}/${repo})…`);
    const baseRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
    const treeResp = await gh(`/repos/${owner}/${repo}/git/trees/${baseRef.object.sha}?recursive=1`);
    const fileTree: string[] = (treeResp?.tree || []).filter((e: any) => e.type === "blob").map((e: any) => e.path).slice(0, 4000);

    await appendAgentTaskLog(task.id, `Planejando execução com ${model}…`);
    const planRaw = await providerChat(
      [
        { role: "system", content: taskPlanSkill(project.display_name) },
        { role: "user", content: `TASK:\n${task.description}\n\nÁRVORE DO REPO:\n${fileTree.join("\n")}` },
      ],
      { jsonMode: true, model }
    );
    const plan = JSON.parse(extractJson(planRaw)) as { files?: string[]; new?: string[]; plan?: string };
    const filesToRead = [...new Set(plan.files || [])].slice(0, 6);
    const newFiles = new Set(plan.new || []);
    if (!filesToRead.length && !newFiles.size) {
      await updateAgentTask(task.id, { status: "failed", error: "modelo não identificou nenhum arquivo para a task" });
      return { ok: false, error: "nenhum arquivo identificado" };
    }
    await appendAgentTaskLog(task.id, `Plano: ${plan.plan || "(sem descrição)"}`);

    await appendAgentTaskLog(task.id, "Criando branch…");
    const branch = `agent/task-${task.id.slice(0, 8)}-${Date.now().toString(36)}`;
    await gh(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
    createdBranch = branch;
    await updateAgentTask(task.id, { status: "running", branch });

    const files: Array<{ path: string; content: string; sha?: string }> = [];
    for (const p of filesToRead) {
      const meta = await gh(`/repos/${owner}/${repo}/contents/${p}?ref=${branch}`).catch(() => null);
      if (meta && !Array.isArray(meta)) files.push({ path: p, content: b64decode(meta.content), sha: meta.sha });
    }
    for (const p of newFiles) {
      if (!files.some((f) => f.path === p)) files.push({ path: p, content: "" });
    }
    if (!files.length) {
      await updateAgentTask(task.id, { status: "failed", error: "nenhum dos arquivos planejados existe/foi lido" });
      return { ok: false, error: "arquivos planejados inacessíveis" };
    }

    const stackFacts = await detectStackFacts(gh, owner, repo, branch);

    await appendAgentTaskLog(task.id, `Gerando edições para ${files.length} arquivo(s)…`);
    const editRaw = await providerChat(
      [
        { role: "system", content: taskEditSkill(project.display_name, stackFacts.summary) },
        {
          role: "user",
          content: [
            `TASK:\n${task.description}`,
            ...files.map((f) => `ARQUIVO ${f.path} (conteúdo atual completo${f.content ? "" : " — ARQUIVO NOVO, vazio"}):\n${f.content}`),
          ].join("\n\n---\n\n"),
        },
      ],
      { jsonMode: true, model }
    );
    const edit = JSON.parse(extractJson(editRaw)) as {
      skip: boolean; reason?: string;
      fixes?: Array<{ file: string; rationale: string; edits: Array<{ search: string; replace: string }> }>;
    };

    if (edit.skip || !edit.fixes?.length) {
      const reason = edit.reason || "modelo optou por não executar";
      await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => {});
      await updateAgentTask(task.id, { status: "failed", error: reason });
      return { ok: false, error: reason };
    }

    const applied: Array<{ file: string; rationale: string }> = [];
    for (const f of edit.fixes) {
      const target = files.find((x) => x.path === f.file);
      if (!target) continue;
      const result = applyEdits(target.content, f.edits || []);
      if (!result.ok) {
        await appendAgentTaskLog(task.id, `${f.file}: edit não aplicado (${result.error})`);
        continue;
      }
      const guard = staticGuard(target.path, result.content, stackFacts);
      if (!guard.ok) {
        await appendAgentTaskLog(task.id, `${f.file}: BLOQUEADO pela guarda de stack — ${guard.reason}`);
        continue;
      }
      await gh(`/repos/${owner}/${repo}/contents/${target.path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `feat(agent): ${target.path}\n\n${f.rationale}\n\nDaemon-TaskAgent (${model}) — task ${task.id}`,
          content: b64encode(result.content),
          sha: target.sha,
          branch,
        }),
      });
      applied.push({ file: f.file, rationale: f.rationale });
      await appendAgentTaskLog(task.id, `${f.file}: aplicado — ${f.rationale}`);
    }

    if (!applied.length) {
      await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => {});
      await updateAgentTask(task.id, { status: "failed", error: "nenhum edit aplicável (search não bateu)" });
      return { ok: false, error: "nenhum edit aplicável" };
    }

    await appendAgentTaskLog(task.id, "Gerando descrição do PR…");
    let prBody: string;
    try {
      prBody = await providerChat(
        [
          { role: "system", content: taskPrSkill() },
          { role: "user", content: `TASK ORIGINAL:\n${task.description}\n\nARQUIVOS ALTERADOS:\n${applied.map((a) => `- ${a.file}: ${a.rationale}`).join("\n")}` },
        ],
        { model }
      );
    } catch {
      prBody = `## O que foi feito\n${applied.map((a) => `- ${a.file}: ${a.rationale}`).join("\n")}`;
    }
    prBody += `\n\n---\n_Gerado pelo Daemon-TaskAgent (motor NIM, modelo ${model}) — task \`${task.id}\`._`;

    const pr = await gh(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: `feat(agent): ${task.title}`.slice(0, 200), head: branch, base: baseBranch, body: prBody }),
    });

    await updateAgentTask(task.id, { status: "awaiting_review", pr_number: pr.number, pr_url: pr.html_url });
    await appendAgentTaskLog(task.id, `PR aberto: ${pr.html_url}`);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    // Se a branch chegou a ser criada mas o ciclo abortou antes de abrir PR (falha de rede,
    // timeout do NIM), a branch fica órfã no repo pra sempre — limpa aqui.
    if (createdBranch) {
      await gh(`/repos/${owner}/${repo}/git/refs/heads/${createdBranch}`, { method: "DELETE" }).catch(() => {});
    }
    await appendAgentTaskLog(task.id, `Erro: ${msg}`);
    await updateAgentTask(task.id, { status: "failed", error: msg });
    return { ok: false, error: msg };
  }
}

/** Motor "claude-cli": clona o repo num diretório temporário com o token, roda `claude -p`
 *  headless na task (permissões default do Claude Code — sem skip de aprovação), commita e
 *  faz push. Requer `claude` instalado na imagem e ANTHROPIC_API_KEY configurado. */
export async function runClaudeCliTask(task: AgentTask, project: TaskProject): Promise<{ ok: boolean; error?: string }> {
  const { git_owner: owner, git_repo: repo, default_branch: baseBranch } = project;
  if (!owner || !repo) return { ok: false, error: `Projeto ${project.slug} sem git_owner/git_repo` };
  if (!process.env.ANTHROPIC_API_KEY) {
    await updateAgentTask(task.id, { status: "failed", error: "ANTHROPIC_API_KEY não configurado — motor claude-cli indisponível" });
    return { ok: false, error: "ANTHROPIC_API_KEY ausente" };
  }

  const branch = `agent/task-${task.id.slice(0, 8)}-${Date.now().toString(36)}`;
  let workdir: string | undefined;
  try {
    const token = await getGithubToken();
    if (!token) throw new Error("GITHUB_TOKEN não configurado");

    workdir = await mkdtemp(join(tmpdir(), "task-agent-"));
    await appendAgentTaskLog(task.id, `Clonando ${owner}/${repo}@${baseBranch} em diretório temporário…`);
    const remote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    await execFileAsync("git", ["clone", "--depth", "1", "--branch", baseBranch, remote, workdir], { timeout: 120_000 });
    await execFileAsync("git", ["checkout", "-b", branch], { cwd: workdir });
    await execFileAsync("git", ["config", "user.email", "task-agent@handoff-daemon.local"], { cwd: workdir });
    await execFileAsync("git", ["config", "user.name", "Daemon-TaskAgent"], { cwd: workdir });

    await updateAgentTask(task.id, { status: "running", branch });
    await appendAgentTaskLog(task.id, "Executando `claude -p` headless na task (permissões default, sem skip de aprovação)…");

    // Sem --dangerously-skip-permissions: o Claude Code headless usa as permissões default
    // (edição de arquivo liberada, execução de comando arbitrário exige aprovação — que aqui
    // não há operador pra dar, então tasks que dependam de rodar build/test podem ficar
    // incompletas; ver log da task e o resumo abaixo).
    const prompt = `${task.description}\n\nAo terminar, garanta que o código compila/roda. Não crie commits — apenas edite os arquivos necessários no working directory.`;
    const { stdout } = await execFileAsync(
      "claude",
      ["-p", prompt, "--output-format", "text"],
      { cwd: workdir, timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }
    );
    const summary = stdout.trim().slice(0, 4000) || "(sem saída do Claude Code)";
    await appendAgentTaskLog(task.id, `Claude Code concluiu. Resumo:\n${summary.slice(0, 500)}`);

    const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], { cwd: workdir });
    if (!statusOut.trim()) {
      await updateAgentTask(task.id, { status: "failed", error: "Claude Code não alterou nenhum arquivo" });
      return { ok: false, error: "nenhuma alteração produzida" };
    }

    await execFileAsync("git", ["add", "-A"], { cwd: workdir });
    await execFileAsync("git", ["commit", "-m", `feat(agent): ${task.title}\n\n${summary.slice(0, 1000)}\n\nDaemon-TaskAgent (motor claude-cli) — task ${task.id}`], { cwd: workdir });
    await appendAgentTaskLog(task.id, "Enviando branch (push)…");
    await execFileAsync("git", ["push", "-u", "origin", branch], { cwd: workdir, timeout: 60_000 });

    const prBody = `## O que foi pedido\n${task.description}\n\n## O que foi feito\n${summary}\n\n---\n_Gerado pelo Daemon-TaskAgent (motor claude-cli) — task \`${task.id}\`._`;
    const pr = await gh(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: `feat(agent): ${task.title}`.slice(0, 200), head: branch, base: baseBranch, body: prBody }),
    });

    await updateAgentTask(task.id, { status: "awaiting_review", pr_number: pr.number, pr_url: pr.html_url });
    await appendAgentTaskLog(task.id, `PR aberto: ${pr.html_url}`);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await appendAgentTaskLog(task.id, `Erro: ${msg}`);
    await updateAgentTask(task.id, { status: "failed", error: msg });
    return { ok: false, error: msg };
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

const taskLocks = new Set<string>();
export function isTaskRunning(id: string): boolean {
  return taskLocks.has(id);
}

/** Dispara a execução de uma task já criada (fire-and-forget — chamador acompanha via log/status). */
export async function executeAgentTask(task: AgentTask, project: TaskProject): Promise<void> {
  if (taskLocks.has(task.id)) return;
  taskLocks.add(task.id);
  try {
    if (task.engine === "claude-cli") await runClaudeCliTask(task, project);
    else await runNimTask(task, project);
  } finally {
    taskLocks.delete(task.id);
  }
}
