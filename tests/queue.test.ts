import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueue, runWorker } from '../src/lib/queue/queue';
import { backoffMs, withRetry } from '../src/lib/retry';
import { makeEnv } from './helpers';

let env: Awaited<ReturnType<typeof makeEnv>>;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.close(); });

describe('queue', () => {
  it('retries with exponential backoff and then dead-letters after max attempts', async () => {
    const id = await enqueue(env.db, 'always_fails', { x: 1 }, { maxAttempts: 3 });
    let calls = 0;
    const handlers = { always_fails: async () => { calls++; throw new Error('boom'); } };
    // baseMs=0 so retries are immediately due.
    const s = await runWorker(env.db, handlers, { baseMs: 0, max: 10 });
    expect(calls).toBe(3);
    expect(s).toEqual({ done: 0, retried: 2, dead: 1 });
    const [job] = await env.db.query<{ status: string; attempts: number; last_error: string }>('select status, attempts, last_error from queue_jobs where id = $1', [id]);
    expect(job).toMatchObject({ status: 'dead', attempts: 3, last_error: 'boom' });
    const dl = await env.db.query<{ job_id: string; error: string }>('select job_id, error from dead_letters');
    expect(dl).toEqual([{ job_id: id, error: 'boom' }]);
  });
  it('schedules the retry in the future (backoff) rather than immediately', async () => {
    const id = await enqueue(env.db, 'flaky', {}, { maxAttempts: 5 });
    await runWorker(env.db, { flaky: async () => { throw new Error('x'); } }, { baseMs: 60_000, max: 1 });
    const [j] = await env.db.query<{ status: string; wait: number }>("select status, extract(epoch from (run_at - now()))::float8 as wait from queue_jobs where id = $1", [id]);
    expect(j!.status).toBe('queued');
    expect(j!.wait).toBeGreaterThan(30);
  });
  it('completes a job that succeeds', async () => {
    const id = await enqueue(env.db, 'ok', {});
    const s = await runWorker(env.db, { ok: async () => undefined }, { max: 5 });
    expect(s.done).toBeGreaterThanOrEqual(1);
    expect((await env.db.query<{ status: string }>('select status from queue_jobs where id = $1', [id]))[0]!.status).toBe('done');
  });
  it('backoff grows exponentially and is capped', () => {
    expect([0, 1, 2, 3].map((a) => backoffMs(a, 100))).toEqual([100, 200, 400, 800]);
    expect(backoffMs(30, 100, 5000)).toBe(5000);
  });
  it('withRetry stops at the cap', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error('no'); }, { retries: 2, baseMs: 1 })).rejects.toThrow('no');
    expect(n).toBe(3);
  });
});
