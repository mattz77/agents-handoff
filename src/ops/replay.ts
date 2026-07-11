import { redis } from "../infra/redis";

const STREAM = "handoff:stream";
const DLQ = "handoff:dlq";

export interface ReplayResult {
  ok: boolean;
  dlqId: string;
  newStreamId?: string;
  taskId?: string;
  error?: string;
}

/**
 * Reinjeta uma entrada da DLQ de volta no stream principal.
 * - Restaura o lifecycle_status original (preservado em _dlq_original_status)
 * - Zera attempt para 1 (novo ciclo de retry)
 * - Remove metadados de DLQ
 * - Remove da DLQ apenas após reenfileirar com sucesso (XADD → XDEL)
 */
export async function replayFromDlq(dlqId: string): Promise<ReplayResult> {
  const entries = (await redis.xrange(DLQ, dlqId, dlqId)) as [string, string[]][];
  if (!entries.length) {
    return { ok: false, dlqId, error: "Entrada não encontrada na DLQ" };
  }

  const fields = entries[0][1];
  const idx = fields.indexOf("data");
  const raw = idx >= 0 ? fields[idx + 1] : fields[1];

  let env: any;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, dlqId, error: "Payload da DLQ inválido (JSON)" };
  }

  const restoredStatus = env._dlq_original_status ?? env.lifecycle_status;
  const { _dlq_reason, _dlq_at, _dlq_original_status, ...clean } = env;

  const replayed = {
    ...clean,
    lifecycle_status: restoredStatus,
    attempt: 1,
    _replayed_from_dlq: dlqId,
    _replayed_at: new Date().toISOString(),
  };

  try {
    const newStreamId = await redis.xadd(
      STREAM,
      "MAXLEN",
      "~",
      100_000,
      "*",
      "data",
      JSON.stringify(replayed)
    );
    // só remove da DLQ depois de garantir o reenfileiramento
    await redis.xdel(DLQ, dlqId);
    return { ok: true, dlqId, newStreamId: newStreamId ?? undefined, taskId: replayed.task_id };
  } catch (e) {
    return { ok: false, dlqId, error: (e as Error)?.message ?? String(e) };
  }
}
