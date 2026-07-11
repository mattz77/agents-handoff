import Redis from "ioredis";
import fs from "node:fs";

const redisPass = process.env.REDIS_PASS_FILE
  ? fs.readFileSync(process.env.REDIS_PASS_FILE, "utf-8").trim()
  : process.env.REDIS_PASS;

export const redis = new Redis({
  sentinels: [
    { host: "sentinel-1", port: 26379 },
    { host: "sentinel-2", port: 26379 },
    { host: "sentinel-3", port: 26379 },
  ],
  name: "mymaster",
  password: redisPass,
  // Reconexão resiliente a failover
  retryStrategy: (times) => Math.min(times * 200, 5000),
  reconnectOnError: (err) => /READONLY/.test(err.message), // reconecta se caiu em replica pós-failover
});
