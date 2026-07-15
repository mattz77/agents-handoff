import { pg } from "../infra/postgres";
import { runCodeReviewForProject } from "../hermes/codereview-agent";
import { runAttack } from "../hermes/fix-agent";
import { runVerify } from "../hermes/verify-agent";
import { runCiFix } from "../hermes/ci-fix-agent";
import { ProjectRow } from "../hermes/git-collector";
import { CodeReviewIssue } from "../hermes/git-commenter";
import { startReview, finishReview } from "../hermes/review-progress";

const lastFired = new Map<string, string>(); // slug -> "YYYY-MM-DD HH:mm" (BRT) do último disparo

function brtParts(now: Date): { h: number; m: number; day: string } {
  const brt = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day = brt.toISOString().slice(0, 10);
  return { h: brt.getHours(), m: brt.getMinutes(), day };
}

function matchesSchedule(slug: string, schedule: string, now: Date): boolean {
  const [h, m] = schedule.split(":").map(Number);
  const brt = brtParts(now);
  if (brt.h !== h || brt.m !== m) return false;
  const key = `${brt.day} ${h}:${m}`;
  if (lastFired.get(slug) === key) return false; // já disparou neste minuto (guard drift do setInterval)
  lastFired.set(slug, key);
  return true;
}

export async function runCodeReviewCycle() {
  console.log("[CodeReview Cron] Iniciando ciclo de Code Review autônomo...");
  const { rows } = await pg.query<ProjectRow>(
    `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model
     from handoff_projects where codereview_enabled = true`
  );

  const results = await Promise.allSettled(rows.map((p) => runCodeReviewForProject(p)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.ok) {
      console.log(`[CodeReview Cron] ${rows[i].slug} → report #${r.value.reportId}`);
    } else {
      const err = r.status === "rejected" ? r.reason : r.value.error;
      console.error(`[CodeReview Cron] ${rows[i].slug} falhou:`, err);
    }
  });
  console.log("[CodeReview Cron] Ciclo completo.");
}

/** Roda o ciclo para um único projeto (trigger manual). `modelOverride` vale só para esta chamada, não persiste. */
export async function runCodeReviewForSlug(slug: string, modelOverride?: string, force = false) {
  const { rows } = await pg.query<ProjectRow>(
    `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model
     from handoff_projects where slug = $1`,
    [slug]
  );
  if (!rows.length) return { ok: false, error: `Projeto "${slug}" não encontrado` };
  const project = modelOverride ? { ...rows[0], codereview_model: modelOverride } : rows[0];
  startReview(slug);
  const result = await runCodeReviewForProject(project, force);
  finishReview(slug, result);
  return result;
}

const attackLocks = new Set<string>(); // slugs com ciclo (ataque+verificação, todas as rodadas) em curso NESTE processo

/** Check síncrono pro endpoint HTTP responder 409 real (não fire-and-forget cego). */
export function isAttacking(slug: string): boolean {
  return attackLocks.has(slug);
}

async function notifyCycleDone(slug: string, payload: Record<string, unknown>) {
  await pg.query(
    `insert into outbox (aggregate_id, event_type, payload) values ($1, 'codereview.cycle_done', $2)`,
    [`cycle-${slug}-${Date.now()}`, { project: slug, ...payload }]
  ).catch((e) => console.error("[FixAgent] falha ao enfileirar notificação de ciclo:", e.message));
}

type ProjectForCycle = ProjectRow & {
  display_name: string;
  attack_model: string | null;
  verify_model: string | null;
  max_cycle_rounds: number | null;
};

/** Ciclo completo review→fix→verify→(fix de novo se reprovado)→... até consenso ou limite de
 *  rodadas. Lock cobre TODO o ciclo (todas as rodadas), fechando a corrida que gerava PRs
 *  duplicados quando o usuário reclicava "Atacar PR" antes do ciclo anterior fechar. */
export async function runAttackForSlug(slug: string, opts: { reportId?: number; model?: string; verifyModel?: string } = {}) {
  if (attackLocks.has(slug)) {
    return { ok: false, error: `Já existe um ataque em curso para "${slug}" — aguarde terminar antes de disparar outro.` };
  }
  attackLocks.add(slug);
  try {
    const { rows: running } = await pg.query(
      `select id from codereview_attacks where project_slug = $1 and status = 'running' limit 1`,
      [slug]
    );
    if (running.length) {
      return { ok: false, error: `Ataque #${running[0].id} já em curso para "${slug}" (outra réplica) — aguarde terminar.` };
    }

    const { rows } = await pg.query<ProjectForCycle>(
      `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch,
              codereview_model, attack_model, verify_model, max_cycle_rounds
       from handoff_projects where slug = $1`,
      [slug]
    );
    if (!rows.length) return { ok: false, error: `Projeto "${slug}" não encontrado` };
    const project = rows[0];
    const maxRounds = Math.max(1, project.max_cycle_rounds ?? 3);

    let round = 1;
    let branch: string | undefined;
    let prNumber: number | undefined;
    let prUrl: string | undefined;
    let cycleId: number | undefined;
    let issues: CodeReviewIssue[] | undefined;
    let lastAttackId: number | undefined;

    // Snapshot das issues originais do report — usado pelo verifier em toda rodada
    // (o verifier precisa saber o que tinha que ser corrigido, não só o que mudou por último).
    let originalIssues: CodeReviewIssue[] = [];
    if (opts.reportId) {
      const { rows: rep } = await pg.query(`select issues from codereview_reports where id = $1`, [opts.reportId]);
      originalIssues = rep[0] ? (Array.isArray(rep[0].issues) ? rep[0].issues : JSON.parse(rep[0].issues || "[]")) : [];
    } else {
      const { rows: rep } = await pg.query(
        `select issues from codereview_reports where project_slug = $1 order by created_at desc limit 1`,
        [slug]
      );
      originalIssues = rep[0] ? (Array.isArray(rep[0].issues) ? rep[0].issues : JSON.parse(rep[0].issues || "[]")) : [];
    }

    while (round <= maxRounds) {
      const attackResult = await runAttack({
        project,
        reportId: round === 1 ? opts.reportId : undefined,
        issues: round === 1 ? undefined : issues,
        existingBranch: branch,
        existingPrNumber: prNumber,
        existingPrUrl: prUrl,
        round,
        cycleId,
        model: opts.model,
      });

      if (!attackResult.ok) {
        if (lastAttackId) await notifyCycleDone(slug, { status: "failed", round, error: attackResult.error, prUrl });
        return attackResult;
      }
      lastAttackId = attackResult.attackId;
      branch = attackResult.branch;
      prNumber = attackResult.prNumber;
      prUrl = attackResult.prUrl;
      if (!cycleId) cycleId = attackResult.attackId;

      const verifyResult = await runVerify({
        project,
        attackId: attackResult.attackId!,
        originalIssues,
        model: opts.verifyModel,
      });

      if (!verifyResult.ok) {
        // Verificação falhou tecnicamente (erro de modelo/API) — não é reprovação, é
        // impossibilidade de julgar. Marca needs_human pra alguém olhar manualmente.
        await pg.query(`update codereview_attacks set verify_status = 'needs_human', current_step = $2 where id = $1`, [
          attackResult.attackId, `verificação indisponível: ${verifyResult.error}`,
        ]);
        await notifyCycleDone(slug, { status: "needs_human", round, prUrl, reason: `verificação falhou: ${verifyResult.error}` });
        return { ok: true, attackId: attackResult.attackId, prUrl, needsHuman: true, reason: verifyResult.error };
      }

      if (verifyResult.verdict === "approved") {
        await pg.query(`update codereview_attacks set current_step = 'ciclo concluído — aprovado, pronto pra merge' where id = $1`, [attackResult.attackId]);
        await notifyCycleDone(slug, { status: "approved", round, prUrl });
        return { ok: true, attackId: attackResult.attackId, prUrl, converged: true };
      }

      if (round >= maxRounds) {
        await pg.query(`update codereview_attacks set verify_status = 'needs_human', current_step = 'limite de rodadas atingido — precisa de revisão humana' where id = $1`, [attackResult.attackId]);
        await notifyCycleDone(slug, { status: "needs_human", round, prUrl, reason: `${maxRounds} rodadas sem consenso` });
        return { ok: true, attackId: attackResult.attackId, prUrl, needsHuman: true, reason: `${maxRounds} rodadas sem consenso` };
      }

      issues = verifyResult.newIssues;
      if (!issues || issues.length === 0) {
        // Verifier reprovou mas não listou o que falta — sem alvo pra próxima rodada, para aqui.
        await pg.query(`update codereview_attacks set verify_status = 'needs_human', current_step = 'verifier reprovou sem apontar issues novas' where id = $1`, [attackResult.attackId]);
        await notifyCycleDone(slug, { status: "needs_human", round, prUrl, reason: "verifier reprovou sem listar issues novas" });
        return { ok: true, attackId: attackResult.attackId, prUrl, needsHuman: true, reason: "verifier reprovou sem issues novas" };
      }
      round++;
    }

    return { ok: true, attackId: lastAttackId, prUrl, needsHuman: true, reason: "limite de rodadas" };
  } finally {
    attackLocks.delete(slug);
  }
}

const ciFixLocks = new Set<string>();

/** Corrige a falha de CI do PR aberto do projeto (trigger manual via endpoint). */
export async function runCiFixForSlug(slug: string, opts: { prNumber?: number; model?: string } = {}) {
  if (ciFixLocks.has(slug)) {
    return { ok: false, error: `CI-fix já em curso para "${slug}" — aguarde terminar.` };
  }
  ciFixLocks.add(slug);
  try {
    const { rows } = await pg.query<ProjectRow & { display_name: string; attack_model: string | null }>(
      `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch,
              codereview_model, attack_model
       from handoff_projects where slug = $1`,
      [slug]
    );
    if (!rows.length) return { ok: false, error: `Projeto "${slug}" não encontrado` };
    return await runCiFix({ project: rows[0], prNumber: opts.prNumber, model: opts.model });
  } finally {
    ciFixLocks.delete(slug);
  }
}

// Agendador nativo: checa a cada minuto se algum projeto bate com seu horário configurado.
export function startCodeReviewCron() {
  console.log("🕒 Cron de Code Review (Daemon-CodeReview) iniciado.");
  setInterval(async () => {
    try {
      const now = new Date();
      const { rows } = await pg.query<ProjectRow & { codereview_schedule: string }>(
        `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model, codereview_schedule
         from handoff_projects where codereview_enabled = true and codereview_auto = true`
      );
      const due = rows.filter((p) => matchesSchedule(p.slug, p.codereview_schedule, now));
      await Promise.allSettled(due.map((p) => runCodeReviewForProject(p)));

      // Ciclo autônomo: attack_auto ataca o último report no horário configurado, roda o
      // ciclo review<->fix completo (com verificação) até consenso ou limite de rodadas.
      const { rows: attackRows } = await pg.query<ProjectRow & { attack_schedule: string }>(
        `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model, attack_model, attack_schedule
         from handoff_projects where codereview_enabled = true and attack_auto = true`
      );
      const attackDue = attackRows.filter((p) => matchesSchedule(`attack:${p.slug}`, p.attack_schedule || "03:00", now));
      await Promise.allSettled(attackDue.map((p) => runAttackForSlug(p.slug)));
    } catch (e) {
      console.error("[CodeReview Cron] erro no tick:", (e as Error).message);
    }
  }, 60 * 1000);
}
