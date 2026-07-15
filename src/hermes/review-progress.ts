// Progresso em memória do Daemon-CodeReview por projeto — mesmo padrão do current_step
// dos attacks, mas sem persistir em tabela: review é single-shot, não precisa sobreviver
// a um restart do processo (se cair, o usuário só reroda).
type ReviewStatus = "running" | "done" | "failed";

interface ReviewProgress {
  status: ReviewStatus;
  step: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  reportId?: number;
}

const progress = new Map<string, ReviewProgress>();

export function startReview(slug: string) {
  progress.set(slug, { status: "running", step: "iniciando…", error: null, startedAt: new Date().toISOString(), finishedAt: null });
}

export function setReviewStep(slug: string, step: string) {
  const p = progress.get(slug);
  if (p && p.status === "running") p.step = step;
}

export function finishReview(slug: string, result: { ok: boolean; reportId?: number; error?: string }) {
  const p = progress.get(slug);
  if (!p) return;
  p.status = result.ok ? "done" : "failed";
  p.step = result.ok ? "concluído" : `falhou: ${result.error || "erro desconhecido"}`;
  p.error = result.ok ? null : result.error || "erro desconhecido";
  p.reportId = result.reportId;
  p.finishedAt = new Date().toISOString();
}

export function getReviewProgress(slug: string): ReviewProgress | null {
  return progress.get(slug) || null;
}

export function getAllReviewProgress(): Record<string, ReviewProgress> {
  return Object.fromEntries(progress.entries());
}
