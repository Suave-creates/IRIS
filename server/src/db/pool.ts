import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool: Pool | null = null;

/** Returns the shared MySQL connection pool, creating it lazily on first use. */
export function getPool(): Pool {
  if (pool) return pool;
  pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    // Safety + correctness defaults.
    multipleStatements: false,
    namedPlaceholders: true,
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true,
  });
  logger.info({ host: env.DB_HOST, db: env.DB_NAME }, 'MySQL pool created');
  return pool;
}

/**
 * Query/exec parameters. We enable mysql2 `namedPlaceholders`, so callers may
 * pass either positional arrays or named-parameter objects; mysql2's public
 * types don't model the object form, hence the narrow cast at the call site.
 */
export type DbParams = unknown[] | Record<string, unknown>;

/** Parameterised query returning typed rows. */
export async function query<T extends RowDataPacket[]>(sql: string, params?: DbParams): Promise<T> {
  // mysql2's value types don't model named-placeholder objects; cast is safe.
  const [rows] = await getPool().query<T>(sql, params as never);
  return rows;
}

/** Parameterised write returning the result header (affectedRows, insertId, …). */
export async function execute(sql: string, params?: DbParams): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params as never);
  return result;
}

/** Runs `fn` inside a transaction, committing on success and rolling back on error. */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Lightweight connectivity probe used by health checks. */
export async function pingDb(timeoutMs = 2_000): Promise<boolean> {
  const probe = (async () => {
    await getPool().query('SELECT 1');
    return true;
  })();
  const timeout = new Promise<boolean>((_, reject) =>
    setTimeout(() => reject(new Error('db ping timeout')), timeoutMs),
  );
  return Promise.race([probe, timeout]);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('MySQL pool closed');
  }
}
