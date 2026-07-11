import { pg } from "../infra/postgres";
import { runCodeReviewForProject } from "../hermes/codereview-agent";
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
    `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch
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

/** Roda o ciclo para um único projeto (trigger manual). */
export async function runCodeReviewForSlug(slug: string) {
  const { rows } = await pg.query<ProjectRow>(
    `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch
     from handoff_projects where slug = $1`,
    [slug]
  );
  if (!rows.length) return { ok: false, error: `Projeto "${slug}" não encontrado` };
  return runCodeReviewForProject(rows[0]);
}

// Agendador nativo: checa a cada minuto se algum projeto bate com seu horário configurado.
export function startCodeReviewCron() {
  console.log("🕒 Cron de Code Review (Minimax M3) iniciado.");
  setInterval(async () => {
    try {
      const now = new Date();
      const { rows } = await pg.query<ProjectRow & { codereview_schedule: string }>(
        `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_schedule
         from handoff_projects where codereview_enabled = true`
      );
      const due = rows.filter((p) => matchesSchedule(p.slug, p.codereview_schedule, now));
      await Promise.allSettled(due.map((p) => runCodeReviewForProject(p)));
    } catch (e) {
      console.error("[CodeReview Cron] erro no tick:", (e as Error).message);
    }
  }, 60 * 1000);
}
