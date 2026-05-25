import { Pool, QueryResultRow } from 'pg';
import { config } from '../config';

const pool = new Pool({
  connectionString: config.database.url,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => pool.query<T>(text, params);

export const getClient = () => pool.connect();

export default pool;
