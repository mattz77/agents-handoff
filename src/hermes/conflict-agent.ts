// Daemon-ConflictResolver: detecta e resolve conflitos de merge de um PR aberto. Opera via clone
// temporário (git merge real, não a Compare API do GitHub — só o merge de verdade revela os
// marcadores de conflito) e usa NIM pra resolver arquivo por arquivo, preservando a intenção de
// ambos os lados quando possível.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pg } from "../infra/postgres";
import { getGithubToken } from "../infra/postgres";
import { providerChat, extractJson } from "./provider-client";
import { conflictSkill } from "./skills";
import { ProjectRow } from "./git-collector";
import { detectStackFactsLocal, staticGuard } from "./agent-safety";

const execFileAsync = promisify(execFile);
const MAX_FILE_CHARS = 40_000;

type ConflictProject = ProjectRow & { display_name: string };

export interface ConflictFile {
  path: string;
  markers: string; // conteúdo com <<<<<<< ======= >>>>>>> (capado)
}

export interface ConflictDetectResult {
  ok: boolean;
  hasConflicts?: boolean;
  files?: ConflictFile[];
  baseBranch?: string;
  headBranch?: string;
  error?: string;
}

async function ensureConflictTable() {
  await pg.query(`create table if not exists codereview_conflict_attempts (
    id serial primary key,
    project_slug text not null,
    pr_number int not null,
    model_used text,
    status text not null default 'running',
    files_total int default 0,
    files_resolved int default 0,
    log jsonb default '[]'::jsonb,
    current_step text,
    error text,
    created_at timestamptz default now(),
    finished_at timestamptz
  )`);
}

async function cloneAndFetchPr(project: ConflictProject, prNumber: number, workdir: string): Promise<{ baseBranch: string; headBranch: string }> {
  const token = await getGithubToken();
  if (!token) throw new Error("GITHUB_TOKEN não configurado");
  const { git_owner: owner, git_repo: repo } = project;
  if (!owner || !repo) throw new Error(`Projeto ${project.slug} sem git_owner/git_repo`);

  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!prRes.ok) throw new Error(`GitHub HTTP ${prRes.status} ao buscar PR #${prNumber}`);
  const pr = await prRes.json();
  const baseBranch: string = pr.base.ref;
  const headBranch: string = pr.head.ref;

  const remote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await execFileAsync("git", ["clone", "--branch", baseBranch, remote, workdir], { timeout: 180_000 });
  await execFileAsync("git", ["fetch", "origin", headBranch], { cwd: workdir, timeout: 120_000 });
  await execFileAsync("git", ["config", "user.email", "conflict-resolver@handoff-daemon.local"], { cwd: workdir });
  await execFileAsync("git", ["config", "user.name", "Daemon-ConflictResolver"], { cwd: workdir });

  return { baseBranch, headBranch };
}

/** Read-only: tenta o merge, lista arquivos conflitantes e devolve o conteúdo com marcadores.
 *  Sempre aborta o merge no final — não deixa nenhum estado no clone temporário (que é
 *  descartado mesmo assim). Não toca no repositório remoto. */
export async function detectConflicts(project: ConflictProject, prNumber: number): Promise<ConflictDetectResult> {
  let workdir: string | undefined;
  try {
    workdir = await mkdtemp(join(tmpdir(), "conflict-detect-"));
    const { baseBranch, headBranch } = await cloneAndFetchPr(project, prNumber, workdir);

    const mergeResult = await execFileAsync("git", ["merge", "--no-commit", "--no-ff", "FETCH_HEAD"], { cwd: workdir })
      .then(() => ({ conflicted: false }))
      .catch(() => ({ conflicted: true }));

    if (!mergeResult.conflicted) {
      await execFileAsync("git", ["merge", "--abort"], { cwd: workdir }).catch(() => {});
      return { ok: true, hasConflicts: false, baseBranch, headBranch };
    }

    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: workdir });
    const paths = stdout.split("\n").map((p) => p.trim()).filter(Boolean);

    const files: ConflictFile[] = [];
    for (const p of paths) {
      const content = await readFile(join(workdir, p), "utf-8").catch(() => "(binário ou ilegível)");
      files.push({ path: p, markers: content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) + "\n… [truncado]" : content });
    }

    await execFileAsync("git", ["merge", "--abort"], { cwd: workdir }).catch(() => {});
    return { ok: true, hasConflicts: true, files, baseBranch, headBranch };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 500) };
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

const MAX_HUNK_CHARS = 6_000;
const MAX_HUNKS_PER_FILE = 20;
const CONFLICT_HUNK_RE = /<<<<<<<[^\n]*\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>[^\n]*/g;

/** Resolve um arquivo conflitado hunk por hunk (não o arquivo inteiro numa chamada só —
 *  pedir o arquivo inteiro embutido numa string JSON estoura o limite de tokens de resposta
 *  em arquivos grandes e trunca o JSON no meio, quebrando o parse). Cada hunk vira uma chamada
 *  NIM pequena (só ours/theirs), a resposta é colada de volta no lugar exato via replace
 *  posicional (não por índice de string — evita colidir se dois hunks tiverem texto igual). */
async function resolveFileHunks(
  content: string, displayName: string, model: string
): Promise<{ ok: boolean; resolved?: string; reason?: string; explanations: string[] }> {
  const matches = [...content.matchAll(CONFLICT_HUNK_RE)];
  if (!matches.length) return { ok: false, reason: "nenhum marcador de conflito encontrado no arquivo", explanations: [] };
  if (matches.length > MAX_HUNKS_PER_FILE) {
    return { ok: false, reason: `arquivo com ${matches.length} hunks em conflito — acima do limite de ${MAX_HUNKS_PER_FILE}, precisa de humano`, explanations: [] };
  }

  let result = "";
  let cursor = 0;
  const explanations: string[] = [];

  for (const m of matches) {
    const [full, ours, theirs] = m;
    const start = m.index ?? content.indexOf(full, cursor);
    result += content.slice(cursor, start);
    cursor = start + full.length;

    const raw = await providerChat(
      [
        { role: "system", content: conflictSkill(displayName) },
        {
          role: "user",
          content: `OURS (branch de destino):\n${ours.slice(0, MAX_HUNK_CHARS)}\n\n---\n\nTHEIRS (branch sendo mergeado):\n${theirs.slice(0, MAX_HUNK_CHARS)}`,
        },
      ],
      { jsonMode: true, model }
    );
    const parsed = JSON.parse(extractJson(raw)) as { skip: boolean; reason?: string; resolved?: string; explanation?: string };
    if (parsed.skip || typeof parsed.resolved !== "string") {
      return { ok: false, reason: parsed.reason || "modelo optou por não resolver um dos hunks", explanations };
    }
    if (/<<<<<<<|=======|>>>>>>>/.test(parsed.resolved)) {
      return { ok: false, reason: "resposta do modelo ainda contém marcadores de conflito", explanations };
    }
    result += parsed.resolved;
    explanations.push(parsed.explanation || "hunk resolvido");
  }
  result += content.slice(cursor);
  return { ok: true, resolved: result, explanations };
}

async function setStep(attemptId: number, step: string) {
  await pg.query(`update codereview_conflict_attempts set current_step = $2 where id = $1`, [attemptId, step]).catch(() => {});
}

export interface ConflictResolveResult {
  ok: boolean;
  attemptId?: number;
  filesResolved?: string[];
  filesSkipped?: string[];
  error?: string;
}

/** Resolve de fato: clona, mergeia, resolve cada arquivo em conflito via NIM, commita e dá push
 *  no branch do PR (o próprio PR aberto passa a mostrar "mergeable"). */
export async function resolveConflicts(opts: {
  project: ConflictProject;
  prNumber: number;
  model?: string;
}): Promise<ConflictResolveResult> {
  const { project, prNumber } = opts;
  // Fixado em glm-5.2 por decisão do usuário — resolve hunk de conflito rápido (medido: ~75s
  // vs ~6min do qwen3.5-397b nas tasks do TaskAgent) sem perder qualidade na tarefa, que é
  // pequena e localizada (só o trecho em conflito, não o arquivo inteiro).
  const model = "z-ai/glm-5.2";
  await ensureConflictTable();

  const { rows } = await pg.query(
    `insert into codereview_conflict_attempts (project_slug, pr_number, model_used, current_step) values ($1,$2,$3,$4) returning id`,
    [project.slug, prNumber, model, "iniciando…"]
  );
  const attemptId = rows[0].id;

  let workdir: string | undefined;
  try {
    workdir = await mkdtemp(join(tmpdir(), "conflict-resolve-"));
    await setStep(attemptId, "clonando repositório e branches…");
    const { headBranch } = await cloneAndFetchPr(project, prNumber, workdir);

    await setStep(attemptId, "tentando merge…");
    const merged = await execFileAsync("git", ["merge", "--no-commit", "--no-ff", "FETCH_HEAD"], { cwd: workdir })
      .then(() => true)
      .catch(() => false);

    if (merged) {
      // Sem conflito de verdade (pode ter mudado desde a detecção) — só commita o merge limpo.
      await execFileAsync("git", ["commit", "-m", `merge: sem conflitos reais no momento da resolução\n\nDaemon-ConflictResolver — attempt ${attemptId}`], { cwd: workdir }).catch(() => {});
      await execFileAsync("git", ["push", "origin", `HEAD:${headBranch}`], { cwd: workdir, timeout: 60_000 });
      await pg.query(`update codereview_conflict_attempts set status='done', current_step='sem conflitos — merge limpo aplicado', finished_at=now() where id=$1`, [attemptId]);
      return { ok: true, attemptId, filesResolved: [], filesSkipped: [] };
    }

    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: workdir });
    const paths = stdout.split("\n").map((p) => p.trim()).filter(Boolean);
    await pg.query(`update codereview_conflict_attempts set files_total = $2 where id = $1`, [attemptId, paths.length]);
    const stackFacts = await detectStackFactsLocal(workdir);

    const filesResolved: string[] = [];
    const filesSkipped: string[] = [];
    const log: Array<{ file: string; status: "resolved" | "skipped" | "error"; detail: string }> = [];

    for (const [idx, p] of paths.entries()) {
      await setStep(attemptId, `[${idx + 1}/${paths.length}] resolvendo ${p} com ${model}…`);
      try {
        const content = await readFile(join(workdir, p), "utf-8");
        const result = await resolveFileHunks(content, project.display_name, model);

        if (!result.ok || !result.resolved) {
          filesSkipped.push(p);
          log.push({ file: p, status: "skipped", detail: result.reason || "modelo optou por não resolver" });
          continue;
        }
        const guard = staticGuard(p, result.resolved, stackFacts);
        if (!guard.ok) {
          filesSkipped.push(p);
          log.push({ file: p, status: "skipped", detail: `bloqueado pela guarda de stack — ${guard.reason}` });
          continue;
        }

        await writeFile(join(workdir, p), result.resolved, "utf-8");
        await execFileAsync("git", ["add", p], { cwd: workdir });
        filesResolved.push(p);
        log.push({ file: p, status: "resolved", detail: result.explanations.join("; ") || "resolvido" });
      } catch (e) {
        filesSkipped.push(p);
        log.push({ file: p, status: "error", detail: (e as Error).message.slice(0, 200) });
      }
      await pg.query(`update codereview_conflict_attempts set files_resolved = $2, log = $3 where id = $1`, [attemptId, filesResolved.length, JSON.stringify(log)]);
    }

    if (filesSkipped.length) {
      await execFileAsync("git", ["merge", "--abort"], { cwd: workdir }).catch(() => {});
      await pg.query(
        `update codereview_conflict_attempts set status='failed', error=$2, current_step='arquivo(s) não resolvido(s) automaticamente — precisa de humano', finished_at=now() where id=$1`,
        [attemptId, `Não resolvido automaticamente: ${filesSkipped.join(", ")}`]
      );
      return { ok: false, attemptId, filesResolved, filesSkipped, error: `Arquivo(s) que precisam de resolução manual: ${filesSkipped.join(", ")}` };
    }

    await setStep(attemptId, "commitando resolução…");
    await execFileAsync("git", ["commit", "-m", `merge: resolve conflitos (${filesResolved.length} arquivo(s))\n\nDaemon-ConflictResolver (${model}) — attempt ${attemptId}`], { cwd: workdir });
    await setStep(attemptId, "enviando (push)…");
    await execFileAsync("git", ["push", "origin", `HEAD:${headBranch}`], { cwd: workdir, timeout: 60_000 });

    await pg.query(`update codereview_conflict_attempts set status='done', current_step='conflitos resolvidos — PR pronto pra mergear', finished_at=now() where id=$1`, [attemptId]);
    return { ok: true, attemptId, filesResolved, filesSkipped: [] };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await pg.query(`update codereview_conflict_attempts set status='failed', error=$2, current_step='erro', finished_at=now() where id=$1`, [attemptId, msg]);
    return { ok: false, attemptId, error: msg };
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function getConflictAttempt(projectSlug: string, prNumber: number) {
  await ensureConflictTable();
  const { rows } = await pg.query(
    `select * from codereview_conflict_attempts where project_slug = $1 and pr_number = $2 order by created_at desc limit 1`,
    [projectSlug, prNumber]
  );
  return rows[0] || null;
}
