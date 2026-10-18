import pg from "pg";
import { config } from "../config.js";

// Return DATE columns as plain "YYYY-MM-DD" strings instead of local-time Dates.
pg.types.setTypeParser(1082, (v) => v);
// bigint (size_bytes, counts) fits comfortably in a JS number here.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("[db] idle client error", err.message);
});

export type Queryable = Pick<pg.PoolClient, "query">;

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<T | undefined> {
  const rows = await query<T>(text, params, db);
  return rows[0];
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
