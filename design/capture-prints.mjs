// Captura prints full-page de todas as seções do painel ops (localhost:3000).
// Uso: node design/capture-prints.mjs [--out design/prints]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'design/prints';
fs.mkdirSync(OUT, { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TABS = [
  ['overview', 'Visão geral'],
  ['handoffs', 'Handoffs'],
  ['brain', 'LLM Brain'],
  ['datalake', 'DataLake'],
  ['codereview', 'Code Review'],
  ['projects', 'Projetos'],
  ['infra', 'Infra'],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto('http://localhost:3000/ops/', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 4000)); // dados reais carregarem

for (const [id, label] of TABS) {
  const clicked = await page.evaluate((label) => {
    const btns = [...document.querySelectorAll('button, a')];
    const b = btns.find(el => el.textContent.trim() === label || el.textContent.trim().startsWith(label));
    if (b) { b.click(); return true; }
    return false;
  }, label);
  if (!clicked) { console.error('nav não achou:', label); continue; }
  await new Promise(r => setTimeout(r, 2500));
  const file = path.join(OUT, `${id}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('ok', file);
}
await browser.close();
