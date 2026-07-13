import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pg } from "../infra/postgres";
import { nimChat, extractJson } from "./nim-client";
import { collectGitContext, ProjectRow } from "./git-collector";
import { postReviewComments, CodeReviewIssue } from "./git-commenter";

const BRAIN_PATH = "G:\\Meu Drive\\LLM-Brain\\active-context.md";
const MODEL = process.env.LINTER_MODEL || "minimax-m3";

interface CodeReviewResult {
  score: number;
  summary: string;
  issues: CodeReviewIssue[];
  refactors: Array<{ file: string; description: string; code_before: string; code_after: string }>;
}

function systemPrompt(displayName: string): string {
  return `Você é o Daemon-CodeReview, engenheiro sênior revisando código do projeto ${displayName}.
Responda APENAS com JSON válido no schema:
{
  "score": <0-10>,
  "summary": "<resumo técnico 2-3 frases>",
  "issues": [{
    "file": "<path>",
    "line": <int ou null>,
    "severity": "critical|warning|info",
    "category": "bug|security|performance|style|debt",
    "message": "<descrição>",
    "suggestion": "<código ou ação corretiva>"
  }],
  "refactors": [{
    "file": "<path>",
    "description": "<o que refatorar e por quê>",
    "code_before": "<trecho atual>",
    "code_after": "<trecho sugerido>"
  }]
}`;
}

function coerceResult(raw: string): CodeReviewResult {
  const o = JSON.parse(extractJson(raw));
  return {
    score: Number.isFinite(o.score) ? Math.max(0, Math.min(10, o.score)) : 0,
    summary: typeof o.summary === "string" ? o.summary : "",
    issues: Array.isArray(o.issues) ? o.issues : [],
    refactors: Array.isArray(o.refactors) ? o.refactors : [],
  };
}

async function getRecentHandoffs(slug: string): Promise<string> {
  try {
    const { rows } = await pg.query(
      `select lifecycle_status, payload, created_at from handoffs
       where project = $1 order by created_at desc limit 5`,
      [slug]
    );
    return rows
      .map((r) => `[${r.created_at}] ${r.lifecycle_status}: ${r.payload?.pending_action_item ?? ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

function getBrainSnippet(): string {
  try {
    return fs.readFileSync(BRAIN_PATH, "utf8").slice(0, 3000);
  } catch {
    return "";
  }
}

/** Executa o ciclo completo de code review autônomo para um projeto do registry. */
export async function runCodeReviewForProject(project: ProjectRow): Promise<{ ok: boolean; reportId?: number; error?: string }> {
  try {
    const git = await collectGitContext(project);
    if (!git.diff.trim()) {
      return { ok: false, error: "diff vazio — nada para revisar" };
    }

    const existing = await pg.query(
      `select id from codereview_reports where project_slug = $1 and commit_sha = $2 limit 1`,
      [project.slug, git.commitSha]
    );
    if (existing.rows.length) {
      return { ok: false, error: `commit ${git.commitSha} já revisado (report #${existing.rows[0].id})` };
    }

    const [handoffs, brainSnippet] = [await getRecentHandoffs(project.slug), getBrainSnippet()];

    const userPayload = [
      `COMMIT: ${git.commitSha} | BRANCH: ${git.branch}`,
      `ARQUIVOS ALTERADOS:\n${git.changedFiles.join("\n")}`,
      `COMMITS RECENTES:\n${git.commits.join("\n")}`,
      handoffs ? `HANDOFFS RECENTES DO PROJETO:\n${handoffs}` : "",
      brainSnippet ? `CONTEXTO ATIVO (LLM-Brain):\n${brainSnippet}` : "",
      `DIFF:\n${git.diff}`,
    ].filter(Boolean).join("\n\n---\n\n");

    const raw = await nimChat(
      [
        { role: "system", content: systemPrompt(project.display_name) },
        { role: "user", content: userPayload },
      ],
      { jsonMode: true }
    );

    const result = coerceResult(raw);

    const { rows } = await pg.query(
      `insert into codereview_reports
        (project_slug, commit_sha, pr_number, pr_url, score, issues, summary, refactors, diff_lines, model_used)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id`,
      [
        project.slug, git.commitSha, git.openPrNumber ?? null, git.openPrUrl ?? null,
        result.score, JSON.stringify(result.issues), result.summary, JSON.stringify(result.refactors),
        git.diff.split("\n").length, MODEL,
      ]
    );
    const reportId = rows[0].id;

    if (git.openPrNumber && project.git_owner && project.git_repo) {
      const commented = await postReviewComments(
        project.git_owner, project.git_repo, git.openPrNumber, git.commitSha, result.issues, result.summary
      );
      if (commented.ok) {
        await pg.query(`update codereview_reports set pr_commented = true where id = $1`, [reportId]);
      } else {
        console.error(`[CodeReview] falha ao comentar PR #${git.openPrNumber}:`, commented.error);
      }
    }

    await pg.query(
      `insert into outbox (aggregate_id, event_type, payload)
       values ($1, 'codereview.report', $2)`,
      [randomUUID(), {
        project: project.slug,
        reportId,
        score: result.score,
        summary: result.summary,
        issuesCount: result.issues.length,
        prUrl: git.openPrUrl ?? null,
      }]
    );

    return { ok: true, reportId };
  } catch (e) {
    console.error(`[CodeReview] falha no projeto ${project.slug}:`, (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}
