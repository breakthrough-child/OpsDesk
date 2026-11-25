import Link from 'next/link';
import { PageTitle, when } from '@/components/ui';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Feedback() {
  const db = await getDb();
  const totals = await db.query<{ target: string; rating: string; n: number }>('select target, rating, count(*)::int as n from feedback group by target, rating');
  const reasons = await db.query<{ reason: string; n: number }>("select reason, count(*)::int as n from feedback where rating = 'down' and reason is not null group by reason order by n desc");
  const recent = await db.query<{ id: string; trace_id: string | null; target: string; rating: string; reason: string | null; note: string | null; created_at: string }>('select * from feedback order by created_at desc limit 50');
  const n = (t: string, r: string) => totals.find((x) => x.target === t && x.rating === r)?.n ?? 0;
  return (
    <div className="space-y-5">
      <PageTitle title="Feedback" sub="Thumbs on agent replies and approval decisions, stored with the trace id. Pilot not yet run: this page shows only what has been submitted." />
      <div className="grid gap-3 sm:grid-cols-4">{[['Replies 👍', n('reply', 'up')], ['Replies 👎', n('reply', 'down')], ['Approvals 👍', n('approval', 'up')], ['Approvals 👎', n('approval', 'down')]].map(([l, v]) => <div key={l as string} className="card px-4 py-3"><p className="label">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></div>)}</div>
      <div className="card p-4"><p className="label mb-2">Most common complaints</p>{reasons.length === 0 ? <p className="text-sm text-stone-500">No complaints recorded.</p> : <ul className="space-y-1 text-sm">{reasons.map((r) => <li key={r.reason}>{r.reason.replace(/_/g, ' ')} <b>×{r.n}</b></li>)}</ul>}</div>
      <div className="card divide-y divide-stone-100"><p className="label px-4 py-3">Recent</p>{recent.length === 0 && <p className="px-4 pb-4 text-sm text-stone-500">Nothing yet.</p>}{recent.map((f) => <div key={f.id} className="px-4 py-3 text-sm"><span>{f.rating === 'up' ? '👍' : '👎'} {f.target}</span> {f.reason && <span className="text-stone-600">· {f.reason.replace(/_/g, ' ')}</span>} <span className="text-xs text-stone-400">· {when(f.created_at)}</span>{f.trace_id && <> · <Link className="text-xs underline" href={`/traces/${f.trace_id}`}>trace</Link></>}{f.note && <p className="mt-1 text-xs text-stone-600">{f.note}</p>}</div>)}</div>
    </div>
  );
}
