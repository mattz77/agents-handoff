// Rede de segurança compartilhada pelos agentes que escrevem código (Fix/Task/CIFix).
// Nenhum agente compila/roda o que escreve — tudo vai direto LLM → GitHub Contents API → PR,
// e o Verifier é só outro LLM lendo diff em texto, não um compilador. Isso deixa passar erros
// sintaticamente plausíveis mas quebrados no stack real do projeto (ex.: PR #22 usou
// `import.meta.url` num projeto TypeScript "module":"CommonJS" — ESM válido, CJS não compila).
//
// Duas camadas, nenhuma delas depende do modelo "lembrar":
// 1. detectStackFacts(): lê package.json + tsconfig.json do branch e gera um resumo factual
//    curto, injetado no PROMPT do agente como restrição explícita (barato, mas ainda depende
//    do modelo obedecer).
// 2. staticGuard(): checagem determinística pós-edit, ANTES do commit — bloqueia os padrões
//    mais comuns de incompatibilidade de module system independente do modelo ter obedecido
//    ou não. Isso é o que de fato impede o PR #22 de se repetir.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ModuleSystem = "commonjs" | "esm" | "unknown";

export interface StackFacts {
  moduleSystem: ModuleSystem;
  summary: string; // texto curto pronto pra injetar no system prompt do agente
}

interface GhFetcher {
  (path: string, init?: RequestInit): Promise<any>;
}

/** Deriva o module system a partir do conteúdo já lido de package.json/tsconfig.json —
 *  núcleo compartilhado pelas duas formas de leitura (GitHub Contents API ou clone local). */
function factsFromSources(pkgJsonText: string | undefined, tsconfigText: string | undefined): StackFacts {
  let pkgType: string | undefined;
  let pkgHasTypeScript = false;
  if (pkgJsonText) {
    try {
      const pkg = JSON.parse(pkgJsonText);
      pkgType = pkg.type;
      pkgHasTypeScript = !!(pkg.dependencies?.typescript || pkg.devDependencies?.typescript);
    } catch { /* package.json malformado — sem fatos, guard vira no-op */ }
  }

  let tsModule: string | undefined;
  if (tsconfigText) {
    try {
      // tsconfig pode ter comentários (JSONC) — strip básico de // e /* */ antes do parse.
      const raw = tsconfigText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      tsModule = JSON.parse(raw).compilerOptions?.module;
    } catch { /* sem tsconfig válido — segue só com package.json */ }
  }

  const isEsmModule = (m?: string) => !!m && /^(es\d+|esnext|node16|node18|node20|nodenext|system)$/i.test(m);
  let moduleSystem: ModuleSystem = "unknown";
  if (pkgType === "module" || isEsmModule(tsModule)) moduleSystem = "esm";
  else if (pkgType === "commonjs" || tsModule?.toLowerCase() === "commonjs" || (pkgHasTypeScript && !tsModule && pkgType === undefined)) moduleSystem = "commonjs";

  if (moduleSystem === "unknown") return { moduleSystem, summary: "" };

  const pkgTypeNote = pkgType ? ` "type":"${pkgType}"` : " sem campo type";
  const tsModuleNote = tsModule ? `, tsconfig module:"${tsModule}"` : "";
  const summary = moduleSystem === "commonjs"
    ? `FATO DO PROJETO — module system: CommonJS (package.json${pkgTypeNote}${tsModuleNote}). NUNCA use sintaxe exclusiva de ESM: import.meta.url, top-level await, ou "export default" quando o padrão do arquivo já é named export. __dirname/__filename já existem nativamente em CommonJS — não recrie via fileURLToPath(import.meta.url).`
    : `FATO DO PROJETO — module system: ESM (package.json type:"module"${tsModuleNote}). Use import/export ESM padrão; __dirname/__filename NÃO existem nativamente — se precisar, derive via fileURLToPath(import.meta.url).`;

  return { moduleSystem, summary };
}

/** Lê package.json + tsconfig.json (se existirem) do branch via GitHub Contents API.
 *  Usado por Fix/Task/CIFix — operam 100% via API, sem clone. Nunca lança. */
export async function detectStackFacts(gh: GhFetcher, owner: string, repo: string, ref: string): Promise<StackFacts> {
  const b64decode = (s: string) => Buffer.from(s, "base64").toString("utf8");
  let pkgJsonText: string | undefined;
  let tsconfigText: string | undefined;
  try {
    const meta = await gh(`/repos/${owner}/${repo}/contents/package.json?ref=${ref}`);
    if (meta && !Array.isArray(meta)) pkgJsonText = b64decode(meta.content);
  } catch { /* sem package.json ou não é Node */ }
  try {
    const meta = await gh(`/repos/${owner}/${repo}/contents/tsconfig.json?ref=${ref}`);
    if (meta && !Array.isArray(meta)) tsconfigText = b64decode(meta.content);
  } catch { /* sem tsconfig */ }
  return factsFromSources(pkgJsonText, tsconfigText);
}

/** Mesma coisa, lendo de um clone local (workdir) — usado pelo ConflictResolver, que já
 *  opera via `git` real em vez da Contents API. Nunca lança. */
export async function detectStackFactsLocal(workdir: string): Promise<StackFacts> {
  const readIfExists = async (p: string): Promise<string | undefined> => {
    try { return await readFile(join(workdir, p), "utf-8"); } catch { return undefined; }
  };
  const [pkgJsonText, tsconfigText] = await Promise.all([readIfExists("package.json"), readIfExists("tsconfig.json")]);
  return factsFromSources(pkgJsonText, tsconfigText);
}

/** Regras determinísticas — não dependem do modelo ter lido/obedecido o prompt.
 *  Roda em CIMA do conteúdo final do arquivo, antes do commit. Retorna motivo se violar. */
export function staticGuard(path: string, content: string, facts: StackFacts): { ok: true } | { ok: false; reason: string } {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return { ok: true };
  if (facts.moduleSystem === "commonjs") {
    if (/\bimport\.meta\b/.test(content)) {
      return { ok: false, reason: `usa import.meta (sintaxe ESM) em projeto CommonJS — não compila (TS1343). Use process.cwd() ou __dirname nativo.` };
    }
  }
  if (facts.moduleSystem === "esm") {
    if (/\brequire\s*\(/.test(content) && !/\bcreateRequire\b/.test(content)) {
      return { ok: false, reason: `usa require() em projeto ESM ("type":"module") — não roda sem createRequire.` };
    }
    if (/\b__dirname\b|\b__filename\b/.test(content) && !/fileURLToPath/.test(content)) {
      return { ok: false, reason: `usa __dirname/__filename (globals CommonJS) em projeto ESM — undefined em runtime. Derive via fileURLToPath(import.meta.url).` };
    }
  }
  return { ok: true };
}
