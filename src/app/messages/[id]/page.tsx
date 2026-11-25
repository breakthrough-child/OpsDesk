import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApprovalActions } from '@/components/ApprovalActions';
import { FeedbackControl } from '@/components/FeedbackControl';
import { Badge, PageTitle, when } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [m] = await db.query<Record<string, any>>('select * from messages where id = $1', [id]); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!m) notFound();
  const session = await getSession();
  const approvals = await db.query<Record<string, any>>('select * from approvals where message_id = $1 order by created_at', [id]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const cites = (m.citations as Array<{ id: string }> | null) ?? [];
  const chunks = cites.length ? await db.query<{ id: string; heading: string | null; title: string; content: string }>('select c.id, c.heading, d.title, c.content from chunks c join documents d on d.id = c.doc_id where c.id = any($1)', [cites.map((c) => c.id)]) : [];
  const actions = (m.actions as Array<{ tool: string; args: Record<string, unknown>; ok: boolean; gated: boolean; error?: string }>) ?? [];
  return (
    <div className="space-y-5">
      <PageTitle title={m.subject} sub={`${m.customer_email} · ${when(m.received_at)} · ${m.channel}`} right={<div className="flex items-center gap-2"><Badge value={m.status} />{m.trace_id && <Link href={`/traces/${m.trace_id}`} className="btn btn-ghost">Open trace →</Link>}</div>} />
      <section className="card p-4"><p className="label mb-1">Customer message</p><p className="whitespace-pre-wrap text-sm">{m.body}</p>
        {m.intent && <p className="mt-3 text-xs text-stone-500">Classified as <b>{String(m.intent).replace(/_/g, ' ')}</b> · urgency {m.urgency}</p>}</section>
      {m.escalation_reason && <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><b>Escalated to a human:</b> {m.escalation_reason}</section>}
      <section className="card p-4"><p className="label mb-1">Agent reply (draft, pending approval before sending)</p><p className="whitespace-pre-wrap text-sm">{m.reply_text ?? 'No reply yet.'}</p>
        {chunks.length > 0 && <div className="mt-4 space-y-2 border-t border-stone-100 pt-3"><p className="label">Cited sources</p>
          {chunks.map((c) => <blockquote key={c.id} className="rounded-lg bg-amber-50 p-3 text-xs text-stone-700"><span className="font-mono text-[11px] text-stone-500">{c.id}</span><br />{c.heading ?? c.title}: {c.content}</blockquote>)}</div>}
        <div className="mt-4 border-t border-stone-100 pt-3"><FeedbackControl target="reply" traceId={m.trace_id} messageId={m.id} /></div></section>
      <section className="card p-4"><p className="label mb-2">Actions taken by the agent</p>
        {actions.length === 0 ? <p className="text-sm text-stone-500">No tool calls.</p> : <ul className="space-y-1 text-sm">{actions.map((a, i) => <li key={i} className="flex items-center gap-2"><code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{a.tool}</code><Badge value={a.gated ? 'pending' : a.ok ? 'ok' : 'error'} label={a.gated ? 'held for approval' : a.ok ? 'ok' : a.error ?? 'error'} /><span className="truncate text-xs text-stone-500">{JSON.stringify(a.args).slice(0, 120)}</span></li>)}</ul>}</section>
      {approvals.length > 0 && <section className="space-y-3"><h2 className="text-sm font-semibold">Approvals</h2>
        {approvals.map((a) => (
          <div key={a.id} className="card space-y-2 p-4"><div className="flex items-center justify-between"><code className="text-sm font-medium">{a.tool}</code><Badge value={a.status} /></div>
            <pre className="overflow-x-auto rounded-lg bg-stone-50 p-2 text-xs">{JSON.stringify(a.edited_args ?? a.args, null, 2)}</pre>
            {a.reasoning && <p className="text-xs text-stone-600">Agent reasoning: {a.reasoning}</p>}
            {a.status === 'pending' ? <ApprovalActions id={a.id} args={a.args} canAct={Boolean(session)} /> : <><p className="text-xs text-stone-500">Decided by {a.decided_by ?? '—'}{a.result ? ` · result: ${JSON.stringify(a.result).slice(0, 140)}` : ''}</p><FeedbackControl target="approval" approvalId={a.id} traceId={a.trace_id} messageId={m.id} /></>}
          </div>))}</section>}
    </div>
  );
}
