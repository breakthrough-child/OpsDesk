import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await getDb();
  const [r] = await db.query<{ n: number }>('select count(*)::int as n from documents');
  return NextResponse.json({ ok: true, provider: config.provider, documents: r?.n ?? 0, demo: config.demoMode });
}
