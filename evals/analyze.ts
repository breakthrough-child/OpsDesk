// Aggregate-only comparison of two runs for a split: per-category pass counts and counts of failed check TYPES.
// Never prints case ids, messages, replies or notes, so it is safe to use on the held-out split.
// Usage: pnpm tsx evals/analyze.ts <runA> <runB> [split=heldout]
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'evals', 'results');
const find = (q: string): string => fs.readdirSync(root).filter((d) => d === q || d.endsWith(`_${q}`)).sort().pop() ?? '';
const a = find(process.argv[2] ?? ''), b = find(process.argv[3] ?? '');
const split = process.argv[4] ?? 'heldout';

type R = { id: string; split: string; category: string; pass: boolean; checks: Record<string, boolean | null>; actual: { escalated: boolean; reasons: string[] }; expectEscalate: boolean | null };
const load = (d: string) => fs.readFileSync(path.join(root, d, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as R).filter((r) => r.split === split);
const A = load(a), B = load(b);

function profile(rs: R[]) {
  const cat: Record<string, { pass: number; n: number }> = {};
  const failedChecks: Record<string, number> = {};
  const escMiss = { falsePositive: 0, falseNegative: 0 };
  for (const r of rs) {
    (cat[r.category] ??= { pass: 0, n: 0 }).n++;
    if (r.pass) cat[r.category]!.pass++;
    for (const [k, v] of Object.entries(r.checks)) if (v === false) failedChecks[k] = (failedChecks[k] ?? 0) + 1;
    if (r.checks.escalation === false) { if (r.actual.escalated) escMiss.falsePositive++; else escMiss.falseNegative++; }
  }
  return { cat, failedChecks, escMiss, n: rs.length, pass: rs.filter((r) => r.pass).length };
}
const pa = profile(A), pb = profile(B);
console.log(`${split}: A=${a} (${pa.pass}/${pa.n})  B=${b} (${pb.pass}/${pb.n})\n`);
console.log('category'.padEnd(18), 'A'.padStart(6), 'B'.padStart(6));
for (const c of [...new Set([...Object.keys(pa.cat), ...Object.keys(pb.cat)])].sort()) console.log(c.padEnd(18), `${pa.cat[c]?.pass ?? 0}/${pa.cat[c]?.n ?? 0}`.padStart(6), `${pb.cat[c]?.pass ?? 0}/${pb.cat[c]?.n ?? 0}`.padStart(6));
console.log('\nfailed check types (count of cases failing each check)');
for (const k of [...new Set([...Object.keys(pa.failedChecks), ...Object.keys(pb.failedChecks)])].sort()) console.log(k.padEnd(18), String(pa.failedChecks[k] ?? 0).padStart(6), String(pb.failedChecks[k] ?? 0).padStart(6));
console.log('\nescalation errors  A:', JSON.stringify(pa.escMiss), ' B:', JSON.stringify(pb.escMiss));
// Cases that changed outcome, counted by category only (no ids).
const byId = new Map(A.map((r) => [r.id, r]));
const changed: Record<string, { regressed: number; improved: number }> = {};
for (const r of B) { const o = byId.get(r.id); if (!o || o.pass === r.pass) continue; const c = (changed[r.category] ??= { regressed: 0, improved: 0 }); if (r.pass) c.improved++; else c.regressed++; }
console.log('\noutcome changes A -> B by category:', JSON.stringify(changed));
