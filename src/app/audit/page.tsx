import { Badge, PageTitle, when } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listAudit } from '../../../mcp-server/audit';

export const dynamic = 'force-dynamic';

export default async function Audit({ searchParams }: { searchParams: Promise<{ actor?: string; tool?: string; status?: string }> }) {
  const f = await searchParams;
  const session = await getSession();
  const db = await getDb();
  const rows = await listAudit(db, { ...f, limit: 200 });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const input = 'rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm';
  return (
    <div className="space-y-4">
      <PageTitle title="Audit log" sub="Append-only record of every MCP tool call, including denied ones. Sensitive arguments are redacted." right={session ? <a href={`/api/audit/export?${qs}`} className="btn btn-ghost">Export CSV</a> : <span className="text-xs text-stone-500">Sign in to export CSV</span>} />
      <form className="flex flex-wrap gap-2"><input name="actor" defaultValue={f.actor} placeholder="actor" className={input} />
        <select name="tool" defaultValue={f.tool ?? ''} className={input}><option value="">all tools</option>{['lookup_order', 'create_ticket', 'list_available_slots', 'book_slot', 'draft_reply', 'issue_refund', 'send_reply', 'cancel_booking', 'delete_ticket'].map((t) => <option key={t}>{t}</option>)}</select>
        <select name="status" defaultValue={f.status ?? ''} className={input}><option value="">all statuses</option><option>ok</option><option>error</option><option>denied</option></select>
        <button className="btn btn-primary">Filter</button></form>
      <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr>{['Time', 'Actor', 'Role', 'Tool', 'Status', 'Error', 'ms', 'Trace'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-stone-500">No audit entries yet.</td></tr>}
        {rows.map((r) => <tr key={r.id} className="border-t border-stone-100"><td className="whitespace-nowrap px-3 py-2 text-xs">{when(r.ts)}</td><td className="px-3 py-2 text-xs">{r.actor}</td><td className="px-3 py-2 text-xs">{r.role}</td><td className="px-3 py-2"><code className="text-xs">{r.tool}</code></td><td className="px-3 py-2"><Badge value={r.status} /></td><td className="max-w-xs truncate px-3 py-2 text-xs text-stone-600" title={r.error ?? ''}>{r.error}</td><td className="px-3 py-2 text-xs tabular-nums">{r.latency_ms}</td><td className="px-3 py-2 text-xs">{r.trace_id && <a className="underline" href={`/traces/${r.trace_id}`}>{r.trace_id}</a>}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}
