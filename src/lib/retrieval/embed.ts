import { config } from '../config';

export const embeddingsEnabled = () => Boolean(config.embeddingsKey);

/** OpenAI-compatible embeddings endpoint (set EMBEDDINGS_API_URL / EMBEDDINGS_MODEL for another provider). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!embeddingsEnabled()) throw new Error('EMBEDDINGS_API_KEY not set');
  const url = process.env.EMBEDDINGS_API_URL ?? 'https://api.openai.com/v1/embeddings';
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.embeddingsKey}` },
      body: JSON.stringify({ model: process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small', input: texts.slice(i, i + 64) }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    out.push(...json.data.map((d) => d.embedding));
  }
  return out;
}

export const cosine = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
