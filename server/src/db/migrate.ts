/**
 * Minimal, dependency-free SQL migration runner.
 *
 *   npm run db:migrate            # apply all pending migrations
 *   npm run db:status             # show applied / pending migrations
 *
 * Each migration is a plain `.sql` file in `./migrations`, applied in filename
 * order, recorded in the `_migrations` table with a checksum so accidental edits
 * to already-applied files are detected.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const name of entries) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
    files.push({ name, sql, checksum });
  }
  return files;
}

async function connect() {
  return mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true,
  });
}

async function ensureTable(conn: mysql.Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum   VARCHAR(64)  NOT NULL,
      applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getApplied(conn: mysql.Connection): Promise<Map<string, string>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT name, checksum FROM _migrations');
  return new Map(rows.map((r) => [r.name as string, r.checksum as string]));
}

async function up(): Promise<void> {
  const conn = await connect();
  try {
    await ensureTable(conn);
    const applied = await getApplied(conn);
    const files = await loadMigrations();
    let count = 0;
    for (const m of files) {
      const prev = applied.get(m.name);
      if (prev) {
        if (prev !== m.checksum) {
          throw new Error(
            `Migration "${m.name}" was modified after being applied (checksum mismatch). ` +
              `Create a new migration instead of editing applied ones.`,
          );
        }
        continue;
      }
      console.log(`▸ applying ${m.name}`);
      await conn.beginTransaction();
      try {
        await conn.query(m.sql);
        await conn.query('INSERT INTO _migrations (name, checksum) VALUES (?, ?)', [m.name, m.checksum]);
        await conn.commit();
        count++;
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }
    console.log(count === 0 ? '✓ database is up to date' : `✓ applied ${count} migration(s)`);
  } finally {
    await conn.end();
  }
}

async function status(): Promise<void> {
  const conn = await connect();
  try {
    await ensureTable(conn);
    const applied = await getApplied(conn);
    const files = await loadMigrations();
    for (const m of files) {
      console.log(`${applied.has(m.name) ? '✓ applied ' : '· pending '} ${m.name}`);
    }
  } finally {
    await conn.end();
  }
}

const command = process.argv[2] ?? 'up';
const run = command === 'status' ? status : up;
run().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
