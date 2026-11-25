import Link from 'next/link';
import { Badge, PageTitle, when } from '@/components/ui';
import { SimulateBox } from '@/components/SimulateBox';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Inbox() {
  const db = await getDb();
  const customers = await db.query<{ email: string; name: string }>('select email, name from customers order by name');
  const msgs = await db.query<{ id: string; customer_email: string; subject: string; status: string; received_at: string; intent: string | null; escalation_reason: string | null }>('select id, customer_email, subject, status, received_at, intent, escalation_reason from messages order by received_at desc limit 50');
  const counts = await db.query<{ status: string; n: number }>('select status, count(*)::int as n from messages group by status');
  return (
    <div className="space-y-6">
      <PageTitle title="Inbox" sub="Inbound customer messages handled by the agent" right={<div className="flex gap-2 text-xs">{counts.map((c) => <span key={c.status} className="flex items-center gap-1"><Badge value={c.status} /> {c.n}</span>)}</div>} />
      <SimulateBox customers={customers} />
      <div className="card divide-y divide-stone-100">
        {msgs.length === 0 && <p className="p-6 text-sm text-stone-500">No messages yet. Simulate one above.</p>}
        {msgs.map((m) => (
          <Link key={m.id} href={`/messages/${m.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-stone-50">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.subject}</p><p className="truncate text-xs text-stone-500">{m.customer_email} · {when(m.received_at)}</p></div>
            {m.intent && <span className="hidden text-xs text-stone-500 sm:block">{m.intent.replace(/_/g, ' ')}</span>}
            <Badge value={m.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
