import type { Db } from '../db';

/** Fixed-window rate limiter backed by Postgres so it holds across serverless instances. */
export async function rateLimit(db: Db, key: string, limit: number, windowSec: number, nowMs = Date.now()): Promise<{ allowed: boolean; remaining: number }> {
  const window = Math.floor(nowMs / (windowSec * 1000));
  const rows = await db.query<{ count: number }>(
    `insert into rate_limits(key, window_start, count) values ($1, $2, 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count`,
    [key, window],
  );
  const count = rows[0]!.count;
  if (Math.random() < 0.01) await db.query('delete from rate_limits where window_start < $1', [window - 5]);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
