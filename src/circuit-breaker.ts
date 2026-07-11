import { redis } from "./infra/redis";

type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";
const FAIL_THRESHOLD = 5;
const OPEN_MS = 30_000;

export async function callWithBreaker(key: string, fn: () => Promise<void>) {
  const state = (await redis.get(`cb:${key}:state`)) as BreakerState | null ?? "CLOSED";
  const openedAt = Number(await redis.get(`cb:${key}:openedAt`)) || 0;

  if (state === "OPEN") {
    if (Date.now() - openedAt < OPEN_MS) throw new Error(`Breaker OPEN para ${key}`);
    await redis.set(`cb:${key}:state`, "HALF_OPEN"); // tenta um probe
  }

  try {
    await fn();
    await redis.del(`cb:${key}:fails`, `cb:${key}:state`); // sucesso fecha o circuito
  } catch (e) {
    const fails = await redis.incr(`cb:${key}:fails`);
    if (fails >= FAIL_THRESHOLD) {
      await redis.set(`cb:${key}:state`, "OPEN");
      await redis.set(`cb:${key}:openedAt`, Date.now());
    }
    throw e;
  }
}
