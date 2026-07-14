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

  return { commitSha, branch, diff: truncateDiff(diff), commits, changedFiles };
}

async function githubApi(path: string): Promise<any> {
  const token = await getGithubToken();
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status} em ${path}`);
  return res.json();
}

async function githubDiff(path: string): Promise<string> {
  const token = await getGithubToken();
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3.diff",
    },
  });
  return res.ok ? await res.text() : "";
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
    return {
      commitSha: compare?.commits?.slice(-1)?.[0]?.sha || head,
      branch: head,
      diff: truncateDiff(diff),
      commits: (compare?.commits || []).map((c: any) => `${c.sha.slice(0, 7)} ${c.commit?.message?.split("\n")[0] ?? ""}`),
      openPrNumber: pr.number,
      openPrUrl: pr.html_url,
      changedFiles: (compare?.files || []).map((f: any) => f.filename).filter((f: string) => !isSensitivePath(f)),
    };
  }

  // Sem PR aberto: revisa o último commit da branch default (compare base...base seria sempre vazio).
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
