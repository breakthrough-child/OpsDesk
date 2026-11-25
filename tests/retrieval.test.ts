import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkFixed, chunkStructure } from '../src/lib/retrieval/chunk';
import { loadDocs } from '../src/lib/retrieval/ingest';
import { retrieve, rrf, contentTerms } from '../src/lib/retrieval/search';
import { makeEnv } from './helpers';

let env: Awaited<ReturnType<typeof makeEnv>>;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.close(); });

describe('chunking', () => {
  const doc = loadDocs().find((d) => d.slug === 'refund-policy')!;
  it('structure-aware chunks follow headings', () => {
    const c = chunkStructure(doc);
    expect(c.length).toBeGreaterThanOrEqual(7);
    expect(c.every((x) => x.heading?.startsWith('Refund and Returns Policy > '))).toBe(true);
    expect(c.some((x) => x.heading?.endsWith('Return window'))).toBe(true);
  });
  it('fixed chunks ignore headings and cover the text', () => {
    const c = chunkFixed(doc, 300);
    expect(c.every((x) => x.heading === null && x.content.length <= 300)).toBe(true);
  });
  it('does not split on decimal points', () => {
    const c = chunkStructure({ slug: 's', title: 'T', content: '# T\n\n## A\n' + 'It costs $7.95 today. '.repeat(80) });
    expect(c.every((x) => !/\$7\.$/.test(x.content.trim()))).toBe(true);
  });
});

describe('retrieval', () => {
  it('finds the rare-term passage (IDF-weighted rerank)', async () => {
    const r = await retrieve(env.db, 'Do you ship to Canada?', { chunker: 'structure', mode: 'hybrid', rerank: 'heuristic', topK: 3 });
    expect(r.chunks[0]!.slug).toBe('shipping-policy');
    expect(r.chunks[0]!.content).toContain('Canada');
  });
  it('bridges vocabulary: pounds -> lb', async () => {
    expect(contentTerms('How many pounds of ice?')).toContain('lb');
    const r = await retrieve(env.db, 'How many pounds of ice can the IM-40 store?', { topK: 3 });
    expect(r.chunks.some((c) => c.content.includes('12 lb'))).toBe(true);
  });
  it('has low confidence for questions the documents cannot answer', async () => {
    const no = await retrieve(env.db, 'Do you sell wedding cakes?');
    const yes = await retrieve(env.db, 'How much does express shipping cost?');
    expect(no.confidence).toBeLessThan(0.5);
    expect(yes.confidence).toBeGreaterThan(0.5);
  });
  it('low confidence when the passage lacks the asked attribute or is about another product', async () => {
    // "red" appears only in an unrelated ice-maker passage ("flashing red light"); no GR-90 passage mentions colour.
    const colour = await retrieve(env.db, 'Does the GR-90 come in red?');
    expect(colour.confidence).toBeLessThan(0.5);
    const real = await retrieve(env.db, 'What grind step should I use for espresso on the GR-90?');
    expect(real.confidence).toBeGreaterThan(0.5);
  });
  it('metadata filter restricts the searched documents', async () => {
    const r = await retrieve(env.db, 'weight', { topK: 5, filterSlugs: ['manual-gr90'] });
    expect(r.chunks.every((c) => c.slug === 'manual-gr90')).toBe(true);
  });
  it('reciprocal rank fusion rewards agreement between lists', () => {
    const row = (id: string) => ({ id, slug: id, title: id, heading: null, content: id, score: 0 });
    const fused = rrf([[row('a'), row('b'), row('c')], [row('c'), row('b'), row('d')]]);
    expect(fused.slice(0, 2).map((r) => r.id).sort()).toEqual(['b', 'c']);
    expect(fused.map((r) => r.id)).toContain('d');
  });
});
