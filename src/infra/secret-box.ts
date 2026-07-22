import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// Cofre simétrico para segredos de provedores de IA (API keys OpenAI/Anthropic/NIM).
// AES-256-GCM. A master key vem de AGENT_PROVIDER_MASTER_KEY (32 bytes base64 ou hex);
// se vier com tamanho diferente, deriva-se via SHA-256 pra garantir 32 bytes.
// Formato do ciphertext persistido: base64( iv(12) || tag(16) || ciphertext ).

const MASTER_ENV = process.env.AGENT_PROVIDER_MASTER_KEY || "";

function loadKey(): Buffer | null {
  if (!MASTER_ENV) return null;
  let raw: Buffer;
  try {
    raw = /^[0-9a-fA-F]+$/.test(MASTER_ENV) && MASTER_ENV.length === 64
      ? Buffer.from(MASTER_ENV, "hex")
      : Buffer.from(MASTER_ENV, "base64");
  } catch {
    raw = Buffer.from(MASTER_ENV, "utf8");
  }
  // Normaliza pra exatamente 32 bytes — SHA-256 se o input não bater.
  return raw.length === 32 ? raw : createHash("sha256").update(raw.length ? raw : Buffer.from(MASTER_ENV, "utf8")).digest();
}

const KEY = loadKey();

/** true se AGENT_PROVIDER_MASTER_KEY está configurada — sem ela, as APIs de provider devem 503. */
export function secretsEnabled(): boolean {
  return KEY !== null;
}

export function encryptSecret(plaintext: string): string {
  if (!KEY) throw new Error("AGENT_PROVIDER_MASTER_KEY não configurado — não é possível salvar segredos");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  if (!KEY) throw new Error("AGENT_PROVIDER_MASTER_KEY não configurado — não é possível ler segredos");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
