import Link from 'next/link';
import { ApprovalActions } from '@/components/ApprovalActions';
import { Badge, PageTitle, when } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Approvals() {
  const db = await getDb();
  const session = await getSession();
  const rows = await db.query<Record<string, any>>("select a.*, m.subject, m.customer_email from approvals a left join messages m on m.id = a.message_id order by (a.status = 'pending') desc, a.created_at desc limit 60"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const pending = rows.filter((r) => r.status === 'pending');
  const done = rows.filter((r) => r.status !== 'pending');
  const Card = ({ a }: { a: Record<string, any> }) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><code className="rounded bg-stone-900 px-2 py-0.5 text-xs text-amber-100">{a.tool}</code><Badge value={a.status} /></div>
        <Link href={`/messages/${a.message_id}`} className="text-xs text-stone-500 underline">{a.subject ?? a.message_id}</Link></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="label mb-1">Arguments</p><pre className="overflow-x-auto rounded-lg bg-stone-50 p-2 text-xs">{JSON.stringify(a.edited_args ?? a.args, null, 2)}</pre></div>
        <div className="space-y-2"><div><p className="label mb-1">Agent reasoning</p><p className="text-sm text-stone-700">{a.reasoning}</p></div>
          <div><p className="label mb-1">Evidence</p><pre className="max-h-40 overflow-auto rounded-lg bg-stone-50 p-2 text-xs">{JSON.stringify(a.evidence, null, 2)}</pre></div></div></div>
      {a.status === 'pending' ? <ApprovalActions id={a.id} args={a.args} canAct={Boolean(session)} /> : <p className="text-xs text-stone-500">Decided by {a.decided_by} at {a.decided_at ? when(a.decided_at) : '—'}{a.result ? ` · ${JSON.stringify(a.result).slice(0, 160)}` : ''}</p>}
    </div>
  );
  return (
    <div className="space-y-5">
      <PageTitle title="Approvals" sub="Risky actions are held here. Nothing executes until a human approves; approvals are idempotent." />
      {!session && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">You are viewing as a visitor. Sign in as admin to approve, edit or reject.</p>}
      <h2 className="text-sm font-semibold">Pending ({pending.length})</h2>
      {pending.length === 0 && <p className="text-sm text-stone-500">Nothing waiting.</p>}
      {pending.map((a) => <Card key={a.id} a={a} />)}
      {done.length > 0 && <h2 className="pt-2 text-sm font-semibold">Decided</h2>}
      {done.map((a) => <Card key={a.id} a={a} />)}
    </div>
  );
}
