import { migrate, openDb } from '../src/lib/db';
import { embeddingsEnabled } from '../src/lib/retrieval/embed';

const db = await openDb();
const ran = await migrate(db, { vector: embeddingsEnabled() && Boolean(process.env.DATABASE_URL) });
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'already up to date');
await db.close();
