// Usage: pnpm eval:compare <runA> <runB>   (directory names, or unique label suffixes like baseline / iter2)
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'evals', 'results');
const find = (q: string) => {
  const dirs = fs.readdirSync(root).filter((d) => d === q || d.endsWith(`_${q}`)).sort();
  if (!dirs.length) throw new Error(`no run matches "${q}"`);
  return dirs[dirs.length - 1]!;
};
const [a, b] = process.argv.slice(2).map(find);
if (!a || !b) { console.error('usage: pnpm eval:compare <runA> <runB>'); process.exit(2); }
const load = (d: string) => JSON.parse(fs.readFileSync(path.join(root, d, 'summary.json'), 'utf8'));
const A = load(a), B = load(b);

type R = { rate: number | null };
const pct = (x: R | number | null | undefined) => { const v = typeof x === 'number' ? x : x?.rate; return v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`; };
const delta = (x: number | null | undefined, y: number | null | undefined) => (x == null || y == null ? '' : `${y - x >= 0 ? '+' : ''}${((y - x) * 100).toFixed(1)}pp`);

console.log(`A = ${a} (${A.provider})\nB = ${b} (${B.provider})\n`);
for (const split of ['dev', 'heldout'] as const) {
  console.log(split.toUpperCase().padEnd(28), 'A'.padStart(8), 'B'.padStart(8), 'delta'.padStart(9));
  const rows: Array<[string, number | null, number | null]> = [
    ['case pass rate', A[split].pass_rate.rate, B[split].pass_rate.rate], ['intent accuracy', A[split].intent_accuracy.rate, B[split].intent_accuracy.rate],
    ['tool-call correctness', A[split].tool_call_correctness.rate, B[split].tool_call_correctness.rate], ['approval correctness', A[split].approval_correctness.rate, B[split].approval_correctness.rate],
    ['escalation precision', A[split].escalation.precision, B[split].escalation.precision], ['escalation recall', A[split].escalation.recall, B[split].escalation.recall],
    ['answer correctness', A[split].answer_correctness.rate, B[split].answer_correctness.rate], ['citation accuracy', A[split].citation_accuracy.rate, B[split].citation_accuracy.rate], ['safety pass rate', A[split].safety.rate, B[split].safety.rate],
  ];
  for (const [n, x, y] of rows) console.log(n.padEnd(28), pct(x).padStart(8), pct(y).padStart(8), delta(x, y).padStart(9));
  console.log('latency mean (ms)'.padEnd(28), A[split].latency_ms.mean.toFixed(0).padStart(8), B[split].latency_ms.mean.toFixed(0).padStart(8), '\n');
}
