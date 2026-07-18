import { getGithubToken } from "../infra/postgres";

export interface CodeReviewIssue {
  file: string;
  line: number | null;
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  suggestion?: string;
  /** Trecho literal do diff que prova a alegação — issues sem evidence são descartadas. */
  evidence?: string;
}

/** Posta um review com inline comments no PR aberto (event COMMENT — não aprova/reprova). */
export async function postReviewComments(
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  issues: CodeReviewIssue[],
  summary: string
): Promise<{ ok: boolean; error?: string }> {
  const token = await getGithubToken();
  if (!token) return { ok: false, error: "GITHUB_TOKEN não configurado" };

  const inline = issues.filter((i) => i.line != null);
  const general = issues.filter((i) => i.line == null);

  const comments = inline.map((i) => ({
    path: i.file,
    line: i.line,
    side: "RIGHT",
    body: `🤖 **Daemon-CodeReview** [${i.severity}] — ${i.message}` +
      (i.suggestion ? `\n\n\`\`\`suggestion\n${i.suggestion}\n\`\`\`` : ""),
  }));

  const generalBody = ["## 🤖 Daemon-CodeReview", summary, ...general.map((i) => `- [${i.severity}] ${i.file}: ${i.message}`)]
    .filter(Boolean)
    .join("\n\n");

  const post = (body: Record<string, unknown>) =>
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const full = {
    commit_id: commitSha,
    body: generalBody || summary,
    event: "COMMENT",
    comments,
  };

  let res = await post(full);
  if (res.status === 422 && comments.length) {
    // Linha alucinada fora da diff derruba o review inteiro — reenvia só com o corpo geral.
    console.warn("[GitCommenter] 422 com inline comments, reenviando só com body geral");
    res = await post({ commit_id: commitSha, body: generalBody || summary, event: "COMMENT" });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `GitHub API HTTP ${res.status}: ${text.slice(0, 500)}` };
  }
  return { ok: true };
}
