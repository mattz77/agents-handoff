#!/usr/bin/env node
// brain-compact.js — rotação HOT/COLD do LLM-Brain com backup obrigatório.
// Uso: node scripts/brain-compact.js [--dry-run] [--keep-checkpoints N]
'use strict';

const fs = require('fs');
const path = require('path');

const BRAIN_DIR = process.env.BRAIN_DIR || 'G:\\Meu Drive\\LLM-Brain';
const ARCHIVE_DIR = path.join(BRAIN_DIR, 'archive');

const FILES = {
  active: path.join(BRAIN_DIR, 'active-context.md'),
  tasks: path.join(BRAIN_DIR, 'task-queue.md'),
  decisions: path.join(BRAIN_DIR, 'decisions.md'),
};

const MOJIBAKE_MAP = [
  [/â€”/g, '—'], [/Ã§/g, 'ç'], [/Ã£/g, 'ã'], [/Ã©/g, 'é'], [/Ã¡/g, 'á'],
  [/Ã­/g, 'í'], [/Ãµ/g, 'õ'], [/Ãª/g, 'ê'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
  [/Ã‡/g, 'Ç'], [/Ã‰/g, 'É'],
];

function fixMojibake(s) {
  let out = s;
  for (const [re, rep] of MOJIBAKE_MAP) out = out.replace(re, rep);
  return out;
}

function readFileSafe(p) {
  if (!fs.existsSync(p)) return '';
  let buf = fs.readFileSync(p);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.slice(3);
  }
  return buf.toString('utf-8');
}

function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;
  const preamble = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) sections.push(current);
      current = { header: line.replace(/^##\s+/, '').trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  return { preamble, sections };
}

const TASK_HEADER_RE = /^##\s*\[(pending|in_progress|done|blocked|cancelled|archived)\]\s*(.+)$/i;

function splitTasks(text) {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  const preamble = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(TASK_HEADER_RE);
    if (m) {
      if (current) tasks.push(current);
      current = { status: m[1].toLowerCase(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) tasks.push(current);
  return { preamble, tasks };
}

function extractDateFromSection(headerLine) {
  // e.g. "Checkpoint Claude (2026-07-01T16:20:00-03:00)" ou "[2026-07-01] titulo"
  const m = headerLine.match(/(\d{4})-(\d{2})-\d{2}/);
  if (m) return { year: m[1], month: m[2] };
  return null;
}

function backupAll() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ARCHIVE_DIR, `backup-${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, p] of Object.entries(FILES)) {
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(dir, path.basename(p)));
    }
  }
  return dir;
}

function compactActive(dryRun, keepN) {
  const raw = readFileSafe(FILES.active);
  const fixed = fixMojibake(raw);
  const { preamble, sections } = splitSections(fixed);

  const hot = sections.slice(0, keepN);
  const cold = sections.slice(keepN);

  if (cold.length === 0) {
    return { changed: false, hotText: fixed, coldByMonth: {} };
  }

  const coldByMonth = {};
  for (const s of cold) {
    const d = extractDateFromSection(s.lines[0]) || { year: 'sem-data', month: '00' };
    const key = d.year === 'sem-data' ? 'sem-data' : `${d.year}-${d.month}`;
    if (!coldByMonth[key]) coldByMonth[key] = [];
    coldByMonth[key].push(s);
  }

  const hotText = [...preamble, ...hot.flatMap((s) => s.lines)].join('\n');

  if (!dryRun) {
    for (const [monthKey, secs] of Object.entries(coldByMonth)) {
      const archivePath = path.join(ARCHIVE_DIR, `active-context-${monthKey}.md`);
      const existing = readFileSafe(archivePath);
      const appended = (existing ? existing + '\n\n' : '') + secs.flatMap((s) => s.lines).join('\n');
      fs.writeFileSync(archivePath, appended, 'utf-8');
    }
    fs.writeFileSync(FILES.active, hotText, 'utf-8');
  }

  return { changed: true, hotText, coldCount: cold.length, coldByMonth: Object.keys(coldByMonth) };
}

function compactTasks(dryRun) {
  const raw = readFileSafe(FILES.tasks);
  const fixed = fixMojibake(raw);
  const { preamble, tasks } = splitTasks(fixed);

  const hotStatuses = new Set(['pending', 'in_progress']);
  const coldStatuses = new Set(['done', 'cancelled', 'archived']);

  const hot = tasks.filter((t) => hotStatuses.has(t.status));
  const cold = tasks.filter((t) => coldStatuses.has(t.status));

  if (cold.length === 0) {
    return { changed: false, hotText: fixed };
  }

  const hotText = [...preamble, ...hot.flatMap((t) => t.lines)].join('\n');

  if (!dryRun) {
    const archivePath = path.join(ARCHIVE_DIR, 'task-queue-done.md');
    const existing = readFileSafe(archivePath);
    const appended = (existing ? existing + '\n\n' : '# Task Queue — arquivo (done/cancelled)\n\n') +
      cold.flatMap((t) => t.lines).join('\n');
    fs.writeFileSync(archivePath, appended, 'utf-8');
    fs.writeFileSync(FILES.tasks, hotText, 'utf-8');
  }

  return { changed: true, hotText, coldCount: cold.length };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const keepFlagIdx = args.indexOf('--keep-checkpoints');
  const keepN = keepFlagIdx !== -1 ? parseInt(args[keepFlagIdx + 1], 10) : 3;

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  console.log(dryRun ? '=== DRY RUN (nada será escrito) ===\n' : '=== EXECUÇÃO REAL ===\n');

  let backupDir = null;
  if (!dryRun) {
    backupDir = backupAll();
    console.log(`Backup pré-compactação salvo em: ${backupDir}\n`);
  }

  const activeResult = compactActive(dryRun, keepN);
  const tasksResult = compactTasks(dryRun);

  console.log(`active-context.md: ${activeResult.changed ? `${activeResult.coldCount} seção(ões) movida(s) para archive/ [${(activeResult.coldByMonth || []).join(', ')}]` : 'nada a mover (já compacto)'}`);
  console.log(`  HOT resultante: ${(Buffer.byteLength(activeResult.hotText, 'utf-8') / 1024).toFixed(1)} KB`);

  console.log(`task-queue.md: ${tasksResult.changed ? `${tasksResult.coldCount} task(s) movida(s) para archive/task-queue-done.md` : 'nada a mover (já compacto)'}`);
  console.log(`  HOT resultante: ${(Buffer.byteLength(tasksResult.hotText, 'utf-8') / 1024).toFixed(1)} KB`);

  if (dryRun) {
    console.log('\nRode sem --dry-run pra aplicar (backup automático dos 3 arquivos originais é feito antes de escrever).');
  }
}

main();
