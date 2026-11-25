import type { Db } from '../db';

export async function recordIntegration(db: Db, name: string, mode: 'live' | 'mock', ok: boolean, error?: string) {
  await db.query(
    `insert into integration_status(name, mode, last_success_at, last_error_at, last_error, updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (name) do update set mode = excluded.mode,
       last_success_at = coalesce(excluded.last_success_at, integration_status.last_success_at),
       last_error_at = coalesce(excluded.last_error_at, integration_status.last_error_at),
       last_error = case when excluded.last_error_at is not null then excluded.last_error else integration_status.last_error end,
       updated_at = now()`,
    [name, mode, ok ? new Date().toISOString() : null, ok ? null : new Date().toISOString(), ok ? null : (error ?? 'unknown error').slice(0, 500)],
  ).catch(() => undefined);
}
