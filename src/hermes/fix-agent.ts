// Daemon-FixAgent: "Atacar PR". Pega issues (do último report, ou passadas direto pelo
// Daemon-Verifier numa rodada seguinte), corrige uma a uma via NIM (search/replace) e
// commita num PR — novo na 1ª rodada, ou o mesmo PR em rodadas seguintes do ciclo.
// Opera 100% via GitHub API — os repos não são montados no container.
import { pg } from "../infra/postgres";
import { getGithubToken } from "../infra/postgres";
import { nimChat, extractJson } from "./nim-client";
import { fixSkill, prSkill } from "./skills";
import { CodeReviewIssue } from "./git-commenter";
import { ProjectRow } from "./git-collector";

const MODEL = process.env.LINTER_MODEL || "minimaxai/minimax-m3";

interface AttackLogEntry {
  file: string;
  line: number | null;
  severity: string;
  status: "fixed" | "skipped" | "error";
  detail: string;
}

async function gh(path: string, init?: RequestInit): Promise<any> {
  const token = await getGithubToken();
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API HTTP ${res.status} em ${path}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

function b64decode(s: string): string {
  return Buffer.from(s, "base64").toString("utf8");
}
function b64encode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

interface FixEditResponse {
  skip: boolean;
  reason?: string;
  edits?: Array<{ search: string; replace: string }>;
}

function applyEdits(content: string, edits: Array<{ search: string; replace: string }>): { ok: boolean; content: string; error?: string } {
  let out = content;
  for (const e of edits) {
    if (!e.search || typeof e.replace !== "string") return { ok: false, content, error: "edit sem search/replace" };
    const first = out.indexOf(e.search);
    if (first === -1) return { ok: false, content, error: "search não encontrado no arquivo" };
    if (out.indexOf(e.search, first + 1) !== -1) return { ok: false, content, error: "search ambíguo (ocorre 2+ vezes)" };
    out = out.slice(0, first) + e.replace + out.slice(first + e.search.length);
  }
  return { ok: true, content: out };
}

async function setStep(attackId: number, step: string) {
  await pg.query(`update codereview_attacks set current_step = $2 where id = $1`, [attackId, step]).catch(() => {});
}

export interface RunAttackOpts {
  project: ProjectRow & { display_name: string; attack_model?: string | null };
  reportId?: number;         // rodada 1: pega issues do report
  issues?: CodeReviewIssue[]; // rodadas seguintes: issues vêm do Daemon-Verifier
  existingBranch?: string;    // rodadas seguintes: commita no mesmo branch/PR
  existingPrNumber?: number;
  existingPrUrl?: string;
  round?: number;
  cycleId?: number;
  model?: string;
}

/** Ataca um conjunto de issues: branch nova (ou existente), um commit por issue corrigida,
 *  PR novo (ou reaproveitado) no final. */
export async function runAttack(opts: RunAttackOpts): Promise<{ ok: boolean; attackId?: number; branch?: string; prNumber?: number; prUrl?: string; error?: string }> {
  const { project } = opts;
  const model = opts.model || project.attack_model || project.codereview_model || MODEL;
  const round = opts.round ?? 1;

  let issues: CodeReviewIssue[];
  let reportId: number | null = opts.reportId ?? null;

  if (opts.issues) {
    issues = opts.issues;
  } else {
    const { rows: reports } = await pg.query(
      reportId
        ? `select * from codereview_reports where id = $1 and project_slug = $2`
        : `select * from codereview_reports where project_slug = $2 and ($1::int is null) order by created_at desc limit 1`,
      [reportId, project.slug]
    );
    if (!reports.length) return { ok: false, error: "Nenhum report de code review encontrado para atacar" };
    reportId = reports[0].id;
    issues = Array.isArray(reports[0].issues) ? reports[0].issues : JSON.parse(reports[0].issues || "[]");
  }
  if (!issues.length) return { ok: false, error: `Nada para corrigir (0 issues)` };

  const { git_owner: owner, git_repo: repo } = project;
  if (!owner || !repo) return { ok: false, error: `Projeto ${project.slug} sem git_owner/git_repo` };

  const { rows: attackRows } = await pg.query(
    `insert into codereview_attacks (project_slug, report_id, model_used, issues_total, round, cycle_id, current_step, branch, pr_number, pr_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [project.slug, reportId, model, issues.length, round, opts.cycleId ?? null, "iniciando…",
     opts.existingBranch ?? null, opts.existingPrNumber ?? null, opts.existingPrUrl ?? null]
  );
  const attackId = attackRows[0].id;
  if (!opts.cycleId) await pg.query(`update codereview_attacks set cycle_id = $1 where id = $1`, [attackId]);

  try {
    let branch = opts.existingBranch;
    let baseBranch = project.default_branch;

    if (!branch) {
      await setStep(attackId, "criando branch de correção…");
      if (reportId) {
        const { rows: r } = await pg.query(`select pr_number from codereview_reports where id = $1`, [reportId]);
        if (r[0]?.pr_number) {
          const pr = await gh(`/repos/${owner}/${repo}/pulls/${r[0].pr_number}`).catch(() => null);
          if (pr?.head?.ref && pr.state === "open") baseBranch = pr.head.ref;
        }
      }
      const baseRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
      branch = `fix/codereview-report-${reportId ?? "cycle"}-${Date.now().toString(36)}`;
      await gh(`/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
      });
      await pg.query(`update codereview_attacks set branch = $2 where id = $1`, [attackId, branch]);
    }

    const log: AttackLogEntry[] = [];
    const fixedDescriptions: string[] = [];
    let fixed = 0;

    for (const [idx, issue] of issues.entries()) {
      const short = `${issue.file}${issue.line != null ? ":" + issue.line : ""}`;
      await setStep(attackId, `[${idx + 1}/${issues.length}] revisando ${short} com ${model}…`);
      const entry: AttackLogEntry = { file: issue.file, line: issue.line, severity: issue.severity, status: "error", detail: "" };
      try {
        const fileMeta = await gh(`/repos/${owner}/${repo}/contents/${issue.file}?ref=${branch}`).catch(() => null);
        if (!fileMeta || Array.isArray(fileMeta)) {
          entry.status = "skipped";
          entry.detail = "arquivo não encontrado na branch";
          log.push(entry);
          continue;
        }
        const content = b64decode(fileMeta.content);

        await setStep(attackId, `[${idx + 1}/${issues.length}] pedindo correção pro modelo (${short})…`);
        const raw = await nimChat(
          [
            { role: "system", content: fixSkill(project.display_name) },
            { role: "user", content: `ISSUE:\n${JSON.stringify(issue, null, 2)}\n\nARQUIVO ${issue.file} (conteúdo atual completo):\n${content}` },
          ],
          { jsonMode: true, model }
        );
        const fix: FixEditResponse = JSON.parse(extractJson(raw));

        if (fix.skip || !fix.edits?.length) {
          entry.status = "skipped";
          entry.detail = fix.reason || "modelo optou por não corrigir";
          log.push(entry);
          continue;
        }

        const applied = applyEdits(content, fix.edits);
        if (!applied.ok) {
          entry.status = "error";
          entry.detail = applied.error || "falha ao aplicar edits";
          log.push(entry);
          continue;
        }

        await setStep(attackId, `[${idx + 1}/${issues.length}] commitando ${short}…`);
        await gh(`/repos/${owner}/${repo}/contents/${issue.file}`, {
          method: "PUT",
          body: JSON.stringify({
            message: `fix(codereview): ${short} — ${issue.message.slice(0, 60)}\n\n${reportId ? `Report #${reportId}` : "Ciclo de verificação"} [${issue.severity}/${issue.category}]`,
            content: b64encode(applied.content),
            sha: fileMeta.sha,
            branch,
          }),
        });

        fixed++;
        entry.status = "fixed";
        entry.detail = `${fix.edits.length} edit(s) aplicado(s)`;
        fixedDescriptions.push(`${short} — [${issue.severity}] ${issue.message}`);
        log.push(entry);
      } catch (e) {
        entry.detail = (e as Error).message.slice(0, 200);
        log.push(entry);
      }
    }

    if (fixed === 0) {
      if (!opts.existingBranch) {
        await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => {});
      }
      await pg.query(
        `update codereview_attacks set status = 'failed', error = $2, log = $3, current_step = 'nenhuma issue corrigida', finished_at = now() where id = $1`,
        [attackId, "nenhuma issue corrigida (tudo skipped/error)", JSON.stringify(log)]
      );
      return { ok: false, attackId, error: "Nenhuma issue corrigida — ver log do ataque" };
    }

    let prNumber = opts.existingPrNumber;
    let prUrl = opts.existingPrUrl;

    if (!prNumber) {
      await setStep(attackId, "gerando descrição do PR…");
      let prBody: string;
      try {
        prBody = await nimChat(
          [
            { role: "system", content: prSkill() },
            { role: "user", content: `Correções aplicadas (projeto ${project.display_name}):\n${fixedDescriptions.join("\n")}` },
          ],
          { model }
        );
      } catch {
        prBody = `## Summary\nCorreções automáticas do Daemon-FixAgent.\n\n## Changes\n${fixedDescriptions.map((d) => `- ${d}`).join("\n")}`;
      }
      prBody += `\n\n---\n_Gerado pelo Daemon-FixAgent (modelo ${model}) — attack #${attackId}${reportId ? `, report #${reportId}` : ""}._`;

      await setStep(attackId, "abrindo PR…");
      const pr = await gh(`/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: `fix(codereview): ${fixed} correção(ões)${reportId ? ` do report #${reportId}` : ""} — ${project.display_name}`,
          head: branch,
          base: baseBranch,
          body: prBody,
        }),
      });
      prNumber = pr.number;
      prUrl = pr.html_url;
    } else {
      await setStep(attackId, `commit adicionado ao PR #${prNumber} (rodada ${round})…`);
    }

    await pg.query(
      `update codereview_attacks set status = 'done', branch = $2, pr_url = $3, pr_number = $4, issues_fixed = $5, log = $6, current_step = 'concluído — aguardando verificação', finished_at = now() where id = $1`,
      [attackId, branch, prUrl, prNumber, fixed, JSON.stringify(log)]
    );

    return { ok: true, attackId, branch, prNumber, prUrl };
  } catch (e) {
    const msg = (e as Error).message;
    await pg.query(
      `update codereview_attacks set status = 'failed', error = $2, current_step = 'erro', finished_at = now() where id = $1`,
      [attackId, msg.slice(0, 500)]
    );
    console.error(`[FixAgent] ataque #${attackId} falhou:`, msg);
    return { ok: false, attackId, error: msg };
  }
}
