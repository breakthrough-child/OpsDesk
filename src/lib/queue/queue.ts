import type { Db } from '../db';
import { backoffMs } from '../retry';
import { newId } from '../util';

export interface Job { id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }

export async function enqueue(db: Db, kind: string, payload: Record<string, unknown>, o: { maxAttempts?: number } = {}) {
  const id = newId('job');
  await db.query('insert into queue_jobs(id, kind, payload, max_attempts) values ($1,$2,$3,$4)', [id, kind, JSON.stringify(payload), o.maxAttempts ?? 5]);
  return id;
}

/** Claim one ready job. Stale 'running' jobs (crashed worker) are returned to the queue first. */
export async function claim(db: Db, staleAfterSec = 300): Promise<Job | null> {
  await db.query(`update queue_jobs set status = 'queued' where status = 'running' and locked_at < now() - ($1 || ' seconds')::interval`, [String(staleAfterSec)]);
  const rows = await db.query<Job>(
    `update queue_jobs set status = 'running', locked_at = now(), attempts = attempts + 1
      where id = (select id from queue_jobs where status = 'queued' and run_at <= now() order by run_at, created_at limit 1 for update skip locked)
      returning id, kind, payload, attempts, max_attempts`,
  );
  return rows[0] ?? null;
}

export async function complete(db: Db, id: string) { await db.query("update queue_jobs set status = 'done', last_error = null where id = $1", [id]); }

/** Retry with exponential backoff; after max_attempts move to the dead-letter table. */
export async function fail(db: Db, job: Job, error: string, baseMs = 2000): Promise<'retry' | 'dead'> {
  if (job.attempts >= job.max_attempts) {
    await db.tx(async (tx) => {
      await tx.query("update queue_jobs set status = 'dead', last_error = $2 where id = $1", [job.id, error]);
      await tx.query('insert into dead_letters(id, job_id, kind, payload, error, attempts) values ($1,$2,$3,$4,$5,$6)', [newId('dl'), job.id, job.kind, JSON.stringify(job.payload), error, job.attempts]);
    });
    return 'dead';
  }
  const delay = backoffMs(job.attempts - 1, baseMs, 15 * 60_000);
  await db.query(`update queue_jobs set status = 'queued', last_error = $2, run_at = now() + ($3 || ' milliseconds')::interval where id = $1`, [job.id, error, String(delay)]);
  return 'retry';
}

export type Handler = (job: Job) => Promise<void>;

/** Process up to `max` ready jobs. Returns counts. */
export async function runWorker(db: Db, handlers: Record<string, Handler>, o: { max?: number; baseMs?: number } = {}) {
  const stats = { done: 0, retried: 0, dead: 0 };
  for (let i = 0; i < (o.max ?? 20); i++) {
    const job = await claim(db);
    if (!job) break;
    try {
      const h = handlers[job.kind];
      if (!h) throw new Error(`no handler for ${job.kind}`);
      await h(job);
      await complete(db, job.id);
      stats.done++;
    } catch (e) {
      const r = await fail(db, job, e instanceof Error ? e.message : String(e), o.baseMs);
      if (r === 'dead') stats.dead++; else stats.retried++;
    }
  }
  return stats;
}
