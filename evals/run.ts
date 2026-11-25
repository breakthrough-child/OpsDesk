import fs from 'node:fs';
import { loadEnvLocal } from '../src/lib/loadEnv';
loadEnvLocal(); // before any module reads config
import path from 'node:path';
import { McpToolClient } from '../mcp-server/client';
import { config } from '../src/lib/config';
import { getProvider } from '../src/lib/llm';
import { BudgetExceeded, BudgetedProvider } from '../src/lib/llm/budget';
import { MockProvider } from '../src/lib/llm/mock';
import type { LlmProvider } from '../src/lib/llm/types';
import { BUSINESS_NOW } from '../data/seed';
import { freshDb, isMockOnly, loadCases, runCase, splitOf, summarize, type CaseResult, type EvalCase } from './harness';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);

if (arg('provider') === 'mock') process.env.LLM_PROVIDER = 'mock';
const REAL_MODEL = 'claude-haiku-5-5';
let provider: LlmProvider = arg('provider') === 'mock' ? new MockProvider() : getProvider();
let budgeted: BudgetedProvider | undefined;
if (flag('require-real') && provider.name !== 'anthropic') { console.error('--require-real: ANTHROPIC_API_KEY is not set (checked .env.local and the environment); refusing to run on the mock.'); process.exit(2); }
if (provider.name === 'anthropic') {
  // Cost rules for real runs: Haiku 5.5 only, a hard budget (default $0.70), one trial, at most one retry per failed call.
  for (const k of ['AGENT_MODEL', 'CLASSIFIER_MODEL', 'JUDGE_MODEL']) {
    if (process.env[k] && process.env[k] !== REAL_MODEL) { console.error(`${k}=${process.env[k]} refused: real eval runs are limited to ${REAL_MODEL}`); process.exit(2); }
    process.env[k] = REAL_MODEL;
  }
  const budget = Number(process.env.EVAL_BUDGET_USD ?? '0.70');
  if (!(budget > 0)) { console.error('EVAL_BUDGET_USD must be a positive number'); process.exit(2); }
  budgeted = new BudgetedProvider(provider, budget);
  provider = budgeted;
}

let cases = loadCases();
if (arg('category')) cases = cases.filter((c) => c.category === arg('category'));
if (arg('ids')) cases = cases.filter((c) => arg('ids')!.split(',').includes(c.id));
if (arg('split')) cases = cases.filter((c) => splitOf(c.id) === arg('split'));
if (arg('subset')) cases = cases.filter((_, i) => i % Number(arg('subset')) === 0);
// Cases built around the rule-based mock (forced loop / forced forbidden tool) cannot be exercised by a real model.
const skippedMockOnly = provider.name === 'mock' ? [] : cases.filter(isMockOnly).map((c) => c.id);
if (provider.name !== 'mock') cases = cases.filter((c) => !isMockOnly(c));
if (arg('max-cases')) cases = cases.slice(0, Number(arg('max-cases')));

// Optional LLM-as-judge with a fixed rubric on a bounded, evenly spaced sample of cases that have required facts
// (real provider only). Deterministic checks always run first and decide the pass/fail of a case.
const judgeMax = Number(arg('judge-max') ?? 20);
const judgeable = cases.filter((c) => c.expect.facts.length > 0);
const stride = Math.max(1, Math.ceil(judgeable.length / Math.max(1, judgeMax)));
const judgeIds = new Set(flag('judge') && provider.name !== 'mock' ? judgeable.filter((_, i) => i % stride === 0).slice(0, judgeMax).map((c) => c.id) : []);

async function judge(c: EvalCase, reply: string) {
  const res = await provider.complete({
    purpose: 'judge', model: config.judgeModel,
    system: 'You grade a customer-support reply against a fixed rubric. Answer ONLY with JSON {"pass":boolean,"reason":string}. Rubric: (1) the reply is consistent with the required facts; (2) it states nothing that the facts contradict; (3) it does not invent policy or product details.',
    messages: [{ role: 'user', content: `Customer message: ${c.message}\nRequired facts: ${JSON.stringify(c.expect.facts)}\nReply: ${reply}` }], maxTokens: 200,
  });
  try { const j = JSON.parse(res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').match(/\{[\s\S]*\}/)![0]); return { pass: Boolean(j.pass), reason: String(j.reason ?? '') }; } catch { return { pass: false, reason: 'judge output unparseable' }; }
}

const label = arg('label') ?? 'run';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(process.cwd(), 'evals', 'results', `${stamp}_${label}`);
fs.mkdirSync(dir, { recursive: true });

const db = await freshDb();
const mcp = await McpToolClient.connectInMemory(db);
const results: CaseResult[] = [];
const perCase: number[] = [];
let stoppedByBudget: string | undefined;
for (const c of cases) {
  const before = budgeted?.spent ?? 0;
  try {
    const r = await runCase(db, mcp, provider, c, { judge: judgeIds.has(c.id) ? judge : undefined });
    results.push(r);
    perCase.push((budgeted?.spent ?? 0) - before);
    process.stdout.write(r.pass ? '.' : 'F');
    if (budgeted && flag('print-cost')) console.log(` ${c.id}: $${perCase[perCase.length - 1]!.toFixed(5)} (total $${budgeted.spent.toFixed(5)}, ${budgeted.calls} calls)`);
  } catch (e) {
    if (e instanceof BudgetExceeded) { stoppedByBudget = e.message; console.error(`\nSTOPPED: ${e.message}`); break; }
    throw e;
  }
}
console.log();
await mcp.close();
await db.close();

const dev = results.filter((r) => r.split === 'dev');
const held = results.filter((r) => r.split === 'heldout');
const judged = results.filter((r) => r.judge?.used);
const summary = {
  run_id: `${stamp}_${label}`,
  created_at: new Date().toISOString(),
  label,
  provider: provider.name,
  cases_run: results.length,
  cases_planned: cases.length,
  trials: 1,
  skipped_mock_only: skippedMockOnly,
  stopped_by_budget: stoppedByBudget ?? null,
  cost: budgeted ? { budget_usd: budgeted.budgetUsd, spent_usd: budgeted.spent, api_calls: budgeted.calls, input_tokens: budgeted.inputTokens, output_tokens: budgeted.outputTokens, per_case_usd_mean: perCase.length ? perCase.reduce((a, b) => a + b, 0) / perCase.length : 0, per_case_includes_judge: judgeIds.size > 0 } : null,
  judge: { sampled: judged.length, passed: judged.filter((r) => r.judge!.pass).length, rate: judged.length ? judged.filter((r) => r.judge!.pass).length / judged.length : null, case_ids: judged.map((r) => r.id) },
  provider_note: provider.name === 'mock' ? 'Deterministic rule-based mock. These numbers measure the rule engine plus the surrounding system (policy, gates, MCP, retrieval), NOT Claude.' : `agent=${config.agentModel} classifier=${config.classifierModel} judge=${config.judgeModel}; thinking=${process.env.LLM_THINKING ?? 'disabled'}, effort=${process.env.LLM_EFFORT ?? 'low'}; 1 trial`,
  business_now: BUSINESS_NOW,
  retrieval_config: config.retrieval,
  all: summarize(results),
  dev: summarize(dev),
  heldout: summarize(held),
  // Dev failures are listed for iteration. Held-out failures are deliberately NOT listed here.
  dev_failures: dev.filter((r) => !r.pass).map((r) => ({ id: r.id, category: r.category, traceId: r.traceId, notes: r.notes })),
  heldout_failure_ids_hidden: true,
  judge_used: judged.length > 0,
};
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(dir, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n'));

const f = (x: { rate: number | null; pass: number; n: number }) => (x.rate === null ? 'n/a' : `${(x.rate * 100).toFixed(1)}% (${x.pass}/${x.n})`);
const row = (name: string, s: ReturnType<typeof summarize>) => console.log(`\n${name} (n=${s.n})\n  pass ${f(s.pass_rate)} | intent ${f(s.intent_accuracy)} | tools ${f(s.tool_call_correctness)} | approval ${f(s.approval_correctness)}\n  escalation P=${s.escalation.precision?.toFixed(2)} R=${s.escalation.recall?.toFixed(2)} | answer ${f(s.answer_correctness)} | citation ${f(s.citation_accuracy)}\n  safety ${f(s.safety)} ${s.safety.failures.length && name === 'DEV' ? `FAIL: ${s.safety.failures.join(',')}` : ''}\n  latency mean ${s.latency_ms.mean.toFixed(0)}ms p95 ${s.latency_ms.p95}ms | cost/request $${s.cost_usd_mean.toFixed(5)}`);
row('DEV', summary.dev);
row('HELD-OUT', summary.heldout);
console.log(`\nresults: ${path.relative(process.cwd(), dir)}`);
if (budgeted) console.log(`SPENT $${budgeted.spent.toFixed(5)} of $${budgeted.budgetUsd.toFixed(2)} budget · ${results.length}/${cases.length} cases · ${budgeted.calls} API calls · ${budgeted.inputTokens} in / ${budgeted.outputTokens} out tokens${judged.length ? ` · judge ${summary.judge.passed}/${summary.judge.sampled}` : ''}`);
if (!flag('quiet-failures')) for (const x of summary.dev_failures.slice(0, Number(arg('show') ?? 60))) console.log(` - ${x.id}: ${x.notes.join(' ; ')}`);

// Gate: safety must be 100% and metrics must clear thresholds (skipped for partial runs such as smoke tests).
if (!flag('no-gate') && !arg('ids') && !arg('max-cases')) {
  const th = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'evals', 'thresholds.json'), 'utf8')) as Record<string, number>;
  const all = summary.all;
  const problems: string[] = [];
  if (all.safety.failures.length) problems.push(`safety failures: ${all.safety.failures.length}`);
  const chk = (k: string, v: number | null) => { if (v !== null && th[k] !== undefined && v < th[k]!) problems.push(`${k} ${(v * 100).toFixed(1)}% < ${(th[k]! * 100).toFixed(0)}%`); };
  chk('intent_accuracy', all.intent_accuracy.rate); chk('tool_call_correctness', all.tool_call_correctness.rate); chk('approval_correctness', all.approval_correctness.rate);
  chk('escalation_recall', all.escalation.recall); chk('escalation_precision', all.escalation.precision);
  if (problems.length) { console.error(`\nGATE FAILED: ${problems.join('; ')}`); process.exit(1); }
}
