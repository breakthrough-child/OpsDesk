import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db';
import { chunkFixed, chunkStructure, type DocInput } from './chunk';
import { embedTexts, embeddingsEnabled } from './embed';

export function loadDocs(dir = path.join(process.cwd(), 'data', 'docs')): DocInput[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      return { slug: f.replace(/\.md$/, ''), title: content.match(/^# (.+)$/m)?.[1] ?? f, content };
    });
}

export async function ingestDocuments(db: Db, docs = loadDocs()): Promise<{ docs: number; chunks: number; embedded: boolean }> {
  await db.query('delete from chunks');
  await db.query('delete from documents');
  let total = 0;
  const embedded = embeddingsEnabled();
  for (const d of docs) {
    await db.query('insert into documents(id,slug,title,content) values ($1,$1,$2,$3)', [d.slug, d.title, d.content]);
    for (const [set, fn] of [['fixed', chunkFixed], ['structure', chunkStructure]] as const) {
      const chunks = fn(d);
      const vecs = embedded ? await embedTexts(chunks.map((c) => `${c.heading ?? ''}\n${c.content}`)) : [];
      for (const [i, c] of chunks.entries()) {
        await db.query('insert into chunks(id,doc_id,chunk_set,ord,heading,content,embedding) values ($1,$2,$3,$4,$5,$6,$7)', [
          `${d.slug}:${set}:${c.ord}`, d.slug, set, c.ord, c.heading, c.content, vecs[i] ? JSON.stringify(vecs[i]) : null,
        ]);
        total++;
      }
    }
  }
  return { docs: docs.length, chunks: total, embedded };
}
