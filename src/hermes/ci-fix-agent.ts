// Daemon-CIFixAgent: corrige falhas de CI (GitHub Actions) do PR aberto do projeto.
// Fluxo: acha run falho do head do PR → baixa log dos jobs falhos → extrai trecho relevante
// → identifica arquivos candidatos pelo log → pede fix (search/replace) pro modelo do fix
// → commita no branch do PR → CI re-roda sozinho. Opera 100% via GitHub API.
// Guard-rails: máx. tentativas por run (evita loop), escopo de arquivo restrito a
// teste/config por padrão (nunca mexe em código de produção sem CI_FIX_ALLOW_ANY=1).
import { pg } from "../infra/postgres";
import { getGithubToken } from "../infra/postgres";
import { nimChat, extractJson } from "./nim-client";
import { ciFixSkill } from "./skills";
import { ProjectRow } from "./git-collector";
import { RECOMMENDED_MODELS } from "./skills";

const MODEL = process.env.LINTER_MODEL || "minimaxai/minimax-m3";
const MAX_ATTEMPTS_PER_RUN = Number(process.env.CI_FIX_MAX_ATTEMPTS || 2);
const MAX_ATTEMPTS_PER_PR_DAY = Number(process.env.CI_FIX_MAX_ATTEMPTS_PER_PR_DAY || 4);
const MAX_LOG_CHARS = Number(process.env.CI_FIX_MAX_LOG_CHARS || 15_000);
const MAX_CANDIDATE_FILES = 4;
// Por padrão só arquivos de teste/config — nunca código de produção.
const SAFE_PATH_RE = /(^|\/)(__tests__|__mocks__|test|tests|e2e)\/|\.(test|spec)\.[jt]sx?$|jest|\.config\.|tsconfig|babel|(^|\/)\.github\/workflows\//i;
const ALLOW_ANY_PATH = process.env.CI_FIX_ALLOW_ANY === "1";

const GH_TIMEOUT_MS = 30_000;
const GH_MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ghOnce(path: string, init?: RequestInit, accept = "application/vnd.github+json"): Promise<Response> {
  const token = await getGithubToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GH_TIMEOUT_MS);
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function gh(path: string, init?: RequestInit): Promise<any> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= GH_MAX_RETRIES; attempt++) {
    try {
      const res = await ghOnce(path, init);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`GitHub API HTTP ${res.status} em ${path}: ${text.slice(0, 300)}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
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

/** Log de job vem como texto puro (a API redireciona pro blob — fetch segue sozinho). */
async function ghJobLog(owner: string, repo: string, jobId: number): Promise<string> {
  const res = await ghOnce(`/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`);
  return res.ok ? await res.text() : "";
}

const b64decode = (s: string) => Buffer.from(s, "base64").toString("utf8");
const b64encode = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Recorta o trecho útil do log: da primeira linha de falha em diante, cap no fim. */
function extractFailureExcerpt(log: string): string {
  const lines = log.split("\n");
  const markers = /##\[error\]|(^|\s)(FAIL|✕|✗)\s|Error:|error TS\d+|AssertionError|Test Suites?:.*failed/;
  let firstIdx = lines.findIndex((l) => markers.test(l));
  if (firstIdx === -1) firstIdx = Math.max(0, lines.length - 200);
  // Um pouco de contexto antes da primeira falha ajuda o modelo a se situar.
  const excerpt = lines.slice(Math.max(0, firstIdx - 20)).join("\n");
  return excerpt.length > MAX_LOG_CHARS ? excerpt.slice(-MAX_LOG_CHARS) : excerpt;
}

/** Paths repo-relativos citados no log (stack traces, "at ...", FAIL <path>). */
function extractCandidatePaths(excerpt: string): string[] {
  const re = /(?:^|[\s("'`])((?:[\w.@-]+\/)+[\w.@-]+\.(?:[jt]sx?|json|ya?ml|ps1|toml))(?::\d+)?/gm;
  const counts = new Map<string, number>();
  for (const m of excerpt.matchAll(re)) {
    const p = m[1].replace(/^\.\//, "");
    if (p.includes("node_modules/")) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

async function ensureAttemptsTable() {
  await pg.query(`create table if not exists ci_fix_attempts (
    id serial primary key,
    project_slug text not null,
    run_id bigint not null,
    pr_number int,
    status text not null default 'running',
    diagnosis text,
    files_fixed jsonb default '[]'::jsonb,
    error text,
    model_used text,
    created_at timestamptz default now(),
    finished_at timestamptz
  )`);
}

export interface CiFixResult {
  ok: boolean;
  attemptId?: number;
  runId?: number;
  diagnosis?: string;
  filesFixed?: string[];
  skipped?: string;
  error?: string;
}

/** Corrige a falha de CI do PR aberto do projeto (ou de um PR específico). */
export async function runCiFix(opts: {
  project: ProjectRow & { display_name: string; attack_model?: string | null };
  prNumber?: number;
  model?: string;
}): Promise<CiFixResult> {
  const { project } = opts;
  const { git_owner: owner, git_repo: repo } = project;
  if (!owner || !repo) return { ok: false, error: `Projeto ${project.slug} sem git_owner/git_repo` };
  // Herda a cadeia de modelo do fix-agent (pedido explícito: CI fix usa o modelo do fix).
  const model = opts.model || project.attack_model || project.codereview_model
    || RECOMMENDED_MODELS.fix[0] || MODEL;

  await ensureAttemptsTable();

  try {
    // 1. PR alvo
    let pr: any;
    if (opts.prNumber) {
      pr = await gh(`/repos/${owner}/${repo}/pulls/${opts.prNumber}`);
    } else {
      const prs = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=1`);
      pr = Array.isArray(prs) && prs.length ? prs[0] : null;
    }
    if (!pr || pr.state !== "open") return { ok: false, error: "nenhum PR aberto pra corrigir CI" };
    const branch: string = pr.head.ref;
    const headSha: string = pr.head.sha;

    // 2. Run falho do head atual (só o commit mais recente — falha antiga já foi superada)
    const runs = await gh(`/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=10`);
    const failedRun = (runs?.workflow_runs || []).find((r: any) => r.conclusion === "failure");
    if (!failedRun) return { ok: false, error: `nenhum run falho no head ${headSha.slice(0, 7)} do PR #${pr.number}` };

    // Guard: máx. tentativas por run
    const { rows: prev } = await pg.query(
      `select count(*)::int as n from ci_fix_attempts where project_slug = $1 and run_id = $2`,
      [project.slug, failedRun.id]
    );
    if (prev[0].n >= MAX_ATTEMPTS_PER_RUN) {
      return { ok: false, error: `run ${failedRun.id} já teve ${prev[0].n} tentativa(s) — limite ${MAX_ATTEMPTS_PER_RUN}, precisa de humano` };
    }
    // Guard anti-loop: cada fix gera run novo (run_id novo), então o cap por run não segura
    // ciclo fix→falha→fix. Cap adicional por PR nas últimas 24h.
    const { rows: prPrev } = await pg.query(
      `select count(*)::int as n from ci_fix_attempts
       where project_slug = $1 and pr_number = $2 and created_at > now() - interval '24 hours'`,
      [project.slug, pr.number]
    );
    if (prPrev[0].n >= MAX_ATTEMPTS_PER_PR_DAY) {
      return { ok: false, error: `PR #${pr.number} já teve ${prPrev[0].n} tentativa(s) de CI-fix em 24h — limite ${MAX_ATTEMPTS_PER_PR_DAY}, precisa de humano` };
    }

    const { rows: att } = await pg.query(
      `insert into ci_fix_attempts (project_slug, run_id, pr_number, model_used) values ($1,$2,$3,$4) returning id`,
      [project.slug, failedRun.id, pr.number, model]
    );
    const attemptId = att[0].id;
    const finish = (fields: { status: string; diagnosis?: string; filesFixed?: string[]; error?: string }) =>
      pg.query(
        `update ci_fix_attempts set status=$2, diagnosis=$3, files_fixed=$4, error=$5, finished_at=now() where id=$1`,
        [attemptId, fields.status, fields.diagnosis ?? null, JSON.stringify(fields.filesFixed ?? []), fields.error ?? null]
      ).catch(() => {});

    // 3. Logs dos jobs falhos
    const jobs = await gh(`/repos/${owner}/${repo}/actions/runs/${failedRun.id}/jobs?per_page=50`);
    const failedJobs = (jobs?.jobs || []).filter((j: any) => j.conclusion === "failure");
    if (!failedJobs.length) {
      await finish({ status: "skipped", error: "run falho sem job falho (cancelamento?)" });
      return { ok: false, attemptId, error: "run falho sem job com conclusion=failure" };
    }
    const excerpts: string[] = [];
    for (const job of failedJobs.slice(0, 3)) {
      const log = await ghJobLog(owner, repo, job.id);
      if (log) excerpts.push(`=== JOB: ${job.name} ===\n${extractFailureExcerpt(log)}`);
    }
    const logExcerpt = excerpts.join("\n\n").slice(-MAX_LOG_CHARS);
    if (!logExcerpt.trim()) {
      await finish({ status: "failed", error: "não consegui baixar log dos jobs" });
      return { ok: false, attemptId, error: "log dos jobs vazio/indisponível" };
    }

    // 4. Arquivos candidatos citados no log, respeitando o escopo seguro
    const candidates = extractCandidatePaths(logExcerpt)
      .filter((p) => ALLOW_ANY_PATH || SAFE_PATH_RE.test(p))
      .slice(0, MAX_CANDIDATE_FILES);
    const files: Array<{ path: string; content: string; sha: string }> = [];
    for (const p of candidates) {
      const meta = await gh(`/repos/${owner}/${repo}/contents/${p}?ref=${branch}`).catch(() => null);
      if (meta && !Array.isArray(meta) && meta.content) {
        files.push({ path: p, content: b64decode(meta.content), sha: meta.sha });
      }
    }
    if (!files.length) {
      const outOfScope = extractCandidatePaths(logExcerpt).filter((p) => !SAFE_PATH_RE.test(p)).slice(0, 5);
      const msg = outOfScope.length
        ? `nenhum arquivo candidato no escopo seguro (teste/config). Fora de escopo: ${outOfScope.join(", ")} — corrigir manualmente ou CI_FIX_ALLOW_ANY=1`
        : "nenhum arquivo candidato identificável no log";
      await finish({ status: "skipped", error: msg });
      return { ok: false, attemptId, skipped: msg };
    }

    // 5. Fix via modelo (mesma cadeia do fix-agent)
    const raw = await nimChat(
      [
        { role: "system", content: ciFixSkill(project.display_name) },
        {
          role: "user",
          content: [
            `LOG DO CI (jobs falhos do run ${failedRun.id}, PR #${pr.number}, branch ${branch}):\n${logExcerpt}`,
            ...files.map((f) => `ARQUIVO ${f.path} (conteúdo atual completo):\n${f.content}`),
          ].join("\n\n---\n\n"),
        },
      ],
      { jsonMode: true, model }
    );
    const fix = JSON.parse(extractJson(raw)) as {
      skip: boolean; reason?: string; diagnosis?: string;
      fixes?: Array<{ file: string; edits: Array<{ search: string; replace: string }> }>;
    };

    if (fix.skip || !fix.fixes?.length) {
      const reason = fix.reason || "modelo optou por não corrigir";
      await finish({ status: "skipped", diagnosis: reason });
      await gh(`/repos/${owner}/${repo}/issues/${pr.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `🤖 **Daemon-CIFixAgent** (${model}) — CI falhou mas não corrigi automaticamente:\n\n> ${reason}` }),
      }).catch(() => {});
      return { ok: false, attemptId, skipped: reason };
    }

    // 6. Aplica e commita no branch do PR (só arquivos que foram fornecidos ao modelo)
    const filesFixed: string[] = [];
    for (const f of fix.fixes) {
      const target = files.find((x) => x.path === f.file);
      if (!target) continue; // modelo alucinou path — ignora
      let out = target.content;
      let bad = false;
      for (const e of f.edits || []) {
        if (!e.search || typeof e.replace !== "string") { bad = true; break; }
        const first = out.indexOf(e.search);
        if (first === -1 || out.indexOf(e.search, first + 1) !== -1) { bad = true; break; }
        out = out.slice(0, first) + e.replace + out.slice(first + e.search.length);
      }
      if (bad || out === target.content) continue;
      await gh(`/repos/${owner}/${repo}/contents/${target.path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `fix(ci): ${target.path} — correção automática do run ${failedRun.id}\n\n${(fix.diagnosis || "").slice(0, 200)}\n\nDaemon-CIFixAgent (${model})`,
          content: b64encode(out),
          sha: target.sha,
          branch,
        }),
      });
      filesFixed.push(target.path);
    }

    if (!filesFixed.length) {
      await finish({ status: "failed", diagnosis: fix.diagnosis, error: "edits não aplicáveis (search não bateu ou path alucinado)" });
      return { ok: false, attemptId, error: "nenhum edit aplicável" };
    }

    await finish({ status: "done", diagnosis: fix.diagnosis, filesFixed });
    await gh(`/repos/${owner}/${repo}/issues/${pr.number}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `🤖 **Daemon-CIFixAgent** (${model}) — correção automática da falha do CI (run [${failedRun.id}](${failedRun.html_url})):\n\n**Diagnóstico:** ${fix.diagnosis}\n\n**Arquivos:** ${filesFixed.map((f) => `\`${f}\``).join(", ")}\n\nCI vai re-rodar com o novo commit.`,
      }),
    }).catch(() => {});

    return { ok: true, attemptId, runId: failedRun.id, diagnosis: fix.diagnosis, filesFixed };
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[CIFixAgent] falha no projeto ${project.slug}:`, msg);
    return { ok: false, error: msg };
  }
}
