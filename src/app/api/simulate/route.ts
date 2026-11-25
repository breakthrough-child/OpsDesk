import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { getDb } from '@/lib/db';
import { clientIp, demoGuard } from '@/lib/demo';
import { acceptInbound } from '@/lib/inbound';
import { drainQueue } from '@/lib/queue/worker';
import { newId } from '@/lib/util';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({ email: z.string().email(), subject: z.string().max(200).optional(), body: z.string().min(2).max(2000) });

/** The one write endpoint open to demo visitors. Rate limited per IP with a daily cost cap. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const db = await getDb();
  const guard = await demoGuard(db, clientIp(req));
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { messageId } = await acceptInbound(db, `sim-${newId('k')}`, { ...parsed.data, channel: 'simulated' });
  await drainQueue(db, { max: 3 });
  void config;
  return NextResponse.json({ messageId });
}
