#!/usr/bin/env node
// brain.js — CLI leitura estruturada do LLM-Brain (economia de tokens).
// Uso: node scripts/brain.js <comando> [args]
'use strict';

const fs = require('fs');
const path = require('path');

const BRAIN_DIR = process.env.BRAIN_DIR || 'G:\\Meu Drive\\LLM-Brain';

const FILES = {
  active: path.join(BRAIN_DIR, 'active-context.md'),
  tasks: path.join(BRAIN_DIR, 'task-queue.md'),
  decisions: path.join(BRAIN_DIR, 'decisions.md'),
};

const ARCHIVE_DIR = path.join(BRAIN_DIR, 'archive');

const MOJIBAKE_MAP = [
  [/â€”/g, '—'], [/Ã§/g, 'ç'], [/Ã£/g, 'ã'], [/Ã©/g, 'é'], [/Ã¡/g, 'á'],
  [/Ã­/g, 'í'], [/Ãµ/g, 'õ'], [/Ãª/g, 'ê'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
  [/Ã‡/g, 'Ç'], [/Ã‰/g, 'É'], [/Â/g, ''],
];

function fixMojibake(s) {
  let out = s;
  for (const [re, rep] of MOJIBAKE_MAP) out = out.replace(re, rep);
  return out;
}

function readFileSafe(p) {
  if (!fs.existsSync(p)) return '';
  let buf = fs.readFileSync(p);
  // strip BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.slice(3);
  }
  return buf.toString('utf-8');
}

function listArchiveFiles() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs.readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(ARCHIVE_DIR, f));
}

// --- Parsers -----------------------------------------------------------

// Splits active-context.md into checkpoint sections by top-level "## " headers.
function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) sections.push(current);
      current = { header: line.replace(/^##\s+/, '').trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // preamble before first "## "
      if (!sections.__preamble) sections.__preamble = [];
      sections.__preamble.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

// Splits task-queue.md into task blocks by "## [status] Title" headers.
const TASK_HEADER_RE = /^##\s*\[(pending|in_progress|done|blocked|cancelled|archived)\]\s*(.+)$/i;

function splitTasks(text) {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(TASK_HEADER_RE);
    if (m) {
      if (current) tasks.push(current);
      current = {
        status: m[1].toLowerCase(),
        title: fixMojibake(m[2].trim()),
        lines: [line],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) tasks.push(current);
  return tasks;
}

function taskField(body, label) {
  // e.g. **Assigned:** Claude  or  **Prioridade:** alta
  const re = new RegExp('\\*\\*' + label + ':\\*\\*\\s*(.+)', 'i');
  const m = body.match(re);
  return m ? fixMojibake(m[1].trim()) : null;
}

// --- Commands ------------------------------------------------------------

function cmdPending(args) {
  const assignedFilter = getFlag(args, '--assigned');
  const text = fixMojibake(readFileSafe(FILES.tasks));
  const tasks = splitTasks(text).filter((t) => t.status === 'pending' || t.status === 'in_progress');

  const filtered = tasks.filter((t) => {
    if (!assignedFilter) return true;
    const body = t.lines.join('\n');
    const assigned = (taskField(body, 'Assigned') || '').toLowerCase();
    return assigned.includes(assignedFilter.toLowerCase());
  });

  if (filtered.length === 0) {
    console.log('Nenhuma task pending/in_progress' + (assignedFilter ? ` (assigned: ${assignedFilter})` : '') + '.');
    return;
  }

  console.log(`# Tasks pending/in_progress (${filtered.length})\n`);
  for (const t of filtered) {
    const body = t.lines.join('\n');
    const assigned = taskField(body, 'Assigned') || '?';
    const prio = taskField(body, 'Prioridade') || '?';
    console.log(`[${t.status}] ${t.title}`);
    console.log(`  assigned=${assigned} prioridade=${prio}`);
  }
}

function cmdTask(args) {
  const num = args[0];
  if (!num) {
    console.error('Uso: brain.js task <numero>');
    process.exit(1);
  }
  const text = fixMojibake(readFileSafe(FILES.tasks));
  const tasks = splitTasks(text);
  const re = new RegExp(`TASK\\s+${num}\\b`, 'i');
  const match = tasks.find((t) => re.test(t.title));
  if (!match) {
    console.log(`TASK ${num} não encontrada no HOT file. Tente 'brain.js grep "TASK ${num}"' (pode estar no archive).`);
    return;
  }
  console.log(match.lines.join('\n').trim());
}

function cmdCheckpoint(args) {
  const n = parseInt(getFlag(args, '--last') || '3', 10);
  const projectFilter = getFlag(args, '--project');
  const text = fixMojibake(readFileSafe(FILES.active));
  let sections = splitSections(text);
  if (projectFilter) {
    const tag = `[projeto:${projectFilter}]`.toLowerCase();
    sections = sections.filter((s) => s.header.toLowerCase().includes(tag));
  }
  const slice = sections.slice(0, n);
  if (slice.length === 0) {
    console.log('Nenhum checkpoint encontrado' + (projectFilter ? ` (project: ${projectFilter})` : '') + '.');
    return;
  }
  console.log(`# Últimos ${slice.length} checkpoint(s)` + (projectFilter ? ` [projeto:${projectFilter}]` : '') + '\n');
  for (const s of slice) {
    console.log(s.lines.join('\n').trim());
    console.log('\n---\n');
  }
}

function cmdDecisions(args) {
  const n = parseInt(getFlag(args, '--last') || '5', 10);
  const text = fixMojibake(readFileSafe(FILES.decisions));
  const sections = splitSections(text);
  const slice = sections.slice(0, n);
  if (slice.length === 0) {
    console.log('Nenhuma decisão encontrada.');
    return;
  }
  console.log(`# Últimas ${slice.length} decisão(ões)\n`);
  for (const s of slice) {
    console.log(s.lines.join('\n').trim());
    console.log('\n---\n');
  }
}

function cmdGrep(args) {
  const term = args[0];
  if (!term) {
    console.error('Uso: brain.js grep "<termo>"');
    process.exit(1);
  }
  const termLower = term.toLowerCase();
  const targets = [
    { name: 'active-context.md', path: FILES.active },
    { name: 'task-queue.md', path: FILES.tasks },
    { name: 'decisions.md', path: FILES.decisions },
    ...listArchiveFiles().map((p) => ({ name: path.relative(BRAIN_DIR, p), path: p })),
  ];

  let found = 0;
  for (const t of targets) {
    const raw = readFileSafe(t.path);
    if (!raw) continue;
    const text = fixMojibake(raw);
    const sections = splitSections(text);
    for (const s of sections) {
      const body = s.lines.join('\n');
      if (body.toLowerCase().includes(termLower)) {
        found++;
        console.log(`## [${t.name}] ${s.header}`);
        console.log(body.trim());
        console.log('\n---\n');
      }
    }
  }
  if (found === 0) console.log(`Nenhum match para "${term}".`);
}

function cmdStats() {
  const rows = [];
  for (const [key, p] of Object.entries(FILES)) {
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : 0;
    const tokensApprox = Math.round(size / 4); // heurística ~4 bytes/token
    rows.push({ key, path: p, size, tokensApprox });
  }

  const text = fixMojibake(readFileSafe(FILES.tasks));
  const tasks = splitTasks(text);
  const byStatus = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

  const activeText = fixMojibake(readFileSafe(FILES.active));
  const sections = splitSections(activeText);

  console.log('# Brain stats\n');
  for (const r of rows) {
    const kb = (r.size / 1024).toFixed(1);
    console.log(`${r.key}: ${kb} KB (~${r.tokensApprox} tokens) — ${r.path}`);
  }
  console.log(`\nTasks total: ${tasks.length}`);
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`\nCheckpoints (seções) em active-context.md: ${sections.length}`);

  const HOT_LIMIT_KB = 30;
  const totalHotKB = rows.reduce((acc, r) => acc + r.size, 0) / 1024;
  if (totalHotKB > HOT_LIMIT_KB) {
    console.log(`\n⚠ HOT files somam ${totalHotKB.toFixed(1)} KB (> ${HOT_LIMIT_KB} KB) — rodar brain-compact.js`);
  }
}

async function cmdSearch(args) {
  const query = args[0];
  const k = parseInt(getFlag(args, '--k') || '5', 10);
  if (!query) {
    console.error('Uso: brain.js search "<query>" [--k N]');
    process.exit(1);
  }
  const base = process.env.OPS_BASE_URL || 'http://localhost:3000';
  const url = `${base}/ops/api/brain/search?q=${encodeURIComponent(query)}&k=${k}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      console.log('Nenhum resultado.');
      return;
    }
    console.log(`# Resultados para "${query}"\n`);
    for (const r of data.results) {
      console.log(`[score=${r.score.toFixed(4)}] ${r.heading} (${r.filePath})`);
      console.log(r.snippet);
      console.log('---');
    }
  } catch (err) {
    console.error(`Endpoint indisponível (${err.message}). Sem fallback local implementado ainda — suba o daemon (${base}) ou rode via /ops.`);
    process.exit(1);
  }
}

function getFlag(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx === args.length - 1) return null;
  return args[idx + 1];
}

// --- Main ------------------------------------------------------------

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'pending':
      cmdPending(rest);
      break;
    case 'checkpoint':
      cmdCheckpoint(rest);
      break;
    case 'decisions':
      cmdDecisions(rest);
      break;
    case 'task':
      cmdTask(rest);
      break;
    case 'grep':
      cmdGrep(rest);
      break;
    case 'stats':
      cmdStats();
      break;
    case 'search':
      await cmdSearch(rest);
      break;
    default:
      console.log(`Uso: node scripts/brain.js <comando> [args]

Comandos:
  pending [--assigned Claude|Gemini|ambos]
  checkpoint [--last N] [--project slug]
  decisions [--last N]
  task <numero>
  grep "<termo>"
  search "<query>" [--k N]   # requer daemon rodando (OPS_BASE_URL, default localhost:3000)
  stats
`);
      process.exit(cmd ? 1 : 0);
  }
}

main();
