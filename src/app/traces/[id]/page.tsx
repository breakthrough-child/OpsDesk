import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, PageTitle, money, ms, when } from '@/components/ui';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Step { id: string; seq: number; kind: string; name: string; latency_ms: number; tokens_in: number; tokens_out: number; cost_usd: number; data: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any

const KIND: Record<string, string> = {
  classify: 'bg-violet-100 text-violet-800 border-violet-300', retrieval: 'bg-sky-100 text-sky-800 border-sky-300', model: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  tool: 'bg-emerald-100 text-emerald-800 border-emerald-300', policy: 'bg-amber-100 text-amber-900 border-amber-300', approval: 'bg-orange-100 text-orange-900 border-orange-300',
  escalation: 'bg-red-100 text-red-800 border-red-300', guard: 'bg-rose-100 text-rose-800 border-rose-300', respond: 'bg-stone-200 text-stone-800 border-stone-300', error: 'bg-red-200 text-red-900 border-red-400',
};

function Detail({ s }: { s: Step }) {
  const d = s.data;
  if (s.kind === 'retrieval') {
    return (
      <div className="space-y-2 text-xs">
        <p><span className="text-stone-500">query</span> {String(d.query).slice(0, 200)} · <span className="text-stone-500">variant</span> {d.variant?.chunker}/{d.variant?.mode}/{d.variant?.rerank} · <span className="text-stone-500">confidence</span> <b>{Number(d.confidence).toFixed(2)}</b></p>
        {(d.notes as string[] | undefined)?.map((n) => <p key={n} className="text-stone-500">note: {n}</p>)}
        <ol className="space-y-1">{(d.chunks as Array<{ id: string; heading: string | null; score: number; coverage: number; preview: string }>).map((c, i) => (
          <li key={c.id} className="rounded-md bg-stone-50 p-2"><span className="font-mono text-[11px]">#{i + 1} {c.id}</span> <span className="text-stone-500">score {c.score.toFixed(3)} · coverage {c.coverage.toFixed(2)}</span><br />{c.heading}: {c.preview}…</li>))}</ol>
      </div>
    );
  }
  if (s.kind === 'tool') {
    return (
      <div className="grid gap-2 text-xs md:grid-cols-2">
        <div><p className="label mb-1">arguments {d.attempt ? `(attempt ${d.attempt})` : ''}</p><pre className="overflow-auto rounded-md bg-stone-50 p-2">{JSON.stringify(d.args, null, 2)}</pre></div>
        <div><p className="label mb-1">{d.error || d.rejected ? 'error' : 'result'}</p><pre className="overflow-auto rounded-md bg-stone-50 p-2">{JSON.stringify(d.error ?? (d.rejected ? { rejected: d.rejected, message: d.message } : d.result), null, 2)}</pre></div>
      </div>
    );
  }
  if (s.kind === 'policy') return <p className="text-xs"><Badge value={d.decision === 'safe' ? 'ok' : d.decision === 'approval' ? 'pending' : 'denied'} label={d.decision} /> {d.reason}</p>;
  return <pre className="max-h-64 overflow-auto rounded-md bg-stone-50 p-2 text-xs">{JSON.stringify(d, null, 2)}</pre>;
}

export default async function Trace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [t] = await db.query<{ id: string; message_id: string | null; status: string; started_at: string; tokens_in: number; tokens_out: number; cost_usd: number; latency_ms: number; summary: Record<string, unknown> }>('select * from traces where id = $1', [id]);
  if (!t) notFound();
  const steps = await db.query<Step>('select * from trace_steps where trace_id = $1 order by seq', [id]);
  const total = Math.max(1, ...steps.map((s) => s.latency_ms), t.latency_ms) ;
  const stat = (label: string, v: string) => <div className="card px-4 py-3"><p className="label">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{v}</p></div>;
  return (
    <div className="space-y-5">
      <PageTitle title="Trace" sub={`${t.id} · ${when(t.started_at)}`} right={t.message_id ? <Link href={`/messages/${t.message_id}`} className="btn btn-ghost">← Conversation</Link> : undefined} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stat('Total latency', ms(t.latency_ms))}{stat('Cost', money(t.cost_usd))}{stat('Tokens in', t.tokens_in.toLocaleString())}{stat('Tokens out', t.tokens_out.toLocaleString())}
        <div className="card px-4 py-3"><p className="label">Status</p><div className="mt-1"><Badge value={t.status === 'awaiting_approval' ? 'pending' : t.status === 'escalated' ? 'escalated' : 'ok'} label={t.status} /></div></div>
      </div>
      <ol className="relative space-y-3 border-l-2 border-stone-200 pl-5">
        {steps.map((s) => (
          <li key={s.id} className="relative">
            <span className={`absolute -left-[1.72rem] top-3 h-3 w-3 rounded-full border-2 ${KIND[s.kind]?.split(' ').filter((c) => c.startsWith('border')).join(' ') ?? 'border-stone-300'} bg-white`} />
            <details open={['retrieval', 'tool', 'policy', 'escalation', 'guard'].includes(s.kind)} className="card">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="text-xs tabular-nums text-stone-400">{String(s.seq + 1).padStart(2, '0')}</span>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${KIND[s.kind] ?? ''}`}>{s.kind}</span>
                <span className="text-sm font-medium">{s.name}</span>
                <span className="ml-auto flex items-center gap-3 text-xs tabular-nums text-stone-500">
                  {(s.tokens_in > 0 || s.tokens_out > 0) && <span>{s.tokens_in}→{s.tokens_out} tok</span>}
                  {s.cost_usd > 0 && <span>{money(s.cost_usd)}</span>}
                  <span className="w-14 text-right">{ms(s.latency_ms)}</span>
                </span>
                <span className="basis-full"><span className="block h-1 rounded bg-stone-100"><span className="block h-1 rounded bg-stone-800" style={{ width: `${Math.max(1, (s.latency_ms / total) * 100)}%` }} /></span></span>
              </summary>
              <div className="border-t border-stone-100 px-4 py-3"><Detail s={s} /></div>
            </details>
          </li>))}
      </ol>
    </div>
  );
}
