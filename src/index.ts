import { startConsumer } from "./consumer";
import { applyHandoffTransition, drainOutbox, persistHermesAudit } from "./outbox";
import { HandoffEnvelope } from "./domain/handoff";
import { runHermesAudit } from "./hermes/linter";
import { handleOpsRequest } from "./ops/server";
import { startRagWatcher } from "./hermes/rag-watcher";
import { startCodeReviewCron } from "./ops/codereview-cron";
import { checkBrainSizeAlert } from "./ops/metrics";
import http from "node:http";
import os from "node:os";

// Liga/desliga o gatilho do linter Hermes sem redeploy (default: ligado).
const HERMES_ENABLED = process.env.HERMES_ENABLED !== "false";

console.log("🚀 Iniciando Antigravity Handoff Daemon v7.0...");

// Servidor HTTP: /health (readiness real), /ops (painel) e /ops/api/* (REST)
const server = http.createServer((req, res) => {
  handleOpsRequest(req, res)
    .then((handled) => {
      if (!handled) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Rota não encontrada" }));
      }
    })
    .catch((err) => {
      console.error("[ops] erro não tratado:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Erro interno" }));
      }
    });
});

server.listen(3000, () => {
  console.log("🟢 HTTP na porta 3000 — /health e painel em /ops");
});

// Nome de consumer único por instância → permite escala horizontal sem colisão de PEL
const consumerName = `daemon-${os.hostname()}-${process.pid}`;

// Inicializa o worker do consumidor no Consumer Group 'g:ops'
startConsumer("g:ops", consumerName, async (env: HandoffEnvelope) => {
  // Auditoria do Hermes é anexo, não transição de ciclo de vida → persiste e retorna.
  if (env.event_kind === "hermes.audit") {
    console.log(`[HERMES-AUDIT] corr=${env.correlation_id} sev=${env.hermes_audit?.severidade}`);
    await persistHermesAudit(env);
    return;
  }

  console.log(`[HANDOFF] Recebido: ${env.task_id} | ${env.signatures.sender} → ${env.signatures.receiver} | Status: ${env.lifecycle_status} | Projeto: ${env.project}`);
  // Aplica transição de estado e enfileira notificação Outbox na mesma transação DB
  await applyHandoffTransition(env);

  // Gatilho fire-and-forget do linter: dispara em troca de bastão (AWAITING_*), nunca síncrono.
  // Não awaitado de propósito — Ollama off/lento não pode bloquear nem falhar o handoff.
  if (HERMES_ENABLED
      && env.signatures.sender !== "Hermes_Linter"
      && env.lifecycle_status.startsWith("AWAITING_HANDOFF")) {
    runHermesAudit(env).catch((e) => console.error("[Hermes] trigger falhou (ignorado):", e?.message));
  }
}).catch(console.error);

// Inicia o drenador do Outbox (background loop)
drainOutbox().catch(console.error);

// Inicia o watcher RAG
startRagWatcher();

// Inicia o agendador de Code Review Diário
startCodeReviewCron();

// Guard-rail: checa tamanho do LLM-Brain (HOT files) a cada hora (TASK 35 Fase 6)
checkBrainSizeAlert().catch((e) => console.error("[brain-size] check inicial falhou:", e?.message));
setInterval(() => {
  checkBrainSizeAlert().catch((e) => console.error("[brain-size] check falhou:", e?.message));
}, 60 * 60 * 1000);

console.log("✅ Workers (Consumer, Outbox Drainer, RAG, CodeReview) iniciados.");
