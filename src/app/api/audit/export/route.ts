import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listAudit } from '../../../../../mcp-server/audit';

export const dynamic = 'force-dynamic';

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  if (!(await requireAdmin()).ok) return new Response('unauthorized', { status: 401 });
  const u = new URL(req.url);
  const rows = await listAudit(await getDb(), { actor: u.searchParams.get('actor') || undefined, tool: u.searchParams.get('tool') || undefined, status: u.searchParams.get('status') || undefined, limit: 5000 });
  const head = 'id,timestamp,actor,role,tool,status,error,latency_ms,trace_id,args';
  const body = rows.map((r) => [r.id, new Date(r.ts).toISOString(), r.actor, r.role, r.tool, r.status, r.error, r.latency_ms, r.trace_id, JSON.stringify(r.args)].map(csv).join(',')).join('\n');
  return new Response(`${head}\n${body}\n`, { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="opsdesk-audit.csv"' } });
}
