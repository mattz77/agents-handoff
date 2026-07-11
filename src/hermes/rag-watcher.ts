import chokidar from "chokidar";
import { exec } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { lintBrainStructure } from "./linter";

// Dentro do container: /data/llm-brain e /data/datalake (bind mounts do docker-compose).
// No host (testes locais): substituir pelas vars de ambiente.
const BRAIN_DIR = process.env.WATCHER_BRAIN_DIR ?? "/data/llm-brain";
const DATALAKE_KB_DIR = process.env.WATCHER_DATALAKE_KB_DIR ?? "/data/datalake/Knowledge_Base";
const DATALAKE_CORPUS_DIR = process.env.WATCHER_DATALAKE_CORPUS_DIR ?? "/data/datalake/Memory/corpus";

let debounceTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 5000;

export function startRagWatcher() {
  console.log("[RAG Watcher] Iniciando monitoramento para ingestão ao vivo (AnythingLLM e LanceDB)...");

  // Ignorar pastas ocultas ou arquivos de cache do Drive
  const watcher = chokidar.watch([BRAIN_DIR, DATALAKE_KB_DIR, DATALAKE_CORPUS_DIR], {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on("all", (event, filePath) => {
    // Apenas monitorar arquivos markdown e evitar scripts ou envs
    if (!filePath.endsWith(".md") && !filePath.endsWith(".txt")) return;
    if (filePath.includes("n8n-scripts") || filePath.includes("-secrets")) return;

    console.log(`[RAG Watcher] Detectada alteração: ${event} em ${path.basename(filePath)}`);

    if (path.basename(filePath) === "active-context.md") {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const lint = lintBrainStructure(raw);
        if (!lint.ok) {
          console.warn(`[Hermes Linter] active-context.md com problema estrutural:\n  - ${lint.issues.join("\n  - ")}`);
        }
      } catch (e) {
        console.error("[Hermes Linter] falha ao lintar active-context.md:", (e as Error).message);
      }
    }

    scheduleIngestion();
  });
}

function scheduleIngestion() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    runIngestion();
  }, DEBOUNCE_MS);
}

function runIngestion() {
  console.log("[RAG Watcher] Disparando scripts de ingestão (AnythingLLM e LanceDB)...");

  // BRAIN-INDEX.md (digest curto) — roda primeiro, é rápido e síncrono o suficiente
  const brainIndexScript = path.resolve(__dirname, "../../scripts/brain-index.js");
  if (fs.existsSync(brainIndexScript)) {
    exec(`node "${brainIndexScript}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`[RAG Watcher] Erro no brain-index: ${error.message}`);
        return;
      }
      if (stderr) console.error(`[RAG Watcher] brain-index stderr: ${stderr}`);
      console.log(`[RAG Watcher] brain-index: ${stdout.trim()}`);
    });
  } else {
    console.warn(`[RAG Watcher] Script não encontrado: ${brainIndexScript}`);
  }

  // Script para AnythingLLM (já implementado por Claude)
  const anythingLlmScript = path.resolve(__dirname, "../../scripts/anythingllm-ingest.js");
  
  if (fs.existsSync(anythingLlmScript)) {
    exec(`node "${anythingLlmScript}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`[RAG Watcher] Erro no AnythingLLM Ingest: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`[RAG Watcher] AnythingLLM Ingest stderr: ${stderr}`);
      }
      console.log(`[RAG Watcher] AnythingLLM Ingest concluído:\n${stdout}`);
    });
  } else {
    console.warn(`[RAG Watcher] Script não encontrado: ${anythingLlmScript}`);
  }

  // Script para LanceDB (DataLake CLI)
  const lanceDbScript = "G:/Meu Drive/Luma_DataLake/Memory/scripts/ingest.js";
  if (fs.existsSync(lanceDbScript)) {
    const nodeModulesPath = path.resolve(__dirname, "../../node_modules");
    exec(`node "${lanceDbScript}"`, { env: { ...process.env, NODE_PATH: nodeModulesPath } }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[RAG Watcher] Erro no LanceDB Ingest: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`[RAG Watcher] LanceDB Ingest stderr: ${stderr}`);
      }
      console.log(`[RAG Watcher] LanceDB Ingest concluído:\n${stdout}`);
    });
  } else {
    console.warn(`[RAG Watcher] Script não encontrado: ${lanceDbScript}`);
  }
}
