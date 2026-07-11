#!/usr/bin/env node
// brain-index.js — gera LLM-Brain/BRAIN-INDEX.md (digest curto, <=2KB).
// Uso: node scripts/brain-index.js
'use strict';

const fs = require('fs');
const path = require('path');

const BRAIN_DIR = process.env.BRAIN_DIR || 'G:\\Meu Drive\\LLM-Brain';

const FILES = {
  active: path.join(BRAIN_DIR, 'active-context.md'),
  tasks: path.join(BRAIN_DIR, 'task-queue.md'),
  decisions: path.join(BRAIN_DIR, 'decisions.md'),
};

const INDEX_PATH = path.join(BRAIN_DIR, 'BRAIN-INDEX.md');

const MOJIBAKE_MAP = [
  [/â€”/g, '—'], [/Ã§/g, 'ç'], [/Ã£/g, 'ã'], [/Ã©/g, 'é'], [/Ã¡/g, 'á'],
  [/Ã­/g, 'í'], [/Ãµ/g, 'õ'], [/Ãª/g, 'ê'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
];

function fixMojibake(s) {
  let out = s;
  for (const [re, rep] of MOJIBAKE_MAP) out = out.replace(re, rep);
  return out;
}

function readFileSafe(p) {
  if (!fs.existsSync(p)) return '';
  let buf = fs.readFileSync(p);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
  return buf.toString('utf-8');
}

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
    }
  }
  if (current) sections.push(current);
  return sections;
}

const TASK_HEADER_RE = /^##\s*\[(pending|in_progress|done|blocked|cancelled|archived)\]\s*(.+)$/i;

function splitTasks(text) {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(TASK_HEADER_RE);
    if (m) {
      if (current) tasks.push(current);
      current = { status: m[1].toLowerCase(), title: m[2].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) tasks.push(current);
  return tasks;
}

function taskField(body, label) {
  const re = new RegExp('\\*\\*' + label + ':\\*\\*\\s*(.+)', 'i');
  const m = body.match(re);
  return m ? fixMojibake(m[1].trim()) : null;
}

function firstLine(headingOrText) {
  return headingOrText.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
}

function main() {
  const activeText = fixMojibake(readFileSafe(FILES.active));
  const tasksText = fixMojibake(readFileSafe(FILES.tasks));
  const decisionsText = fixMojibake(readFileSafe(FILES.decisions));

  const activeSections = splitSections(activeText);
  const tasks = splitTasks(tasksText);
  const decisionSections = splitSections(decisionsText);

  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const lastCheckpoint = activeSections[0];
  const lastDecisions = decisionSections.slice(-3).reverse();

  const modeloAtivoLine = lastCheckpoint ? firstLine(lastCheckpoint.lines.slice(1).join('\n')) : '(vazio)';

  const lines = [];
  lines.push(`# BRAIN INDEX (gerado ${new Date().toISOString()} — NÃO editar manualmente)`);
  lines.push('');
  lines.push('## Modelo ativo');
  lines.push(modeloAtivoLine);
  lines.push('');
  lines.push(`## Tasks pending (${pendingTasks.length})`);
  for (const t of pendingTasks) {
    const body = t.lines.join('\n');
    const assigned = taskField(body, 'Assigned') || '?';
    const prio = taskField(body, 'Prioridade') || '?';
    lines.push(`- [${prio}] ${t.title} — ${assigned}`);
  }
  lines.push('');
  lines.push('## Último checkpoint');
  if (lastCheckpoint) {
    const preview = lastCheckpoint.lines.slice(0, 12).join('\n');
    lines.push(preview);
  } else {
    lines.push('(nenhum)');
  }
  lines.push('');
  lines.push('## Últimas decisões');
  for (const d of lastDecisions) {
    lines.push(`- ${d.header}`);
  }
  lines.push('');

  const content = lines.join('\n');
  fs.writeFileSync(INDEX_PATH, content, 'utf-8');
  console.log(`BRAIN-INDEX.md gerado (${(Buffer.byteLength(content, 'utf-8') / 1024).toFixed(2)} KB) em ${INDEX_PATH}`);
}

main();
