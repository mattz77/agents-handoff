import { redis } from "./infra/redis";
import { HandoffEnvelope } from "./domain/handoff";

const STREAM = "handoff:stream";
const MAXLEN = 100_000;
const IDEM_TTL = 86_400; // 24h

/** Publica um handoff. Retorna o stream ID, ou null se for duplicata (no-op). */
export async function publishHandoff(env: HandoffEnvelope): Promise<string | null> {
  // Dedupe atômico: só publica se a chave for nova
  const fresh = await redis.set(`idem:${env.idempotency_key}`, env.task_id, "EX", IDEM_TTL, "NX");
  if (!fresh) return null;

  return redis.xadd(STREAM, "MAXLEN", "~", MAXLEN, "*", "data", JSON.stringify(env));
}
