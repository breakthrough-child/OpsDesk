import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { drainQueue } from '@/lib/queue/worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Process queued jobs. Call from Vercel Cron (Authorization: Bearer $CRON_SECRET) or as a signed-in admin. */
export async function POST(req: Request) { return tick(req); }
export async function GET(req: Request) { return tick(req); }

async function tick(req: Request) {
  const secret = process.env.CRON_SECRET;
  const cronOk = Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
  if (!cronOk && !(await requireAdmin()).ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const stats = await drainQueue(await getDb(), { max: 10 });
  return NextResponse.json(stats);
}
