import fs from 'node:fs';
import path from 'node:path';
import { migrate, openDb } from '../../src/lib/db';
import { ingestDocuments } from '../../src/lib/retrieval/ingest';
import { embeddingsEnabled } from '../../src/lib/retrieval/embed';
import { contentTerms, containsGold, retrieve, type RetrievalOptions } from '../../src/lib/retrieval/search';
import { bestSentences } from '../../src/lib/llm/mock';
import { sha256 } from '../../src/lib/util';
import { splitOf } from '../harness';

interface Q { id: string; question: string; gold_doc: string; gold_passage: string }
const qs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'evals/retrieval/questions.json'), 'utf8')) as { answerable: Q[]; unanswerable: Array<{ id: string; question: string }> };
void sha256;

/** Hand-written router used by the "metadata filter" variant: a product mention restricts search to that product's documents. */
const PRODUCT_DOCS: Array<[RegExp, string[]]> = [
  [/es-?200|espresso machine/i, ['manual-es200', 'product-faq', 'warranty-terms', 'cleaning-and-maintenance']],
  [/gr-?90|grinder|burr/i, ['manual-gr90', 'product-faq', 'warranty-terms']],
  [/db-?12|drip/i, ['manual-db12', 'product-faq', 'warranty-terms', 'cleaning-and-maintenance']],
  [/im-?40|ice maker/i, ['manual-im40', 'product-faq', 'warranty-terms', 'cleaning-and-maintenance']],
];
const routeSlugs = (q: string) => PRODUCT_DOCS.find(([re]) => re.test(q))?.[1];

interface Variant { name: string; label: string; opts: Partial<RetrievalOptions>; filter?: boolean; needsEmbeddings?: boolean; needsLlm?: boolean }
const VARIANTS: Variant[] = [
  { name: 'v1_baseline_fixed_keyword', label: 'Baseline: fixed-size chunks + keyword (Postgres FTS)', opts: { chunker: 'fixed', mode: 'keyword', rerank: 'none' } },
  { name: 'v2_structure_keyword', label: 'Structure-aware chunks + keyword', opts: { chunker: 'structure', mode: 'keyword', rerank: 'none' } },
  { name: 'v3_structure_hybrid_kw', label: 'Hybrid: RRF(body FTS, heading FTS) [keyword legs only]', opts: { chunker: 'structure', mode: 'hybrid', rerank: 'none' } },
  { name: 'v4_structure_keyword_rerank', label: 'Structure + keyword + IDF heuristic rerank', opts: { chunker: 'structure', mode: 'keyword', rerank: 'heuristic' } },
  { name: 'v5_structure_hybrid_rerank', label: 'Hybrid (kw legs) + IDF heuristic rerank', opts: { chunker: 'structure', mode: 'hybrid', rerank: 'heuristic' } },
  { name: 'v6_structure_hybrid_rerank_filter', label: 'Hybrid (kw legs) + heuristic rerank + metadata filter', opts: { chunker: 'structure', mode: 'hybrid', rerank: 'heuristic' }, filter: true },
  { name: 'v7_baseline_vector', label: 'Baseline: fixed chunks + vector search', opts: { chunker: 'fixed', mode: 'hybrid' }, needsEmbeddings: true },
  { name: 'v8_hybrid_vector', label: 'Hybrid: keyword + vector (RRF)', opts: { chunker: 'structure', mode: 'hybrid' }, needsEmbeddings: true },
  { name: 'v9_hybrid_llm_rerank', label: 'Hybrid + LLM reranker', opts: { chunker: 'structure', mode: 'hybrid', rerank: 'llm' }, needsLlm: true },
];

const db = await openDb({ memory: true });
await migrate(db);
await (await import('../../src/lib/db/seed')).seedData(db);
await ingestDocuments(db);

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7];

async function evalVariant(v: Variant, split: 'dev' | 'heldout') {
  const A = qs.answerable.filter((q) => splitOf(q.id) === split);
  const U = qs.unanswerable.filter((q) => splitOf(q.id) === split);
  const rr: number[] = [], lat: number[] = [], r1: number[] = [], r3: number[] = [], r5: number[] = [], ans: number[] = [], conf: number[] = [];
  for (const q of A) {
    const res = await retrieve(db, q.question, { ...v.opts, topK: 5, filterSlugs: v.filter ? routeSlugs(q.question) : undefined });
    lat.push(res.latencyMs);
    const rank = res.chunks.findIndex((c) => c.slug === q.gold_doc && containsGold(c.content, q.gold_passage));
    rr.push(rank >= 0 ? 1 / (rank + 1) : 0);
    r1.push(rank === 0 ? 1 : 0); r3.push(rank >= 0 && rank < 3 ? 1 : 0); r5.push(rank >= 0 ? 1 : 0);
    const top = res.chunks[0];
    // "Extractive answer hit": the sentences the answerer would quote from the top chunk contain the gold passage.
    ans.push(top && containsGold(bestSentences(contentTerms(q.question), top, 2), q.gold_passage) ? 1 : 0);
    conf.push(res.confidence);
  }
  const uconf: number[] = [];
  for (const q of U) uconf.push((await retrieve(db, q.question, { ...v.opts, topK: 5, filterSlugs: v.filter ? routeSlugs(q.question) : undefined })).confidence);
  return {
    n_answerable: A.length, n_unanswerable: U.length,
    recall_at_1: mean(r1), recall_at_3: mean(r3), recall_at_5: mean(r5), mrr: mean(rr),
    citation_accuracy: mean(r1), // the chunk we would cite (rank 1) contains the gold passage
    extractive_answer_hit: mean(ans),
    groundedness_llm: 'not measured (needs an LLM answerer + judge)',
    latency_ms_mean: mean(lat), cost_usd_per_query: 0,
    abstain_curve: THRESHOLDS.map((t) => ({ min_confidence: t, answerable_answered: mean(conf.map((c) => (c >= t ? 1 : 0))), unanswerable_abstained: uconf.length ? mean(uconf.map((c) => (c < t ? 1 : 0))) : null })),
  };
}

const out: Record<string, unknown>[] = [];
for (const v of VARIANTS) {
  if (v.needsEmbeddings && !embeddingsEnabled()) { out.push({ name: v.name, label: v.label, status: 'not measured: EMBEDDINGS_API_KEY not set' }); continue; }
  if (v.needsLlm && process.env.LLM_PROVIDER !== 'anthropic' && !process.env.ANTHROPIC_API_KEY) { out.push({ name: v.name, label: v.label, status: 'not measured: ANTHROPIC_API_KEY not set' }); continue; }
  out.push({ name: v.name, label: v.label, status: 'measured', dev: await evalVariant(v, 'dev'), heldout: await evalVariant(v, 'heldout') });
}
// Default is chosen on the DEV split only: best MRR, ties broken by recall@3.
const measured = out.filter((o) => o.status === 'measured') as Array<{ name: string; dev: Awaited<ReturnType<typeof evalVariant>> }>;
const best = [...measured].sort((a, b) => b.dev.mrr - a.dev.mrr || b.dev.recall_at_3 - a.dev.recall_at_3)[0]!;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(process.cwd(), 'evals', 'results', `${stamp}_${process.argv[2] ?? 'retrieval'}`);
fs.mkdirSync(dir, { recursive: true });
const summary = { kind: 'retrieval', created_at: new Date().toISOString(), embeddings: embeddingsEnabled(), n_answerable: qs.answerable.length, n_unanswerable: qs.unanswerable.length, selected_on_dev: best.name, variants: out };
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));

const pc = (x: number) => `${(x * 100).toFixed(0)}%`;
for (const split of ['dev', 'heldout'] as const) {
  console.log(`\n${split.toUpperCase()}`);
  console.log('variant'.padEnd(40), 'R@1', 'R@3', 'R@5', 'MRR ', 'ans-hit', 'lat(ms)');
  for (const o of out) {
    if (o.status !== 'measured') { console.log(String(o.name).padEnd(40), String(o.status)); continue; }
    const m = (o as unknown as Record<string, Awaited<ReturnType<typeof evalVariant>>>)[split]!;
    console.log(String(o.name).padEnd(40), pc(m.recall_at_1).padStart(3), pc(m.recall_at_3).padStart(3), pc(m.recall_at_5).padStart(3), m.mrr.toFixed(2), pc(m.extractive_answer_hit).padStart(6), m.latency_ms_mean.toFixed(1));
  }
}
console.log(`\nselected on dev: ${best.name}\nabstain curve (dev, selected):`, JSON.stringify(best.dev.abstain_curve));
console.log(`results: ${path.relative(process.cwd(), dir)}`);
await db.close();
