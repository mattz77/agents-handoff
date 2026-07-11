#!/usr/bin/env node
// /opt/scripts/compile-fallback-context.js
const fs = require("node:fs");
const { execSync } = require("node:child_process");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1];

const ctx = {
  origin: arg("origin") || "unknown",
  reason: arg("reason"),
  http: arg("http"),
  captured_at: new Date().toISOString(),
  git: {
    branch: execSync("git rev-parse --abbrev-ref HEAD").toString().trim(),
    head: execSync("git rev-parse HEAD").toString().trim(),
    // resumo do diff, não o diff inteiro — limita tokens
    diff_stat: execSync("git diff --stat HEAD~1..HEAD || true").toString().trim().slice(0, 2000),
  },
  // últimas instruções relevantes da sessão (não o histórico completo)
  last_action: process.env.CLAUDE_LAST_ACTION || "",
};

fs.writeFileSync(arg("out"), JSON.stringify(ctx, null, 2));
console.log(`[fallback] contexto serializado em ${arg("out")}`);
