import { config } from './config';
import type { Db } from './db';
import { rateLimit } from './webhook/ratelimit';

/** Guards for the public "simulate a message" box: per-IP rate limit and a daily cost / request cap. */
export async function demoGuard(db: Db, ip: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const rl = await rateLimit(db, `simulate:${ip}`, config.demoRateLimitPerHour, 3600);
  if (!rl.allowed) return { ok: false, status: 429, error: 'Rate limit reached for the demo. Please try again later.' };
  const [today] = await db.query<{ cost_usd: number; requests: number }>("select cost_usd, requests from cost_ledger where day = current_date and scope = 'all'");
  const cap = Number(process.env.DEMO_DAILY_REQUEST_CAP ?? 500);
  if ((today?.cost_usd ?? 0) >= config.demoDailyCostCapUsd || (today?.requests ?? 0) >= cap) return { ok: false, status: 429, error: "Today's demo budget has been used up. Come back tomorrow, or run it locally." };
  return { ok: true };
}

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
