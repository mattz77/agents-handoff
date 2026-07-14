// Daemon-FixAgent: "Atacar PR". Pega o último report de code review de um projeto,
// corrige as issues uma a uma via NIM (search/replace) e abre um PR de correção.
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

/** Ataca o report: branch nova, um commit por issue corrigida, PR high-level no final. */
export async function runAttack(opts: {
  project: ProjectRow & { display_name: string };
  reportId?: number;
  model?: string;
}): Promise<{ ok: boolean; attackId?: number; prUrl?: string; error?: string }> {
  const { project } = opts;
  const model = opts.model || (project as any).attack_model || project.codereview_model || MODEL;

  const { rows: reports } = await pg.query(
    opts.reportId
      ? `select * from codereview_reports where id = $1 and project_slug = $2`
      : `select * from codereview_reports where project_slug = $2 and ($1::int is null) order by created_at desc limit 1`,
    [opts.reportId ?? null, project.slug]
  );
  if (!reports.length) return { ok: false, error: "Nenhum report de code review encontrado para atacar" };
  const report = reports[0];
  const issues: CodeReviewIssue[] = Array.isArray(report.issues) ? report.issues : JSON.parse(report.issues || "[]");
  if (!issues.length) return { ok: false, error: `Report #${report.id} não tem issues abertas` };

  const { git_owner: owner, git_repo: repo } = project;
  if (!owner || !repo) return { ok: false, error: `Projeto ${project.slug} sem git_owner/git_repo` };

  const { rows: attackRows } = await pg.query(
    `insert into codereview_attacks (project_slug, report_id, model_used, issues_total)
     values ($1,$2,$3,$4) returning id`,
    [project.slug, report.id, model, issues.length]
  );
  const attackId = attackRows[0].id;

  try {
    // Base do ataque: branch do PR aberto do report, senão default branch.
    let baseBranch = project.default_branch;
    if (report.pr_number) {
      const pr = await gh(`/repos/${owner}/${repo}/pulls/${report.pr_number}`).catch(() => null);
      if (pr?.head?.ref && pr.state === "open") baseBranch = pr.head.ref;
    }
    const baseRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
    const baseSha = baseRef.object.sha;

    const branch = `fix/codereview-report-${report.id}-${Date.now().toString(36)}`;
    await gh(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });

    const log: AttackLogEntry[] = [];
    const fixedDescriptions: string[] = [];
    let fixed = 0;

    for (const issue of issues) {
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

        const raw = await nimChat(
          [
            { role: "system", content: fixSkill(project.display_name) },
            {
              role: "user",
              content: `ISSUE:\n${JSON.stringify(issue, null, 2)}\n\nARQUIVO ${issue.file} (conteúdo atual completo):\n${content}`,
            },
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

        await gh(`/repos/${owner}/${repo}/contents/${issue.file}`, {
          method: "PUT",
          body: JSON.stringify({
            message: `fix(codereview): ${issue.file}${issue.line != null ? `:${issue.line}` : ""} — ${issue.message.slice(0, 60)}\n\nReport #${report.id} [${issue.severity}/${issue.category}]`,
            content: b64encode(applied.content),
            sha: fileMeta.sha,
            branch,
          }),
        });

        fixed++;
        entry.status = "fixed";
        entry.detail = `${fix.edits.length} edit(s) aplicado(s)`;
        fixedDescriptions.push(`${issue.file}${issue.line != null ? `:${issue.line}` : ""} — [${issue.severity}] ${issue.message}`);
        log.push(entry);
      } catch (e) {
        entry.detail = (e as Error).message.slice(0, 200);
        log.push(entry);
      }
      await pg.query(`update codereview_attacks set issues_fixed = $2, log = $3 where id = $1`, [
        attackId, fixed, JSON.stringify(log),
      ]);
    }

    if (fixed === 0) {
      // Nada corrigido — apaga a branch órfã e encerra.
      await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => {});
      await pg.query(
        `update codereview_attacks set status = 'failed', error = $2, log = $3, finished_at = now() where id = $1`,
        [attackId, "nenhuma issue corrigida (tudo skipped/error)", JSON.stringify(log)]
      );
      return { ok: false, attackId, error: "Nenhuma issue corrigida — ver log do ataque" };
    }

    // Descrição high-level do PR via skill pr-highlevel-creator.
    let prBody: string;
    try {
      prBody = await nimChat(
        [
          { role: "system", content: prSkill() },
          { role: "user", content: `Correções aplicadas (report #${report.id}, projeto ${project.display_name}):\n${fixedDescriptions.join("\n")}` },
        ],
        { model }
      );
    } catch {
      prBody = `## Summary\nCorreções automáticas do Daemon-FixAgent para o report #${report.id}.\n\n## Changes\n${fixedDescriptions.map((d) => `- ${d}`).join("\n")}`;
    }
    prBody += `\n\n---\n_Gerado pelo Daemon-FixAgent (modelo ${model}) — attack #${attackId}, report #${report.id}._`;

    const pr = await gh(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `fix(codereview): ${fixed} correção(ões) do report #${report.id} — ${project.display_name}`,
        head: branch,
        base: baseBranch,
        body: prBody,
      }),
    });

    await pg.query(
      `update codereview_attacks set status = 'done', branch = $2, pr_url = $3, issues_fixed = $4, log = $5, finished_at = now() where id = $1`,
      [attackId, branch, pr.html_url, fixed, JSON.stringify(log)]
    );

    return { ok: true, attackId, prUrl: pr.html_url };
  } catch (e) {
    const msg = (e as Error).message;
    await pg.query(
      `update codereview_attacks set status = 'failed', error = $2, finished_at = now() where id = $1`,
      [attackId, msg.slice(0, 500)]
    );
    console.error(`[FixAgent] ataque #${attackId} falhou:`, msg);
    return { ok: false, attackId, error: msg };
  }
}
