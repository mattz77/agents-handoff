#!/usr/bin/env node
// brain-reindex.js — dropa a tabela LanceDB (embeddings mock) e reindexa Brain + Knowledge_Base com embeddings reais.
// Requer GEMINI_API_KEY no ambiente (ou .env carregado por quem chama). Roda contra o build em dist/.
// Uso: npm run build && node scripts/brain-reindex.js
'use strict';

const path = require('path');
const fs = require('fs');

// Carrega .env manualmente (sem dep nova) se GEMINI_API_KEY ainda não estiver setado.
function loadDotEnvIfNeeded() {
  if (process.env.GEMINI_API_KEY) return;
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function walkMd(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      walkMd(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  loadDotEnvIfNeeded();

  const { DataLakeRAGService } = require('../dist/infra/datalake-rag.js');

  const brainDir = process.env.BRAIN_DIR || 'G:\\Meu Drive\\LLM-Brain';
  const datalakeDir = process.env.DATALAKE_DIR || 'G:\\Meu Drive\\Luma_DataLake';
  const kbDir = path.join(datalakeDir, 'Knowledge_Base');

  const files = [...walkMd(brainDir, []), ...walkMd(kbDir, [])].filter((f) => !f.endsWith('BRAIN-INDEX.md'));

  const docs = files.map((f) => ({ filePath: f, content: fs.readFileSync(f, 'utf-8') }));

  console.log(`Reindexando ${docs.length} arquivo(s)...`);
  const svc = new DataLakeRAGService(datalakeDir);
  const result = await svc.reindexAll(docs);
  console.log(`Concluído: ${result.indexed} indexados, ${result.failed} falharam.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
