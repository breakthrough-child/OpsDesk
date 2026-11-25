import type { Usage } from './types';

// USD per million tokens (prompts up to 100K tokens). Source: Anthropic's published model table (Haiku 5.5 $0.10/$0.50,
// Sonnet 5.5 $2/$10, Opus 5.5 $4/$20); verify against the pricing page before quoting. Haiku 5.5 charges more above
// 100K-token prompts, which this app never sends. Override with MODEL_PRICES_JSON='{"model-id":{"in":3,"out":15}}'.
const DEFAULTS: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-opus-5-5': { in: 4, out: 20 },
};

export function priceFor(model: string) {
  let table = DEFAULTS;
  try {
    if (process.env.MODEL_PRICES_JSON) table = { ...DEFAULTS, ...JSON.parse(process.env.MODEL_PRICES_JSON) };
  } catch {
    /* ignore bad override */
  }
  return table[model] ?? table['claude-opus-5-5']!; // unknown model: assume the dearest, so budget guards err on the safe side
}

export function costOf(model: string, u: Usage): number {
  const p = priceFor(model);
  // cache reads ~10% of input price, cache writes ~125%.
  return (u.input * p.in + u.cacheRead * p.in * 0.1 + u.cacheWrite * p.in * 1.25 + u.output * p.out) / 1_000_000;
}
