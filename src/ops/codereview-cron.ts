import { pg } from "../infra/postgres";
import { runCodeReviewForProject } from "../hermes/codereview-agent";
import { runAttack } from "../hermes/fix-agent";
import { ProjectRow } from "../hermes/git-collector";

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
export async function runCodeReviewForSlug(slug: string, modelOverride?: string) {
  const { rows } = await pg.query<ProjectRow>(
    `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model
     from handoff_projects where slug = $1`,
    [slug]
  );
  if (!rows.length) return { ok: false, error: `Projeto "${slug}" não encontrado` };
  const project = modelOverride ? { ...rows[0], codereview_model: modelOverride } : rows[0];
  return runCodeReviewForProject(project);
}

const attackLocks = new Set<string>(); // slugs com ataque em curso NESTE processo — bloqueia re-entrada por clique duplicado/reload

/** Check síncrono pro endpoint HTTP responder 409 real (não fire-and-forget cego). */
export function isAttacking(slug: string): boolean {
  return attackLocks.has(slug);
}

/** Ataca o último report (ou reportId específico) de um projeto. Ao final, re-dispara o
 *  review sobre o PR de correção criado — fecha o ciclo review→fix→review.
 *  Lock em duas camadas: em memória (reentrada rápida) + linha 'running' na tabela
 *  codereview_attacks (sobrevive a restart/múltiplas réplicas). */
export async function runAttackForSlug(slug: string, opts: { reportId?: number; model?: string; reviewAfter?: boolean } = {}) {
  // Checagem + aquisição SÍNCRONAS (sem await entre elas) — fecha a janela de corrida
  // entre duas chamadas concorrentes que passariam ambas por um check assíncrono.
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

    const { rows } = await pg.query<ProjectRow & { display_name: string; attack_model: string | null }>(
      `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model, attack_model
       from handoff_projects where slug = $1`,
      [slug]
    );
    if (!rows.length) return { ok: false, error: `Projeto "${slug}" não encontrado` };

    const result = await runAttack({ project: rows[0], reportId: opts.reportId, model: opts.model });

    if (result.ok && opts.reviewAfter !== false) {
      // Aguarda o review pós-ataque DENTRO do lock — evita que um segundo ataque dispare
      // sobre o mesmo PR antes do ciclo anterior fechar (foi a causa da corrida de PRs duplicados).
      try {
        const r = await runCodeReviewForSlug(slug);
        if (r.ok) console.log(`[FixAgent] ciclo fechado — review pós-ataque: report #${r.reportId}`);
        else console.warn(`[FixAgent] review pós-ataque falhou: ${r.error}`);
      } catch (e) {
        console.error("[FixAgent] review pós-ataque:", (e as Error).message);
      }
    }
    return result;
  } finally {
    attackLocks.delete(slug);
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

      // Ciclo autônomo: attack_auto ataca o último report no horário configurado e
      // re-dispara o review sobre o PR de correção (reviewAfter default).
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
