/** Padrões de segredo redigidos antes de qualquer conteúdo sair pra LLM externo ou RAG. */
export const SECRET_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]+/g,
  /nvapi-[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /AKIA[0-9A-Z]+/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /postgres(?:ql)?:\/\/[^\s'"]+/gi,
  /redis:\/\/[^\s'"]+/gi,
  /[A-Za-z0-9!@#$%^&*]{6,}@[0-9]{6}\b/g,
  /(api[_-]?key|apikey|password|senha|secret|token)["'\s:=]+[A-Za-z0-9._\-@!#$%^&*]{8,}/gi,
];

/** Paths que nunca devem ser mandados pra LLM externo, mesmo redigidos. */
export const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(^|[\\/])\.env(\.|$)/i,
  /-secrets?\.[a-z]+$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

export function isSensitivePath(p: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(p));
}

/** Remove hunks de arquivos sensíveis de uma diff unificada (formato `git diff` / GitHub compare). */
export function stripSensitiveDiffSections(diff: string): string {
  const blocks = diff.split(/(?=^diff --git )/m);
  return blocks
    .filter((block) => {
      const header = block.match(/^diff --git a\/(\S+) b\/(\S+)/m);
      if (!header) return true;
      return !isSensitivePath(header[1]) && !isSensitivePath(header[2]);
    })
    .map((block) => redact(block))
    .join("");
}
