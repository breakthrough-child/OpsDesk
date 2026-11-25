import type { Db } from '../src/lib/db';
import { redact } from '../src/lib/util';

export interface AuditEntry {
  actor: string;
  role: string;
  tool: string;
  args: unknown;
  status: 'ok' | 'error' | 'denied';
  error?: string;
  latencyMs: number;
  traceId?: string;
}

/** Append-only (a DB trigger rejects UPDATE/DELETE). Sensitive argument fields are redacted before storage. */
export async function writeAudit(db: Db, e: AuditEntry) {
  await db.query(
    'insert into audit_log(actor, role, tool, args, status, error, latency_ms, trace_id) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [e.actor, e.role, e.tool, JSON.stringify(redact(e.args ?? {})), e.status, e.error ?? null, Math.round(e.latencyMs), e.traceId ?? null],
  );
}

export async function listAudit(db: Db, f: { actor?: string; tool?: string; status?: string; limit?: number } = {}) {
  const where: string[] = [];
  const p: unknown[] = [];
  for (const k of ['actor', 'tool', 'status'] as const) if (f[k]) { p.push(f[k]); where.push(`${k} = $${p.length}`); }
  p.push(f.limit ?? 500);
  return db.query<{ id: number; ts: string; actor: string; role: string; tool: string; args: unknown; status: string; error: string | null; latency_ms: number; trace_id: string | null }>(
    `select * from audit_log ${where.length ? `where ${where.join(' and ')}` : ''} order by id desc limit $${p.length}`,
    p,
  );
}
