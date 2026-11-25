import Link from 'next/link';
import { PageTitle, ms } from '@/components/ui';
import { listRuns } from '@/lib/evalResults';

export const dynamic = 'force-dynamic';

const pc = (x: { rate: number | null; pass: number; n: number } | undefined) => (!x || x.rate === null ? 'n/a' : `${(x.rate * 100).toFixed(1)}%`);
const frac = (x: { pass: number; n: number } | undefined) => (x ? `${x.pass}/${x.n}` : '');
const p2 = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export default async function Evals({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === 'retrieval' ? 'retrieval' : 'agent';
  const runs = listRuns();
  const agent = runs.filter((r) => r.summary.all);
  const retr = runs.filter((r) => r.summary.kind === 'retrieval');
  const latest = agent[0];
  const tabCls = (t: string) => `rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`;
  return (
    <div className="space-y-5">
      <PageTitle title="Evals" sub="Every number here is read from a saved run in evals/results/" right={<div className="flex gap-1"><Link href="/evals" className={tabCls('agent')}>Agent</Link><Link href="/evals?tab=retrieval" className={tabCls('retrieval')}>Retrieval</Link></div>} />
      {tab === 'agent' && (!latest ? <p className="card p-6 text-sm text-stone-500">No agent eval run yet. Run <code>pnpm eval</code>.</p> : (() => {
        const s = latest.summary;
        const metric = (label: string, d: { rate: number | null; pass: number; n: number } | undefined, h: { rate: number | null; pass: number; n: number } | undefined) => (
          <tr key={label} className="border-t border-stone-100"><td className="px-4 py-2">{label}</td><td className="px-4 py-2 tabular-nums">{pc(d)} <span className="text-xs text-stone-400">{frac(d)}</span></td><td className="px-4 py-2 tabular-nums">{pc(h)} <span className="text-xs text-stone-400">{frac(h)}</span></td></tr>);
        return (<>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>{s.provider === 'mock' ? 'Mock provider run.' : 'Model run.'}</b> {s.provider_note}</div>
          <p className="text-xs text-stone-500">Latest run: <code>{latest.dir}</code> · {s.all.n} cases · dev {s.dev.n} / held-out {s.heldout.n}</p>
          <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-4 py-2">Metric</th><th className="px-4 py-2">Dev</th><th className="px-4 py-2">Held-out</th></tr></thead><tbody>
            {metric('Overall case pass rate', s.dev.pass_rate, s.heldout.pass_rate)}{metric('Intent accuracy', s.dev.intent_accuracy, s.heldout.intent_accuracy)}{metric('Tool-call correctness', s.dev.tool_call_correctness, s.heldout.tool_call_correctness)}
            {metric('Approval correctness', s.dev.approval_correctness, s.heldout.approval_correctness)}{metric('Answer correctness (facts, deterministic)', s.dev.answer_correctness, s.heldout.answer_correctness)}{metric('Citation accuracy', s.dev.citation_accuracy, s.heldout.citation_accuracy)}{metric('Safety (injection + privacy)', s.dev.safety, s.heldout.safety)}
            <tr className="border-t border-stone-100"><td className="px-4 py-2">Escalation precision / recall</td><td className="px-4 py-2 tabular-nums">{p2(s.dev.escalation.precision)} / {p2(s.dev.escalation.recall)}</td><td className="px-4 py-2 tabular-nums">{p2(s.heldout.escalation.precision)} / {p2(s.heldout.escalation.recall)}</td></tr>
            <tr className="border-t border-stone-100"><td className="px-4 py-2">Latency mean / p95</td><td className="px-4 py-2 tabular-nums">{ms(s.dev.latency_ms.mean)} / {ms(s.dev.latency_ms.p95)}</td><td className="px-4 py-2 tabular-nums">{ms(s.heldout.latency_ms.mean)} / {ms(s.heldout.latency_ms.p95)}</td></tr>
            <tr className="border-t border-stone-100"><td className="px-4 py-2">Mean cost per request</td><td className="px-4 py-2 tabular-nums" colSpan={2}>{s.provider === 'mock' ? 'not measured (mock provider, $0)' : `$${s.all.cost_usd_mean.toFixed(4)}`}</td></tr>
          </tbody></table></div>
          <div className="card p-4"><p className="label mb-2">Per-category pass rate (all cases)</p><div className="grid gap-2 sm:grid-cols-2">{Object.entries(s.all.by_category as Record<string, { rate: number; pass: number; n: number }>).map(([k, v]) => <div key={k} className="flex items-center gap-3 text-sm"><span className="w-32 shrink-0 text-stone-600">{k.replace(/_/g, ' ')}</span><span className="h-2 flex-1 rounded bg-stone-100"><span className="block h-2 rounded bg-emerald-600" style={{ width: `${v.rate * 100}%` }} /></span><span className="w-12 text-right text-xs tabular-nums">{v.pass}/{v.n}</span></div>)}</div></div>
          <div className="card p-4"><p className="label mb-2">Failed dev cases ({s.dev_failures.length}). Held-out failures are intentionally not listed.</p>
            <ul className="space-y-1 text-sm">{(s.dev_failures as Array<{ id: string; traceId: string; notes: string[] }>).map((f) => <li key={f.id}><code className="text-xs">{f.id}</code> {f.notes.join('; ')}</li>)}</ul>
            <p className="mt-2 text-xs text-stone-500">Trace ids are saved per case in the run&apos;s results.jsonl (eval runs use an in-memory database, so traces are inspectable by re-running a case locally).</p></div>
          <div className="card overflow-x-auto"><p className="label px-4 pt-3">Run history</p><table className="mt-2 w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-4 py-2">Run</th><th className="px-4 py-2">Provider</th><th className="px-4 py-2">Dev pass</th><th className="px-4 py-2">Held-out pass</th><th className="px-4 py-2">Safety</th></tr></thead><tbody>
            {agent.map((r) => <tr key={r.dir} className="border-t border-stone-100"><td className="px-4 py-2 font-mono text-xs">{r.dir}</td><td className="px-4 py-2">{r.summary.provider}</td><td className="px-4 py-2 tabular-nums">{pc(r.summary.dev.pass_rate)}</td><td className="px-4 py-2 tabular-nums">{pc(r.summary.heldout.pass_rate)}</td><td className="px-4 py-2 tabular-nums">{pc(r.summary.all.safety)}</td></tr>)}</tbody></table></div>
        </>);
      })())}
      {tab === 'retrieval' && (!retr[0] ? <p className="card p-6 text-sm text-stone-500">No retrieval run yet. Run <code>pnpm eval:retrieval</code>.</p> : (() => {
        const s = retr[0]!.summary;
        type M = { recall_at_1: number; recall_at_3: number; recall_at_5: number; mrr: number; extractive_answer_hit: number; latency_ms_mean: number };
        const row = (v: { name: string; label: string; status: string; dev?: M; heldout?: M }) => v.status !== 'measured' ? <tr key={v.name} className="border-t border-stone-100 text-stone-400"><td className="px-3 py-2">{v.label}</td><td className="px-3 py-2" colSpan={7}>{v.status}</td></tr> : (
          <tr key={v.name} className={`border-t border-stone-100 ${v.name === s.selected_on_dev ? 'bg-emerald-50' : ''}`}><td className="px-3 py-2">{v.label}{v.name === s.selected_on_dev && <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">default (chosen on dev)</span>}</td>
            {[v.dev!, v.heldout!].map((m, i) => <td key={i} className="px-3 py-2 tabular-nums">{(m.recall_at_1 * 100).toFixed(0)} / {(m.recall_at_3 * 100).toFixed(0)} / {(m.recall_at_5 * 100).toFixed(0)}<br /><span className="text-xs text-stone-500">MRR {m.mrr.toFixed(2)} · ans {(m.extractive_answer_hit * 100).toFixed(0)}%</span></td>)}
            <td className="px-3 py-2 tabular-nums">{v.dev!.latency_ms_mean.toFixed(1)}ms</td></tr>);
        return (<>
          <p className="text-xs text-stone-500">{s.n_answerable} answerable + {s.n_unanswerable} unanswerable questions. Recall@1/3/5 (%), MRR, extractive answer hit. Groundedness with an LLM, cost per query and vector rows are not measured without API keys. Run: <code>{retr[0]!.dir}</code></p>
          <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="px-3 py-2">Variant</th><th className="px-3 py-2">Dev (80%)</th><th className="px-3 py-2">Held-out (20%)</th><th className="px-3 py-2">Latency</th></tr></thead><tbody>{(s.variants as Parameters<typeof row>[0][]).map(row)}</tbody></table></div>
        </>);
      })())}
    </div>
  );
}
