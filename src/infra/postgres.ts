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



