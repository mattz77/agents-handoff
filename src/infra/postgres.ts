import { Pool } from "pg";

const isSupabase = process.env.DATABASE_URL?.includes('supabase.com');

export const pg = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 1000,
  ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {})
});

pg.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

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



