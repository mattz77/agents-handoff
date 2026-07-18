// Daemon-Verifier: 3º agente do ciclo. Audita o PR que o Daemon-FixAgent produziu contra
// as issues originais, posta um review no GitHub (approve ou request changes) e, se
// reprovar, devolve as issues que faltam pro fix-agent atacar de novo no MESMO PR.
import { pg } from "../infra/postgres";
import { getGithubToken } from "../infra/postgres";
import { nimChat, extractJson } from "./nim-client";
import { verifySkill } from "./skills";
import { CodeReviewIssue } from "./git-commenter";
import { ProjectRow } from "./git-collector";

const MODEL = process.env.LINTER_MODEL || "minimaxai/minimax-m3";

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

interface VerifyResult {
  verdict: "approved" | "changes_requested";
  comment: string;
  resolvedCount: number;
  newIssues: CodeReviewIssue[];
}

export async function runVerify(opts: {
  project: ProjectRow & { display_name: string; verify_model?: string | null };
  attackId: number;
  originalIssues: CodeReviewIssue[];
  model?: string;
}): Promise<{ ok: boolean; verdict?: "approved" | "changes_requested"; newIssues?: CodeReviewIssue[]; error?: string }> {
  const { project, attackId } = opts;
  const model = opts.model || project.verify_model || MODEL;

  await pg.query(`update codereview_attacks set current_step = $2 where id = $1`, [attackId, "aguardando verificação do Daemon-Verifier…"]);

  const { rows } = await pg.query(`select branch, pr_number, pr_url, log from codereview_attacks where id = $1`, [attackId]);
  if (!rows.length || !rows[0].pr_number) return { ok: false, error: "attack sem PR associado — nada pra verificar" };
  const { pr_number: prNumber, log: attackLog } = rows[0];
  const { git_owner: owner, git_repo: repo } = project;
  if (!owner || !repo) return { ok: false, error: `Projeto ${project.slug} sem git_owner/git_repo` };

  try {
    // PR já mergeado/fechado (ex.: humano aprovou manualmente entre rodadas) — nada a verificar,
    // postar review ou commitar nele só geraria erro 422 do GitHub. Encerra o ciclo como aprovado.
    const prInfo = await gh(`/repos/${owner}/${repo}/pulls/${prNumber}`).catch(() => null);
    if (prInfo?.merged || prInfo?.state === "closed") {
      await pg.query(
        `update codereview_attacks set verify_status = 'approved', current_step = $2 where id = $1`,
        [attackId, prInfo.merged ? "PR já mergeado — ciclo encerrado" : "PR já fechado — ciclo encerrado"]
      );
      return { ok: true, verdict: "approved", newIssues: [] };
    }

    await pg.query(`update codereview_attacks set current_step = $2 where id = $1`, [attackId, `Daemon-Verifier (${model}) lendo diff do PR #${prNumber}…`]);
    const diff = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: { Authorization: `Bearer ${await getGithubToken()}`, Accept: "application/vnd.github.v3.diff" },
    }).then((r) => (r.ok ? r.text() : ""));

    await pg.query(`update codereview_attacks set current_step = $2, verify_model = $3 where id = $1`, [attackId, "Daemon-Verifier avaliando correções…", model]);
    const raw = await nimChat(
      [
        { role: "system", content: verifySkill(project.display_name) },
        {
          role: "user",
          content: `ISSUES ORIGINAIS A RESOLVER:\n${JSON.stringify(opts.originalIssues, null, 2)}\n\nLOG DO FIX-AGENT (o que ele fez com cada issue, incluindo justificativas de skip):\n${JSON.stringify(attackLog || [], null, 2)}\n\nDIFF ATUAL DO PR #${prNumber}:\n${diff.slice(0, 60000)}`,
        },
      ],
      { jsonMode: true, model }
    );
    const result: VerifyResult = JSON.parse(extractJson(raw));

    await pg.query(`update codereview_attacks set current_step = $2 where id = $1`, [attackId, `postando review (${result.verdict}) no PR #${prNumber}…`]);
    // GITHUB_TOKEN é do próprio dono do PR (mesma conta que o fix-agent usa pra abrir o PR) —
    // GitHub bloqueia auto-aprovação com 422 "You can't approve your own pull request diff" se
    // event="APPROVE" for enviado aqui. Sempre comenta (COMMENT); a aprovação em si é decidida
    // pelo verify_status salvo no banco e pelo botão "Aprovar e Mergear" do painel, não pelo
    // estado de review do GitHub.
    await gh(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      body: JSON.stringify({
        body: `🤖 **Daemon-Verifier** (${model}) — ${result.verdict === "approved" ? "✅ aprovado" : "🔁 mudanças solicitadas"}\n\n${result.comment}`,
        event: "COMMENT",
      }),
    }).catch(async (e) => {
      console.warn("[Verifier] falha ao postar review:", e.message);
      await pg.query(`update codereview_attacks set verify_notes = $2 where id = $1`, [
        attackId, `${result.comment}\n\n⚠️ Comentário não foi postado no PR (falha na API do GitHub): ${e.message.slice(0, 200)}`,
      ]).catch(() => {});
    });

    await pg.query(
      `update codereview_attacks set verify_status = $2, verify_notes = $3, current_step = $4 where id = $1`,
      [attackId, result.verdict, result.comment, result.verdict === "approved" ? "aprovado pelo Daemon-Verifier" : "mudanças solicitadas — preparando próxima rodada"]
    );

    return { ok: true, verdict: result.verdict, newIssues: Array.isArray(result.newIssues) ? result.newIssues : [] };
  } catch (e) {
    const msg = (e as Error).message;
    await pg.query(`update codereview_attacks set current_step = $2 where id = $1`, [attackId, `erro na verificação: ${msg.slice(0, 150)}`]);
    console.error(`[Verifier] falha no attack #${attackId}:`, msg);
    return { ok: false, error: msg };
  }
}
