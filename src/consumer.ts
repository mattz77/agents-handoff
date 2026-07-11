import { redis } from "./infra/redis";
import { HandoffEnvelope } from "./domain/handoff";

const STREAM = "handoff:stream";
const DLQ = "handoff:dlq";
const MAX_RETRIES = 5;
const CLAIM_IDLE_MS = 60_000; // reivindica pendentes ociosas há 60s

const backoffMs = (attempt: number) => Math.min(2 ** attempt * 1000, 60_000); // 2s,4s,8s...cap 60s

type Handler = (e: HandoffEnvelope) => Promise<void>;

export async function startConsumer(group: string, consumer: string, handle: Handler) {
  await redis.xgroup("CREATE", STREAM, group, "$", "MKSTREAM").catch((e) => {
    if (!/BUSYGROUP/.test(e.message)) throw e; // grupo já existe = ok
  });

  let cursor = "0-0";
  for (;;) {
    // 1) Reivindica mensagens órfãs de consumidores mortos
    const [nextCursor, claimed] = await redis.xautoclaim(
      STREAM, group, consumer, CLAIM_IDLE_MS, cursor, "COUNT", 10
    ) as [string, [string, string[]][]];
    cursor = nextCursor;

    // 2) Lê novas (bloqueia até 5s)
    const fresh = (await redis.xreadgroup(
      "GROUP", group, consumer, "COUNT", 10, "BLOCK", 5000, "STREAMS", STREAM, ">"
    )) as [string, [string, string[]][]][] | null;

    const batches: [string, string[]][] = [
      ...claimed,
      ...(fresh?.[0]?.[1] ?? []),
    ];

    for (const [id, fields] of batches) {
      const env: HandoffEnvelope = JSON.parse(fields[1]);
      try {
        await handle(env);
        await redis.xack(STREAM, group, id);
      } catch (err) {
        await onFailure(group, id, env, err);
      }
    }
  }
}

async function onFailure(group: string, id: string, env: HandoffEnvelope, err: unknown) {
  const attempt = env.attempt + 1;
  if (attempt > MAX_RETRIES) {
    // Move para DLQ com motivo, depois ack para liberar o PEL
    await redis.xadd(DLQ, "*", "data", JSON.stringify({
      ...env, lifecycle_status: "FAILED",
      _dlq_original_status: env.lifecycle_status, // preserva p/ replay restaurar o estado correto
      _dlq_reason: String((err as Error)?.message ?? err),
      _dlq_at: new Date().toISOString(),
    }));
    await redis.xack(STREAM, group, id);
    await alertCritical(`Handoff ${env.task_id} → DLQ após ${MAX_RETRIES} tentativas`);
    return;
  }
  // Reenfileira com attempt incrementado após backoff; ack o original
  await new Promise((r) => setTimeout(r, backoffMs(attempt)));
  await redis.xadd(STREAM, "*", "data", JSON.stringify({ ...env, attempt }));
  await redis.xack(STREAM, group, id);
}

async function alertCritical(msg: string) {
  // publica no fluxo de comunicação (n8n → WhatsApp)
  await redis.xadd("ops:alerts", "*", "data", JSON.stringify({ level: "CRITICAL", msg, at: new Date().toISOString() }));
}
