import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const root = process.cwd();

async function openPglite(dir: string | undefined): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  const wrap = (c: { query: (sql: string, params?: unknown[]) => Promise<unknown>; exec: (sql: string) => Promise<unknown> }, root: boolean): Db => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = (await c.query(sql, params as unknown[])) as { rows: Record<string, unknown>[]; fields?: Array<{ name: string; dataTypeID: number }> };
      // PGlite returns NUMERIC as a string; normalise to number like the pg driver path does.
      const numeric = (r.fields ?? []).filter((f) => f.dataTypeID === 1700).map((f) => f.name);
      if (numeric.length) for (const row of r.rows) for (const n of numeric) if (typeof row[n] === 'string') row[n] = parseFloat(row[n] as string);
      return r.rows as T[];
    },
    async exec(sql) { await c.exec(sql); },
    async tx(fn) {
      // PGlite is single connection: transaction() serialises for us.
      if (!root) return fn(wrap(c, false));
      return pg.transaction(async (t) => fn(wrap(t as unknown as typeof c, false)));
    },
    async close() { if (root) await pg.close(); },
  });
  return wrap(pg, true);
}

async function openPg(url: string): Promise<Db> {
  const pgmod = await import('pg');
  const { Pool, types } = pgmod.default ?? pgmod;
  types.setTypeParser(1700, (v: string) => parseFloat(v));
  types.setTypeParser(20, (v: string) => parseInt(v, 10));
  const pool = new Pool({ connectionString: url, max: 5, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, own: boolean): Db => ({
    async query<T>(sql: string, params?: unknown[]) { return (await c.query(sql, params)).rows as T[]; },
    async exec(sql) { await c.query(sql); },
    async tx(fn) {
      if (!own) return fn(wrap(c, false));
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client, false));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { if (own) await pool.end(); },
  });
  return wrap(pool, true);
}

/** Create a database handle. Tests/evals pass memory: true for a fresh in-memory Postgres (PGlite). */
export async function openDb(opts: { memory?: boolean } = {}): Promise<Db> {
  if (opts.memory) return openPglite(undefined);
  if (config.databaseUrl) return openPg(config.databaseUrl);
  const dir = config.pgliteDir;
  return openPglite(dir === ':memory:' ? undefined : dir);
}

export async function migrate(db: Db, opts: { vector?: boolean } = {}): Promise<string[]> {
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
  const dir = path.join(root, 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') || (opts.vector && f.endsWith('.sql.optional'))).sort();
  const applied = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    await db.query('insert into schema_migrations(name) values ($1)', [f]);
    ran.push(f);
  }
  return ran;
}

let shared: Promise<Db> | undefined;
const g = globalThis as unknown as { __opsdeskDb?: Promise<Db> };

/** Process-wide database with auto migrate + seed so a fresh clone or Vercel cold start just works. */
export function getDb(): Promise<Db> {
  if (shared) return shared;
  shared = g.__opsdeskDb ??= (async () => {
    const db = await openDb();
    await migrate(db, { vector: false });
    if (process.env.AUTO_SEED !== '0') {
      const { seedIfEmpty } = await import('./seed');
      await seedIfEmpty(db);
    }
    return db;
  })();
  return shared;
}

export function setSharedDb(db: Db) {
  shared = Promise.resolve(db);
  g.__opsdeskDb = shared;
}
