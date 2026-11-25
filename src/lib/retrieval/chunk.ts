export interface Chunk {
  ord: number;
  heading: string | null;
  content: string;
}

export interface DocInput {
  slug: string;
  title: string;
  content: string;
}

/** Baseline: fixed-size windows that ignore document structure. */
export function chunkFixed(doc: DocInput, size = 500): Chunk[] {
  const text = doc.content.replace(/^#.*\n+/, '').trim();
  const out: Chunk[] = [];
  for (let i = 0, ord = 0; i < text.length; i += size, ord++) out.push({ ord, heading: null, content: text.slice(i, i + size) });
  return out;
}

const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z$"'(])|\n+/).map((x) => x.trim()).filter(Boolean);

/** Structure-aware: split on `##` sections, prefix the heading path, and window long sections with one sentence of overlap. */
export function chunkStructure(doc: DocInput, maxChars = 700): Chunk[] {
  const sections = doc.content.split(/^## /m).slice(1);
  const out: Chunk[] = [];
  for (const sec of sections) {
    const nl = sec.indexOf('\n');
    const heading = `${doc.title} > ${sec.slice(0, nl).trim()}`;
    const body = sec.slice(nl + 1).trim();
    if (body.length <= maxChars) {
      out.push({ ord: out.length, heading, content: body });
      continue;
    }
    const sents = sentences(body);
    let cur: string[] = [];
    for (const s of sents) {
      cur.push(s);
      if (cur.join(' ').length >= maxChars) {
        out.push({ ord: out.length, heading, content: cur.join(' ') });
        cur = [s]; // one sentence overlap
      }
    }
    if (cur.length > 1 || out.length === 0 || out[out.length - 1]!.heading !== heading) out.push({ ord: out.length, heading, content: cur.join(' ') });
  }
  return out;
}
