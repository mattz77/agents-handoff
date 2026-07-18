import { execSync } from "node:child_process";
import { stripSensitiveDiffSections, isSensitivePath } from "../shared/redact";
import { getGithubToken } from "../infra/postgres";

const MAX_DIFF_CHARS = Number(process.env.CODEREVIEW_MAX_DIFF_CHARS || 80_000);

export interface ProjectRow {
  slug: string;
  display_name: string;
  local_path: string | null;
  git_provider: "github" | "gitlab" | "local";
  git_owner: string | null;
  git_repo: string | null;
  default_branch: string;
  codereview_model?: string | null;
}

export interface GitCollectResult {
  commitSha: string;
  branch: string;
  diff: string;
  commits: string[];
  openPrNumber?: number;
  openPrUrl?: string;
  changedFiles: string[];
  /** Paths de todos os arquivos do repo (sem conteúdo) — contexto barato pra checagens de existência. */
  fileTree: string[];
}

const MAX_TREE_ENTRIES = Number(process.env.CODEREVIEW_MAX_TREE_ENTRIES || 4_000);

function capTree(paths: string[]): string[] {
  const safe = paths.filter(Boolean).filter((f) => !isSensitivePath(f));
  return safe.length > MAX_TREE_ENTRIES ? safe.slice(0, MAX_TREE_ENTRIES) : safe;
}

function truncateDiff(diff: string): string {
  const safe = stripSensitiveDiffSections(diff);
  return safe.length > MAX_DIFF_CHARS
    ? safe.slice(0, MAX_DIFF_CHARS) + "\n\n... [diff truncado]"
    : safe;
}

function collectLocal(project: ProjectRow): GitCollectResult {
  const cwd = project.local_path || process.cwd();
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
    } catch {
      return "";
    }
  };

  const commitSha = run("git rev-parse HEAD") || "HEAD";
  const branch = run("git rev-parse --abbrev-ref HEAD") || project.default_branch;
  const diff = run("git diff HEAD~1..HEAD") || run("git diff --cached") || "";
  const commitsRaw = run("git log --oneline -10");
  const commits = commitsRaw ? commitsRaw.split("\n") : [];
  const changedFilesRaw = run("git diff --name-only HEAD~1..HEAD");
  const changedFiles = changedFilesRaw
    ? changedFilesRaw.split("\n").filter(Boolean).filter((f) => !isSensitivePath(f))
    : [];
  const treeRaw = run("git ls-files");
  const fileTree = capTree(treeRaw ? treeRaw.split("\n") : []);

  return { commitSha, branch, diff: truncateDiff(diff), commits, changedFiles, fileTree };
}

const GITHUB_TIMEOUT_MS = 30_000;
const GITHUB_MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function githubFetch(url: string, accept: string, init?: RequestInit): Promise<Response> {
  const token = await getGithubToken();
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= GITHUB_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: accept,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });
      // 502/503/504 são outages transitórios do GitHub/Fastly (ex.: página HTML de erro
      // "Hello future GitHubber…") — sem retry aqui, qualquer review/ataque na hora certa falha
      // com HTML jogado direto na tela em vez de simplesmente tentar de novo.
      if ([502, 503, 504].includes(res.status) && attempt < GITHUB_MAX_RETRIES) {
        console.warn(`[GitCollector] GitHub respondeu ${res.status} (tentativa ${attempt + 1}), retry em ${2 ** attempt}s…`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e as Error;
      const isTransient = lastErr.name === "TimeoutError" || lastErr.name === "AbortError"
        || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(lastErr.message);
      if (!isTransient || attempt === GITHUB_MAX_RETRIES) throw lastErr;
      console.warn(`[GitCollector] GitHub fetch attempt ${attempt + 1} failed (${lastErr.message}), retrying in ${2 ** attempt}s…`);
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function githubApi(path: string, init?: RequestInit): Promise<any> {
  const res = await githubFetch(`https://api.github.com${path}`, "application/vnd.github+json", init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`GitHub API HTTP ${res.status} em ${path}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function githubDiff(path: string): Promise<string> {
  const res = await githubFetch(`https://api.github.com${path}`, "application/vnd.github.v3.diff");
  return res.ok ? await res.text() : "";
}

/** Árvore de paths do repo no commit dado (Trees API recursiva). Falha vira [] — tree é contexto opcional. */
async function githubFileTree(owner: string, repo: string, sha: string): Promise<string[]> {
  try {
    const tree = await githubApi(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
    const entries = Array.isArray(tree?.tree) ? tree.tree : [];
    return capTree(entries.filter((e: any) => e.type === "blob").map((e: any) => e.path));
  } catch (e) {
    console.warn(`[GitCollector] falha ao coletar file tree de ${owner}/${repo}@${sha.slice(0, 7)}: ${(e as Error).message}`);
    return [];
  }
}

async function collectGithub(project: ProjectRow): Promise<GitCollectResult> {
  const { git_owner: owner, git_repo: repo, default_branch: base } = project;
  if (!owner || !repo) throw new Error(`Projeto ${project.slug} sem git_owner/git_repo`);

  const prs = await githubApi(`/repos/${owner}/${repo}/pulls?state=open&per_page=1`);
  const pr = Array.isArray(prs) && prs.length ? prs[0] : null;

  if (pr) {
    const head = pr.head.ref;
    // Base do compare vem do próprio PR — o default_branch do registry pode divergir
    // (ex: repo com default trocado, PR apontando pra outra base).
    const prBase = pr.base?.ref || base;
    const compare = await githubApi(`/repos/${owner}/${repo}/compare/${prBase}...${head}`);
    const diff = await githubDiff(`/repos/${owner}/${repo}/compare/${prBase}...${head}`);
    const headSha = compare?.commits?.slice(-1)?.[0]?.sha || pr.head?.sha || head;
    return {
      commitSha: headSha,
      branch: head,
      diff: truncateDiff(diff),
      commits: (compare?.commits || []).map((c: any) => `${c.sha.slice(0, 7)} ${c.commit?.message?.split("\n")[0] ?? ""}`),
      openPrNumber: pr.number,
      openPrUrl: pr.html_url,
      changedFiles: (compare?.files || []).map((f: any) => f.filename).filter((f: string) => !isSensitivePath(f)),
      fileTree: await githubFileTree(owner, repo, headSha),
    };
  }

  // Sem PR aberto: revisa tudo que foi commitado direto na branch default desde o último PR
  // mergeado (não só o último commit isolado) e abre um PR de auditoria pra hospedar os
  // comentários inline — sem isso, uma vez sem PR aberto o review nunca mais tem onde postar.
  return collectSinceLastMerge(owner, repo, base);
}

/** Branch congelada no ponto do último merge, criada só se ainda não existir — idempotente,
 *  evita empilhar branch nova a cada rodada de review. */
async function ensureFrozenBaseBranch(owner: string, repo: string, name: string, sha: string): Promise<void> {
  const existing = await githubApi(`/repos/${owner}/${repo}/git/ref/heads/${name}`).catch((e) => {
    if ((e as Error & { status?: number }).status === 404) return null;
    throw e;
  });
  if (existing) return;
  await githubApi(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha }),
  });
}

/** Acha (ou abre) o PR de auditoria entre a branch congelada e a branch default atual. */
async function ensureAuditPr(
  owner: string, repo: string, base: string, frozenBranch: string, lastMergedPrNumber: number | null
): Promise<{ number: number; url: string }> {
  const openPrs = await githubApi(`/repos/${owner}/${repo}/pulls?state=open&base=${frozenBranch}&head=${owner}:${base}&per_page=1`);
  if (Array.isArray(openPrs) && openPrs.length) {
    return { number: openPrs[0].number, url: openPrs[0].html_url };
  }
  const title = lastMergedPrNumber
    ? `🤖 Code Review — commits diretos em ${base} desde o PR #${lastMergedPrNumber}`
    : `🤖 Code Review — auditoria de ${base}`;
  const body = [
    `PR gerado automaticamente pelo Daemon-CodeReview para revisar commits que foram direto pra \`${base}\` sem passar por um PR aberto.`,
    ``,
    `**Não é um PR de código pra mergear normalmente** — a branch base (\`${frozenBranch}\`) é um marcador congelado, não recebe trabalho de ninguém. Serve só pra hospedar os comentários inline do review. Pode fechar depois de ler/endereçar os comentários.`,
  ].join("\n");
  try {
    const pr = await githubApi(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title, head: base, base: frozenBranch, body }),
    });
    return { number: pr.number, url: pr.html_url };
  } catch (e) {
    // Corrida: outro processo abriu no intervalo entre o check e o POST — reusa o existente.
    if ((e as Error & { status?: number }).status === 422) {
      const retry = await githubApi(`/repos/${owner}/${repo}/pulls?state=open&base=${frozenBranch}&head=${owner}:${base}&per_page=1`);
      if (Array.isArray(retry) && retry.length) return { number: retry[0].number, url: retry[0].html_url };
    }
    throw e;
  }
}

async function collectSinceLastMerge(owner: string, repo: string, base: string): Promise<GitCollectResult> {
  const closedPrs = await githubApi(`/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`);
  const lastMerged = (Array.isArray(closedPrs) ? closedPrs : []).find((p: any) => p.merged_at && p.merge_commit_sha);

  const currentRef = await githubApi(`/repos/${owner}/${repo}/git/ref/heads/${base}`);
  const currentTip: string = currentRef.object.sha;

  // Repo sem nenhum PR mergeado ainda: sem ponto de referência, cai pro último commit isolado.
  if (!lastMerged) {
    const commits = await githubApi(`/repos/${owner}/${repo}/commits?sha=${base}&per_page=10`);
    const headCommit = Array.isArray(commits) && commits.length ? commits[0] : null;
    if (!headCommit) throw new Error(`Repo ${owner}/${repo} sem commits na branch ${base}`);
    const detail = await githubApi(`/repos/${owner}/${repo}/commits/${headCommit.sha}`);
    const diff = await githubDiff(`/repos/${owner}/${repo}/commits/${headCommit.sha}`);
    return {
      commitSha: headCommit.sha,
      branch: base,
      diff: truncateDiff(diff),
      commits: commits.map((c: any) => `${c.sha.slice(0, 7)} ${c.commit?.message?.split("\n")[0] ?? ""}`),
      changedFiles: (detail?.files || []).map((f: any) => f.filename).filter((f: string) => !isSensitivePath(f)),
      fileTree: await githubFileTree(owner, repo, headCommit.sha),
    };
  }

  const mergeBase: string = lastMerged.merge_commit_sha;
  if (mergeBase === currentTip) {
    // Nada novo desde o último merge — estado estável, não é erro, não abre PR à toa.
    return { commitSha: currentTip, branch: base, diff: "", commits: [], changedFiles: [], fileTree: [] };
  }

  const compare = await githubApi(`/repos/${owner}/${repo}/compare/${mergeBase}...${currentTip}`);
  const diff = await githubDiff(`/repos/${owner}/${repo}/compare/${mergeBase}...${currentTip}`);

  const frozenBranch = `codereview/base-${lastMerged.number}`;
  await ensureFrozenBaseBranch(owner, repo, frozenBranch, mergeBase);
  const auditPr = await ensureAuditPr(owner, repo, base, frozenBranch, lastMerged.number);

  return {
    commitSha: currentTip,
    branch: base,
    diff: truncateDiff(diff),
    commits: (compare?.commits || []).map((c: any) => `${c.sha.slice(0, 7)} ${c.commit?.message?.split("\n")[0] ?? ""}`),
    openPrNumber: auditPr.number,
    openPrUrl: auditPr.url,
    changedFiles: (compare?.files || []).map((f: any) => f.filename).filter((f: string) => !isSensitivePath(f)),
    fileTree: await githubFileTree(owner, repo, currentTip),
  };
}

export async function collectGitContext(project: ProjectRow): Promise<GitCollectResult> {
  switch (project.git_provider) {
    case "local":
      return collectLocal(project);
    case "github": {
      const token = await getGithubToken();
      if (!token) {
        if (!project.local_path) {
          throw new Error(`GITHUB_TOKEN vazio e projeto "${project.slug}" sem local_path — não há como coletar diff`);
        }
        console.warn(`[GitCollector] GITHUB_TOKEN vazio, usando coleta local para "${project.slug}" (sem PR/inline comments)`);
        return collectLocal(project);
      }
      return collectGithub(project);
    }
    default:
      throw new Error(`git_provider "${project.git_provider}" não suportado ainda`);
  }
}
