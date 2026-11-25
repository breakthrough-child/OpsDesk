import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { config } from './config';

const COOKIE = 'opsdesk_session';

const sign = (body: string) => createHmac('sha256', config.tokenSecret).update(`session.${body}`).digest('base64url');

export function makeSessionCookie(sub: string, ttlSec = 8 * 3600) {
  const body = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readSession(value: string | undefined): { sub: string } | null {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub: string; exp: number };
  return p.exp > Date.now() / 1000 ? { sub: p.sub } : null;
}

export async function getSession() {
  return readSession((await cookies()).get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;

/** Admin login. With Supabase configured, credentials are checked against Supabase Auth (GoTrue); otherwise ADMIN_PASSWORD. */
export async function checkLogin(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anon) {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return res.ok;
  }
  const a = Buffer.from(password), b = Buffer.from(config.adminPassword);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** In public demo mode visitors are read-only; admins (signed in) can approve and act. Outside demo mode, mutation also needs login. */
export async function requireAdmin(): Promise<{ ok: true; sub: string } | { ok: false }> {
  const s = await getSession();
  return s ? { ok: true, sub: s.sub } : { ok: false };
}
