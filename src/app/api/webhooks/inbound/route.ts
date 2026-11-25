import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/demo';
import { acceptInbound } from '@/lib/inbound';
import { drainQueue } from '@/lib/queue/worker';
import { recordIntegration } from '@/lib/integrations/status';
import { verifySignature } from '@/lib/webhook/verify';
import { rateLimit } from '@/lib/webhook/ratelimit';

export const dynamic = 'force-dynamic';

const Payload = z.object({ id: z.string().min(1).max(200), email: z.string().email(), subject: z.string().max(200).optional(), body: z.string().min(1).max(5000), channel: z.string().max(40).optional() });

/**
 * Signed inbound webhook. Header: X-OpsDesk-Signature: t=<unix>,v1=<hmac_sha256("<t>.<raw body>")>
 * Idempotency: payload.id (or the Idempotency-Key header). Rate limited per source IP.
 */
export async function POST(req: Request) {
  const db = await getDb();
  const rl = await rateLimit(db, `webhook:${clientIp(req)}`, 60, 60);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '60' } });
  const raw = await req.text(); // verify against the exact bytes received
  const v = verifySignature(config.webhookSecret, raw, req.headers.get('x-opsdesk-signature'));
  if (!v.ok) { await recordIntegration(db, 'inbound_webhook', 'live', false, v.reason); return NextResponse.json({ error: v.reason }, { status: 401 }); }
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const p = Payload.safeParse(json);
  if (!p.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  const key = req.headers.get('idempotency-key') ?? p.data.id;
  const r = await acceptInbound(db, `wh-${key}`, p.data);
  await recordIntegration(db, 'inbound_webhook', 'live', true);
  // Respond fast (202); process the queued job after the response is sent. Cron /api/worker/tick is the fallback.
  if (!r.duplicate) after(async () => { await drainQueue(db, { max: 2 }); });
  return NextResponse.json({ messageId: r.messageId, duplicate: r.duplicate }, { status: r.duplicate ? 200 : 202 });
}
