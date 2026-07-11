#!/usr/bin/env node
// /opt/scripts/publish-fallback.js
const fs = require("node:fs");
const crypto = require("node:crypto");
const Redis = require("ioredis");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1];
const ctx = JSON.parse(fs.readFileSync(arg("ctx"), "utf8"));

const env = {
  task_id: crypto.randomUUID(),       // se UUIDv7 indisponível aqui, v4 + timestamp
  schema_version: "7.0",
  timestamp: new Date().toISOString(),
  lifecycle_status: arg("status"),    // FALLBACK_TRIGGERED
  reason: ctx.reason,
  context: ctx,
};
const body = JSON.stringify(env);
const sig = "sha256=" + crypto.createHmac("sha256", process.env.WEBHOOK_SECRET).update(body).digest("hex");

(async () => {
  const redis = new Redis(process.env.REDIS_URL);
  // publica no stream que o conector n8n consome
  await redis.xadd("ops:comm", "*", "sig", sig, "data", body);
  await redis.quit();
  console.log("[fallback] evento publicado em ops:comm (assinado)");
})();
