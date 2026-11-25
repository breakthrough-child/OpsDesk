import { migrate, openDb } from '../src/lib/db';
import { ingestDocuments } from '../src/lib/retrieval/ingest';

const db = await openDb();
await migrate(db);
const r = await ingestDocuments(db);
console.log(`ingested ${r.docs} documents into ${r.chunks} chunks (fixed + structure sets)${r.embedded ? ', with embeddings' : ', no embeddings key: keyword search only'}`);
await db.close();
