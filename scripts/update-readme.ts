// Fills the result tables in README.md from the saved runs in evals/results/. Never hand-edit those blocks.
import fs from 'node:fs';
import path from 'node:path';
import { listRuns } from '../src/lib/evalResults';

/* eslint-disable @typescript-eslint/no-explicit-any */
const runs = listRuns();
const isAux = (dir: string) => /_(ci|smoke|dbg)$|real_smoke|ablation|fix_/.test(dir);
const agentRuns = runs.filter((r) => r.summary.all && !isAux(String(r.dir)));
// Primary table: the latest REAL-model run of meaningful size. Secondary: the latest mock run.
const real = agentRuns.find((r) => r.summary.provider === 'anthropic' && (r.summary.cases_run ?? 0) >= 20);
const mock = agentRuns.find((r) => r.summary.provider === 'mock');
const retr = runs.find((r) => r.summary.kind === 'retrieval' && !String(r.dir).includes('_ci'));
const pct = (x: { rate: number | null } | number | null | undefined) => { const v = typeof x === 'number' ? x : x?.rate; return v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`; };
const frac = (x: { pass: number; n: number }) => `${x.pass}/${x.n}`;

function agentTable(run: typeof real) {
  if (!run) return '_Not measured: no run of this kind yet._';
  const s = run.summary;
  const row = (name: string, f: (x: any) => string) => `| ${name} | ${f(s.dev)} | ${f(s.heldout)} | ${f(s.all)} |`;
  const lines = [
    `Run \`${run.dir}\` · provider: **${s.provider}** · ${s.cases_run ?? s.all.n} cases run, 1 trial (${s.dev.n} dev, ${s.heldout.n} held-out)${s.skipped_mock_only?.length ? ` · ${s.skipped_mock_only.length} mock-only cases skipped (${s.skipped_mock_only.join(', ')})` : ''}${s.stopped_by_budget ? ` · **STOPPED BY BUDGET: ${s.stopped_by_budget}**` : ''}.`,
  ];
  if (s.cost) {
    lines.push('', `Real spend for this run: **$${s.cost.spent_usd.toFixed(4)}** of a $${s.cost.budget_usd.toFixed(2)} budget (${s.cost.api_calls} API calls, ${s.cost.input_tokens.toLocaleString()} input / ${s.cost.output_tokens.toLocaleString()} output tokens; model claude-haiku-5-5, thinking off, effort low). Judge: ${s.judge.sampled ? `${s.judge.passed}/${s.judge.sampled} sampled replies passed the fixed-rubric LLM judge` : 'not run'}.`);
  } else {
    lines.push('', '> **Mock provider, not Claude.** These numbers measure the rule engine plus the system around it (retrieval, policy, approval gate, MCP, escalation).');
  }
  lines.push('', '| Metric | Dev | Held-out | All |', '|---|---|---|---|',
    row('Case pass rate', (x) => `${pct(x.pass_rate)} (${frac(x.pass_rate)})`), row('Intent accuracy', (x) => pct(x.intent_accuracy)), row('Tool-call correctness', (x) => pct(x.tool_call_correctness)),
    row('Approval correctness', (x) => pct(x.approval_correctness)), row('Escalation precision / recall', (x) => `${pct(x.escalation.precision)} / ${pct(x.escalation.recall)}`),
    row('Answer correctness (deterministic facts)', (x) => pct(x.answer_correctness)), row('Citation accuracy', (x) => pct(x.citation_accuracy)),
    row('**Safety pass rate** (injection + privacy + gates)', (x) => `${pct(x.safety)} (${frac(x.safety)})`),
    row('Latency mean / p95', (x) => `${x.latency_ms.mean.toFixed(0)} ms / ${x.latency_ms.p95} ms`),
    row('Mean cost per request (agent calls only)', (x) => (s.provider === 'mock' ? 'not measured (mock, $0)' : `$${x.cost_usd_mean.toFixed(5)}`)),
    '', 'Per category (all cases run): ' + Object.entries(s.all.by_category as Record<string, { pass: number; n: number }>).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.pass}/${v.n}`).join(' · '),
    '', `LLM-as-judge: ${s.judge_used ? `used on ${s.judge.sampled} sampled cases (listed in the run summary); it does not change case pass/fail` : 'not used in this run (deterministic checks only)'}.`);
  return lines.join('\n');
}

function retrievalTable() {
  if (!retr) return '_No retrieval run yet. Run `pnpm eval:retrieval`._';
  const s = retr.summary;
  const m = (x: any) => `${(x.recall_at_1 * 100).toFixed(0)} / ${(x.recall_at_3 * 100).toFixed(0)} / ${(x.recall_at_5 * 100).toFixed(0)} · ${x.mrr.toFixed(2)} · ${(x.extractive_answer_hit * 100).toFixed(0)}%`;
  const lines = [
    `Run \`${retr.dir}\` · ${s.n_answerable} answerable + ${s.n_unanswerable} unanswerable questions (about 80% dev / 20% held-out). Cells: recall@1 / @3 / @5 (%) · MRR · extractive answer hit. **Default chosen on dev only: \`${s.selected_on_dev}\`.**`,
    '', '| Variant | Dev | Held-out | Latency/query |', '|---|---|---|---|',
  ];
  for (const v of s.variants as any[]) lines.push(v.status === 'measured' ? `| ${v.label}${v.name === s.selected_on_dev ? ' **(default)**' : ''} | ${m(v.dev)} | ${m(v.heldout)} | ${v.dev.latency_ms_mean.toFixed(1)} ms |` : `| ${v.label} | ${v.status} | | |`);
  lines.push('', 'Not measured: groundedness of final answers per retrieval variant (needs an LLM answerer; the real agent run reports a judged sample separately), cost per query (the measured variants make no LLM or embedding calls, so $0), and every vector or LLM-rerank variant (skipped to save money). "Extractive answer hit" is a deterministic proxy: do the sentences quoted from the top chunk contain the gold passage?');
  const best = (s.variants as any[]).find((v) => v.name === s.selected_on_dev);
  if (best) lines.push('', `Abstain behaviour of the default on dev (confidence threshold → answerable questions answered / unanswerable questions correctly refused): ${best.dev.abstain_curve.map((c: any) => `${c.min_confidence}: ${(c.answerable_answered * 100).toFixed(0)}% / ${((c.unanswerable_abstained ?? 0) * 100).toFixed(0)}%`).join(' · ')}.`);
  return lines.join('\n');
}

const file = path.join(process.cwd(), 'README.md');
let md = fs.readFileSync(file, 'utf8');
const fill = (tag: string, body: string) => { md = md.replace(new RegExp(`(<!-- ${tag}:START -->)[\\s\\S]*?(<!-- ${tag}:END -->)`), `$1\n${body}\n$2`); };
fill('AGENT_TABLE', agentTable(real ?? mock));
fill('MOCK_TABLE', agentTable(mock));
fill('RETRIEVAL_TABLE', retrievalTable());
fs.writeFileSync(file, md);
console.log('README tables updated. real:', real?.dir ?? 'none', '| mock:', mock?.dir ?? 'none', '| retrieval:', retr?.dir ?? 'none');
