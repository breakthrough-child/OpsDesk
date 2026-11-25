import { customers, orders, products } from '../../../data/seed';
import type { Db } from './index';

export async function seedData(db: Db) {
  for (const c of customers) await db.query('insert into customers(id,name,email) values ($1,$2,$3) on conflict do nothing', [c.id, c.name, c.email]);
  for (const p of products) await db.query('insert into products(sku,name,price,category,freight) values ($1,$2,$3,$4,$5) on conflict do nothing', [p.sku, p.name, p.price, p.category, p.freight]);
  for (const o of orders) {
    await db.query(
      `insert into orders(id,customer_id,status,placed_at,shipped_at,delivered_at,items,total,shipping_method,carrier,tracking_number)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
      [o.id, o.customer_id, o.status, o.placed_at, o.shipped_at, o.delivered_at, JSON.stringify(o.items), o.total, o.shipping_method, o.carrier, o.tracking_number],
    );
  }
}

export async function seedIfEmpty(db: Db) {
  const n = (await db.query<{ n: number }>('select count(*)::int as n from customers'))[0]!.n;
  if (n === 0) {
    await seedData(db);
    const { ingestDocuments } = await import('../retrieval/ingest');
    await ingestDocuments(db);
  }
}
