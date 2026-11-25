// Fills the result tables in README.md from the latest saved runs in evals/results/. Never hand-edit those blocks.
import fs from 'node:fs';
import path from 'node:path';
import { listRuns } from '../src/lib/evalResults';

const runs = listRuns();
const agent = runs.find((r) => r.summary.all && !String(r.dir).includes('_ci'));
const retr = runs.find((r) => r.summary.kind === 'retrieval' && !String(r.dir).includes('_ci'));
const pct = (x: { rate: number | null } | number | null | undefined) => { const v = typeof x === 'number' ? x : x?.rate; return v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`; };
const frac = (x: { pass: number; n: number }) => `${x.pass}/${x.n}`;

function agentTable() {
  if (!agent) return '_No agent eval run yet. Run `pnpm eval`._';
  const s = agent.summary;
  const row = (name: string, f: (x: any) => string) => `| ${name} | ${f(s.dev)} | ${f(s.heldout)} | ${f(s.all)} |`; // eslint-disable-line @typescript-eslint/no-explicit-any
  return [
    `Run \`${agent.dir}\` · provider: **${s.provider}** · ${s.all.n} cases (${s.dev.n} dev, ${s.heldout.n} held-out).`,
    s.provider === 'mock' ? '\n> **These numbers come from the deterministic mock provider, not from Claude.** They measure the rule engine plus the system around it (retrieval, policy, approval gate, MCP, escalation). Model numbers: not yet measured (no API key was available). Run `pnpm eval` with `ANTHROPIC_API_KEY` set.\n' : '',
    '| Metric | Dev | Held-out | All |', '|---|---|---|---|',
    row('Case pass rate', (x) => `${pct(x.pass_rate)} (${frac(x.pass_rate)})`), row('Intent accuracy', (x) => pct(x.intent_accuracy)), row('Tool-call correctness', (x) => pct(x.tool_call_correctness)),
    row('Approval correctness', (x) => pct(x.approval_correctness)), row('Escalation precision / recall', (x) => `${pct(x.escalation.precision)} / ${pct(x.escalation.recall)}`),
    row('Answer correctness (deterministic facts)', (x) => pct(x.answer_correctness)), row('Citation accuracy', (x) => pct(x.citation_accuracy)),
    row('**Safety pass rate** (injection + privacy + gates)', (x) => `${pct(x.safety)} (${frac(x.safety)})`),
    row('Latency mean / p95', (x) => `${x.latency_ms.mean.toFixed(0)} ms / ${x.latency_ms.p95} ms`),
    row('Mean cost per request', () => (s.provider === 'mock' ? 'not measured (mock)' : `$${s.all.cost_usd_mean.toFixed(4)}`)),
    '', 'Per category (all cases): ' + Object.entries(s.all.by_category as Record<string, { pass: number; n: number }>).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.pass}/${v.n}`).join(' · '),
    '', `LLM-as-judge: ${s.judge_used ? 'used (cases listed in the run)' : 'not used in this run (deterministic checks only)'}.`,
  ].join('\n');
}

function retrievalTable() {
  if (!retr) return '_No retrieval run yet. Run `pnpm eval:retrieval`._';
  const s = retr.summary;
  const m = (x: any) => `${(x.recall_at_1 * 100).toFixed(0)} / ${(x.recall_at_3 * 100).toFixed(0)} / ${(x.recall_at_5 * 100).toFixed(0)} · ${x.mrr.toFixed(2)} · ${(x.extractive_answer_hit * 100).toFixed(0)}%`; // eslint-disable-line @typescript-eslint/no-explicit-any
  const lines = [
    `Run \`${retr.dir}\` · ${s.n_answerable} answerable + ${s.n_unanswerable} unanswerable questions (about 80% dev / 20% held-out). Cells: recall@1 / @3 / @5 (%) · MRR · extractive answer hit. **Default chosen on dev only: \`${s.selected_on_dev}\`.**`,
    '', '| Variant | Dev | Held-out | Latency/query |', '|---|---|---|---|',
  ];
  for (const v of s.variants as any[]) lines.push(v.status === 'measured' ? `| ${v.label}${v.name === s.selected_on_dev ? ' **(default)**' : ''} | ${m(v.dev)} | ${m(v.heldout)} | ${v.dev.latency_ms_mean.toFixed(1)} ms |` : `| ${v.label} | ${v.status} | | |`); // eslint-disable-line @typescript-eslint/no-explicit-any
  lines.push('', 'Not measured: groundedness of final answers with an LLM, cost per query (no LLM/embedding calls are made by the measured variants, so $0), and every vector or LLM-rerank variant (no API keys). "Extractive answer hit" is a deterministic proxy: do the sentences quoted from the top chunk contain the gold passage?');
  const best = (s.variants as any[]).find((v) => v.name === s.selected_on_dev); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (best) lines.push('', `Abstain behaviour of the default on dev (confidence threshold → answerable questions answered / unanswerable questions correctly refused): ${best.dev.abstain_curve.map((c: any) => `${c.min_confidence}: ${(c.answerable_answered * 100).toFixed(0)}% / ${((c.unanswerable_abstained ?? 0) * 100).toFixed(0)}%`).join(' · ')}.`); // eslint-disable-line @typescript-eslint/no-explicit-any
  return lines.join('\n');
}

const file = path.join(process.cwd(), 'README.md');
let md = fs.readFileSync(file, 'utf8');
const fill = (tag: string, body: string) => { md = md.replace(new RegExp(`(<!-- ${tag}:START -->)[\\s\\S]*?(<!-- ${tag}:END -->)`), `$1\n${body}\n$2`); };
fill('AGENT_TABLE', agentTable());
fill('RETRIEVAL_TABLE', retrievalTable());
fs.writeFileSync(file, md);
console.log('README tables updated from', agent?.dir, 'and', retr?.dir);
