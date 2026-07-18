import { Pool } from "pg";

const isSupabase = process.env.DATABASE_URL?.includes('supabase.com');

export const pg = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30_000,       // 30s (was 20s) — DNS pode levar mais tempo em WSL2
  idleTimeoutMillis: 60_000,             // 60s (was 30s) — conexões idle morrem com menos frequência
  max: 10,                               // pool máximo
  allowExitOnIdle: false,                // mantém o pool vivo (daemon long-running)
  ...(isSupabase ? {
    ssl: { rejectUnauthorized: false },
    // Keepalive evita que o Supabase pooler (PgBouncer) mate a conexão por inatividade
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  } : {})
});

pg.on('error', (err) => {
  // Erros em clients idle (ex: Supabase cortou a conexão) — o Pool recria automaticamente.
  // Só loga, não crasha.
  console.error('[Postgres] erro em client idle (será reconectado):', err.message);
});

// --- Auto-retry transparente para falhas de DNS/rede ---
// Monkey-patch: envolve o `pg.query()` original com retry em erros transientes.
// Assim TODOS os `pg.query(...)` no codebase ganham resiliência sem trocar nenhuma chamada.
const PG_MAX_RETRIES = 3;
const _pgSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const _originalQuery = pg.query.bind(pg);

(pg as any).query = async function retryQuery(...args: any[]): Promise<any> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= PG_MAX_RETRIES; attempt++) {
    try {
      return await (_originalQuery as Function)(...args);
    } catch (e) {
      lastErr = e as Error;
      const msg = lastErr.message || "";
      const isTransient =
        /EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|Connection terminated|connection timeout|socket hang up/i.test(msg);
      if (!isTransient || attempt === PG_MAX_RETRIES) throw lastErr;
      console.warn(`[Postgres] query attempt ${attempt + 1} failed (${msg}), retrying in ${2 ** attempt}s…`);
      await _pgSleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
};

let githubTokenCache: { value: string; at: number } | null = null;
const GITHUB_TOKEN_TTL_MS = 60_000;

export async function getGithubToken(): Promise<string> {
  if (githubTokenCache && Date.now() - githubTokenCache.at < GITHUB_TOKEN_TTL_MS) {
    return githubTokenCache.value;
  }
  let dbToken = "";
  try {
    const { rows } = await pg.query(`select value from handoff_settings where key = 'github_token'`);
    dbToken = rows[0]?.value || "";
  } catch {
    // handoff_settings pode não existir ainda — segue com fallback do env
  }
  const value = dbToken || process.env.GITHUB_TOKEN || "";
  githubTokenCache = { value, at: Date.now() };
  return value;
}

