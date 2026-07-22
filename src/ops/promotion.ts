// Promoção pra branch final (ex.: main): depois que um ciclo de code review/fix é aprovado e
// mergeado no branch de trabalho do projeto (default_branch), garante que exista um PR aberto
// levando esse branch até `promote_to_branch` — pra o humano só precisar aprovar um merge final
// em vez de descobrir manualmente que o branch de trabalho nunca chegou em main/master.
import { pg } from "../infra/postgres";
import { getGithubToken } from "../infra/postgres";

const GH_TIMEOUT_MS = 30_000;
const GH_MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

let columnEnsured = false;
export async function ensurePromotionColumn(): Promise<void> {
  if (columnEnsured) return;
  await pg.query(`alter table handoff_projects add column if not exists promote_to_branch text`).catch(() => {});
  columnEnsured = true;
}

export interface PromotionResult {
  ok: boolean;
  skipped?: string;
  prNumber?: number;
  prUrl?: string;
  alreadyExisted?: boolean;
  error?: string;
}

/** Garante um PR aberto `default_branch -> promote_to_branch`. Idempotente: se já existir um PR
 *  aberto com esse head/base, só retorna ele (o diff se atualiza sozinho a cada novo commit no
 *  head — não precisa recriar). Não mergeia nada sozinho, só abre a porta pra aprovação humana. */
export async function ensurePromotionPr(project: {
  slug: string; display_name: string; git_owner: string | null; git_repo: string | null;
  default_branch: string; promote_to_branch?: string | null;
}): Promise<PromotionResult> {
  const target = project.promote_to_branch?.trim();
  if (!target) return { ok: true, skipped: "promote_to_branch não configurado" };
  if (target === project.default_branch) return { ok: true, skipped: "promote_to_branch igual ao default_branch" };
  const { git_owner: owner, git_repo: repo } = project;
  if (!owner || !repo) return { ok: false, error: `Projeto ${project.slug} sem git_owner/git_repo` };

  try {
    const cmp = await gh(`/repos/${owner}/${repo}/compare/${target}...${project.default_branch}`).catch(() => null);
    if (cmp && cmp.ahead_by === 0) {
      return { ok: true, skipped: `${project.default_branch} já está em dia com ${target} — nada pra promover` };
    }

    const existing = await gh(`/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${project.default_branch}&base=${target}&per_page=1`);
    if (Array.isArray(existing) && existing.length) {
      return { ok: true, prNumber: existing[0].number, prUrl: existing[0].html_url, alreadyExisted: true };
    }

    const pr = await gh(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `promote(${project.default_branch}): pronto pra ${target} — ${project.display_name}`,
        head: project.default_branch,
        base: target,
        body: `🤖 **Daemon-CodeReview** — ciclo de review/fix aprovado e mergeado em \`${project.default_branch}\`.\n\nEste PR leva as mudanças até \`${target}\`. Revise e aprove o merge final quando pronto.`,
      }),
    });
    return { ok: true, prNumber: pr.number, prUrl: pr.html_url, alreadyExisted: false };
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[Promotion] falha ao garantir PR de promoção pra ${project.slug}:`, msg);
    return { ok: false, error: msg };
  }
}
