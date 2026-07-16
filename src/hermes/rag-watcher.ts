import chokidar from "chokidar";
import { exec } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { lintBrainStructure } from "./linter";
import { ragService } from "../infra/datalake-rag";

// Dentro do container: /data/llm-brain e /data/datalake (bind mounts do docker-compose).
// No host (testes locais): substituir pelas vars de ambiente.
const BRAIN_DIR = process.env.WATCHER_BRAIN_DIR ?? "/data/llm-brain";
const DATALAKE_KB_DIR = process.env.WATCHER_DATALAKE_KB_DIR ?? "/data/datalake/Knowledge_Base";
const DATALAKE_CORPUS_DIR = process.env.WATCHER_DATALAKE_CORPUS_DIR ?? "/data/datalake/Memory/corpus";
const DATALAKE_PROJETOS_DIR = process.env.WATCHER_DATALAKE_PROJETOS_DIR ?? "/data/datalake/Projetos";
const WATCH_DIRS = [BRAIN_DIR, DATALAKE_KB_DIR, DATALAKE_CORPUS_DIR, DATALAKE_PROJETOS_DIR];

const isIndexable = (filePath: string) =>
  (filePath.endsWith(".md") || filePath.endsWith(".txt")) &&
  !filePath.includes("n8n-scripts") && !filePath.includes("-secrets") &&
  !/[\/\\]\./.test(filePath); // pula pastas/arquivos ocultos (.git, .cache do Drive, etc)

let debounceTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 5000;

export function startRagWatcher() {
  console.log("[RAG Watcher] Iniciando monitoramento para ingestão ao vivo (AnythingLLM e LanceDB)...");

  // Índice completo no boot — o watcher (ignoreInitial:true abaixo) só reage a MUDANÇAS
  // futuras; sem isso, arquivos que já existiam antes do container subir nunca entravam
  // no LanceDB e a busca semântica sempre voltava vazia.
  indexAllExisting().catch((e) => console.error("[RAG Watcher] Falha no índice inicial:", e.message));

  const watcher = chokidar.watch(WATCH_DIRS, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    usePolling: false, // bind mount local (llm-brain-mirror, datalake mirror) — evita polling caro em CPU
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 }, // debounce writes parciais do Drive sync
  });

  watcher.on("all", (event, filePath) => {
    if (!isIndexable(filePath)) return;

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

    if (event === "add" || event === "change") {
      fs.promises.readFile(filePath, "utf-8")
        .then((content) => ragService.indexDocument(filePath, content))
        .catch((e) => console.error(`[RAG Watcher] Falha ao indexar ${filePath}:`, e.message));
    }

    scheduleIngestion();
  });
}

async function walkIndexable(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out; // dir pode não existir ainda (mirror não sincronizado, mount vazio, etc.)
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkIndexable(p));
    else if (isIndexable(p)) out.push(p);
  }
  return out;
}

// Indexa (upsert, idempotente) todos os .md/.txt já existentes nas pastas monitoradas —
// cobre LLM-Brain, Knowledge_Base, Memory/corpus e Projetos, pra busca semântica achar
// qualquer arquivo/projeto real do DataLake, não só o que mudar depois do boot.
async function indexAllExisting() {
  const files = (await Promise.all(WATCH_DIRS.map(walkIndexable))).flat();
  console.log(`[RAG Watcher] Índice inicial: ${files.length} arquivo(s) encontrados.`);
  let ok = 0, fail = 0;
  for (const filePath of files) {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const done = await ragService.indexDocument(filePath, content);
      if (done) ok++; else fail++;
    } catch (e) {
      fail++;
      console.error(`[RAG Watcher] Falha ao indexar ${filePath}:`, (e as Error).message);
    }
  }
  console.log(`[RAG Watcher] Índice inicial concluído: ${ok} indexados, ${fail} falharam.`);
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
  console.log("[RAG Watcher] Disparando scripts de ingestão complementar (AnythingLLM)...");
  // O índice de busca semântica (LanceDB) já foi atualizado em-processo no handler "all" acima
  // (ragService.indexDocument), assim que o arquivo mudou — não depende deste debounce.

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

}
