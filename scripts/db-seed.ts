import { migrate, openDb } from '../src/lib/db';
import { seedData } from '../src/lib/db/seed';

const db = await openDb();
await migrate(db);
await seedData(db);
console.log('seeded 20 customers, 15 products, 30 orders');
await db.close();
