import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pg } from "../infra/postgres";
import { nimChat, extractJson } from "./nim-client";
import { collectGitContext, ProjectRow } from "./git-collector";
import { postReviewComments, CodeReviewIssue } from "./git-commenter";
import { reviewSkill, reviewAuditSkill, RECOMMENDED_MODELS } from "./skills";
import { setReviewStep } from "./review-progress";

const BRAIN_PATH = "G:\\Meu Drive\\LLM-Brain\\active-context.md";
const MODEL = process.env.LINTER_MODEL || "minimax-m3";

interface CodeReviewResult {
  score: number;
  summary: string;
  issues: CodeReviewIssue[];
  refactors: Array<{ file: string; description: string; code_before: string; code_after: string }>;
}

const systemPrompt = reviewSkill;

function coerceResult(raw: string): CodeReviewResult {
  const o = JSON.parse(extractJson(raw));
  const allIssues: CodeReviewIssue[] = Array.isArray(o.issues) ? o.issues : [];
  // Anti-alucinação: issue sem evidência literal do diff é opinião, não finding — descarta.
  const issues = allIssues.filter((i) => typeof i.evidence === "string" && i.evidence.trim().length > 0);
  const dropped = allIssues.length - issues.length;
  if (dropped > 0) console.warn(`[CodeReview] ${dropped} issue(s) descartada(s) por falta de evidence`);
  return {
    score: Number.isFinite(o.score) ? Math.max(0, Math.min(10, o.score)) : 0,
    summary: typeof o.summary === "string" ? o.summary : "",
    issues,
    refactors: Array.isArray(o.refactors) ? o.refactors : [],
  };
}

/** 2º passe cético: auditor adversarial tenta derrubar cada finding antes de virar comentário.
 *  Falha do auditor não bloqueia o review — mantém as issues originais (fail-open). */
async function auditIssues(
  displayName: string,
  issues: CodeReviewIssue[],
  diff: string,
  fileTree: string[],
  reviewModel: string,
  verifyModel?: string | null
): Promise<CodeReviewIssue[]> {
  if (!issues.length) return issues;
  // Auditor não pode ser o mesmo modelo que gerou os findings — herda o viés.
  const auditModel = verifyModel
    || process.env.CODEREVIEW_AUDIT_MODEL
    || RECOMMENDED_MODELS.verify.find((m) => m !== reviewModel)
    || RECOMMENDED_MODELS.verify[0];
  try {
    const raw = await nimChat(
      [
        { role: "system", content: reviewAuditSkill(displayName) },
        {
          role: "user",
          content: [
            `ISSUES A AUDITAR (índices 0-based):\n${JSON.stringify(issues, null, 2)}`,
            fileTree.length ? `ÁRVORE DO REPO (paths existentes):\n${fileTree.join("\n")}` : "",
            `DIFF:\n${diff}`,
          ].filter(Boolean).join("\n\n---\n\n"),
        },
      ],
      { jsonMode: true, model: auditModel }
    );
    const o = JSON.parse(extractJson(raw));
    const kept: number[] = Array.isArray(o.kept) ? o.kept.filter((i: unknown) => Number.isInteger(i)) : [];
    const rejected: Array<{ index: number; reason: string }> = Array.isArray(o.rejected) ? o.rejected : [];
    for (const r of rejected) {
      console.warn(`[ReviewAuditor] issue #${r.index} derrubada (${auditModel}): ${r.reason}`);
    }
    // Sanidade: se o auditor devolveu índices inválidos ou derrubou tudo sem justificar, fail-open.
    const survivors = kept.filter((i) => i >= 0 && i < issues.length).map((i) => issues[i]);
    if (!survivors.length && !rejected.length) return issues;
    return survivors;
  } catch (e) {
    console.warn(`[ReviewAuditor] falha no passe de auditoria (${auditModel}), mantendo issues originais:`, (e as Error).message);
    return issues;
  }
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

/** Executa o ciclo completo de code review autônomo para um projeto do registry.
 *  `force` pula o dedupe por commit — usado pra comparar modelos no mesmo commit. */
export async function runCodeReviewForProject(project: ProjectRow, force = false): Promise<{ ok: boolean; reportId?: number; error?: string; alreadyReviewed?: boolean }> {
  try {
    setReviewStep(project.slug, "coletando diff e contexto do git…");
    const git = await collectGitContext(project);
    if (!git.diff.trim()) {
      return { ok: false, error: "diff vazio — nada para revisar" };
    }

    if (!force) {
      const existing = await pg.query(
        `select id from codereview_reports where project_slug = $1 and commit_sha = $2 limit 1`,
        [project.slug, git.commitSha]
      );
      if (existing.rows.length) {
        // Commit sem mudança desde o último review não é falha — é o estado estável esperado
        // (ex.: PR aberto sem commit novo). Devolve o report existente em vez de erro vermelho na UI.
        return { ok: true, reportId: existing.rows[0].id, alreadyReviewed: true };
      }
    }

    setReviewStep(project.slug, "reunindo contexto (handoffs, LLM-Brain)…");
    const [handoffs, brainSnippet] = [await getRecentHandoffs(project.slug), getBrainSnippet()];

    const userPayload = [
      `COMMIT: ${git.commitSha} | BRANCH: ${git.branch}`,
      `ARQUIVOS ALTERADOS:\n${git.changedFiles.join("\n")}`,
      git.fileTree.length
        ? `ÁRVORE DO REPO (todos os paths existentes — use para checar existência de arquivos/rotas antes de alegar ausência):\n${git.fileTree.join("\n")}`
        : "",
      `COMMITS RECENTES:\n${git.commits.join("\n")}`,
      handoffs ? `HANDOFFS RECENTES DO PROJETO:\n${handoffs}` : "",
      brainSnippet ? `CONTEXTO ATIVO (LLM-Brain):\n${brainSnippet}` : "",
      `DIFF:\n${git.diff}`,
    ].filter(Boolean).join("\n\n---\n\n");

    const modelUsed = project.codereview_model || MODEL;
    setReviewStep(project.slug, `pedindo análise pro modelo (${modelUsed})…`);
    const raw = await nimChat(
      [
        { role: "system", content: systemPrompt(project.display_name) },
        { role: "user", content: userPayload },
      ],
      { jsonMode: true, model: modelUsed }
    );

    const result = coerceResult(raw);

    if (result.issues.length) {
      setReviewStep(project.slug, `auditoria cética dos ${result.issues.length} finding(s)…`);
      const before = result.issues.length;
      result.issues = await auditIssues(
        project.display_name, result.issues, git.diff, git.fileTree,
        modelUsed, (project as { verify_model?: string | null }).verify_model
      );
      if (result.issues.length < before) {
        console.log(`[CodeReview] auditoria: ${before - result.issues.length}/${before} issue(s) derrubada(s) antes de postar`);
      }
    }

    setReviewStep(project.slug, "salvando relatório…");
    const { rows } = await pg.query(
      `insert into codereview_reports
        (project_slug, commit_sha, pr_number, pr_url, score, issues, summary, refactors, diff_lines, model_used)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id`,
      [
        project.slug, git.commitSha, git.openPrNumber ?? null, git.openPrUrl ?? null,
        result.score, JSON.stringify(result.issues), result.summary, JSON.stringify(result.refactors),
        git.diff.split("\n").length, modelUsed,
      ]
    );
    const reportId = rows[0].id;

    if (git.openPrNumber && project.git_owner && project.git_repo) {
      setReviewStep(project.slug, `comentando no PR #${git.openPrNumber}…`);
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
