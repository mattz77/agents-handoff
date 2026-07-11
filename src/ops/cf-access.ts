import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Validação do JWT do Cloudflare Access (Zero Trust).
 *
 * Quando o subdomínio está atrás de uma Access Application, o Cloudflare injeta
 * o header `Cf-Access-Jwt-Assertion` (e o cookie CF_Authorization) em toda
 * requisição já autenticada no edge (OTP por email). Aqui validamos a assinatura
 * RS256 contra o JWKS público do time e conferimos iss/aud/exp.
 *
 * Sem dependências externas: usa node:crypto com chaves em formato JWK.
 *
 * Envs:
 *   CF_ACCESS_TEAM_DOMAIN  ex.: minhaorg.cloudflareaccess.com  (ou a URL completa)
 *   CF_ACCESS_AUD          AUD tag da Access Application (gerado no provisionamento)
 */

const TEAM_DOMAIN = (process.env.CF_ACCESS_TEAM_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
const AUD = process.env.CF_ACCESS_AUD || "";

const ISSUER = TEAM_DOMAIN ? `https://${TEAM_DOMAIN}` : "";
const CERTS_URL = TEAM_DOMAIN ? `https://${TEAM_DOMAIN}/cdn-cgi/access/certs` : "";

export function accessConfigured(): boolean {
  return Boolean(TEAM_DOMAIN && AUD);
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

// Cache do JWKS (rotaciona a cada ~6 semanas no CF; cache curto é seguro)
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h

async function getKeys(forceRefresh = false): Promise<Jwk[]> {
  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (jwksCache && fresh && !forceRefresh) return jwksCache.keys;

  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Falha ao obter JWKS do Cloudflare: HTTP ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys || [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface AccessIdentity {
  email?: string;
  sub?: string;
  [k: string]: unknown;
}

export interface VerifyResult {
  ok: boolean;
  identity?: AccessIdentity;
  error?: string;
}

/** Extrai o token: header Cf-Access-Jwt-Assertion ou cookie CF_Authorization. */
function extractToken(req: IncomingMessage): string | null {
  const h = req.headers["cf-access-jwt-assertion"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const cookie = req.headers["cookie"] || "";
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function verifyAccess(req: IncomingMessage): Promise<VerifyResult> {
  if (!accessConfigured()) {
    return { ok: false, error: "CF Access não configurado (CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD)" };
  }
  const token = extractToken(req);
  if (!token) return { ok: false, error: "Token do Cloudflare Access ausente" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, error: "JWT malformado" };
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg: string; kid: string };
  let payload: any;
  try {
    header = JSON.parse(b64urlToBuf(headerB64).toString("utf8"));
    payload = JSON.parse(b64urlToBuf(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, error: "JWT não decodificável" };
  }
  if (header.alg !== "RS256") return { ok: false, error: `alg não suportado: ${header.alg}` };

  // Localiza a chave (com refresh se o kid não estiver no cache)
  let keys = await getKeys();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getKeys(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return { ok: false, error: "kid desconhecido no JWKS" };

  // Verifica assinatura RS256 sobre header.payload
  const pubKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  const valid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    pubKey,
    b64urlToBuf(sigB64)
  );
  if (!valid) return { ok: false, error: "Assinatura inválida" };

  // Claims
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) return { ok: false, error: "Token expirado" };
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return { ok: false, error: "Token ainda não válido" };
  if (payload.iss !== ISSUER) return { ok: false, error: "Issuer inválido" };

  const auds: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(AUD)) return { ok: false, error: "AUD inválido" };

  return { ok: true, identity: { email: payload.email, sub: payload.sub } };
}
