import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCE_SEC = 300;

export const signPayload = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing_signature' | 'malformed_signature' | 'timestamp_out_of_tolerance' | 'bad_signature' };

/** Stripe-style signed webhook: HMAC-SHA256 over "<timestamp>.<raw body>", constant-time compare, replay window. */
export function verifySignature(secret: string, body: string, header: string | null | undefined, nowSec = Math.floor(Date.now() / 1000), tolerance = TOLERANCE_SEC): VerifyResult {
  if (!header) return { ok: false, reason: 'missing_signature' };
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return { ok: false, reason: 'malformed_signature' };
  if (Math.abs(nowSec - t) > tolerance) return { ok: false, reason: 'timestamp_out_of_tolerance' };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'));
  const got = Buffer.from(parts.v1);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}
