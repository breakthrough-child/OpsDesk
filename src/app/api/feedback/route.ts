import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/demo';
import { newId } from '@/lib/util';
import { rateLimit } from '@/lib/webhook/ratelimit';

export const dynamic = 'force-dynamic';

const Body = z.object({ traceId: z.string().optional(), messageId: z.string().optional(), approvalId: z.string().optional(), target: z.enum(['reply', 'approval']), rating: z.enum(['up', 'down']), reason: z.enum(['wrong_answer', 'missing_info', 'bad_tone', 'unsafe', 'should_have_escalated', 'unnecessary_escalation', 'other']).optional(), note: z.string().max(1000).optional(), consent: z.literal(true) });

/** Feedback on an agent reply or an approval decision. Requires the consent tickbox; never put real personal data in the note. */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Please tick the consent box and choose a rating.' }, { status: 400 });
  const db = await getDb();
  if (!(await rateLimit(db, `feedback:${clientIp(req)}`, 60, 3600)).allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const d = p.data;
  await db.query('insert into feedback(id, trace_id, message_id, approval_id, target, rating, reason, note) values ($1,$2,$3,$4,$5,$6,$7,$8)', [newId('fb'), d.traceId ?? null, d.messageId ?? null, d.approvalId ?? null, d.target, d.rating, d.reason ?? null, d.note ?? null]);
  return NextResponse.json({ ok: true });
}
