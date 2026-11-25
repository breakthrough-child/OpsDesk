import { NextResponse } from 'next/server';
import { SESSION_COOKIE, checkLogin, makeSessionCookie } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/demo';
import { rateLimit } from '@/lib/webhook/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get('email') ?? 'admin');
  const db = await getDb();
  if (!(await rateLimit(db, `login:${clientIp(req)}`, 10, 900)).allowed) return NextResponse.redirect(new URL('/login?error=rate', req.url), 303);
  if (!(await checkLogin(email, String(form.get('password') ?? '')))) return NextResponse.redirect(new URL('/login?error=1', req.url), 303);
  const res = NextResponse.redirect(new URL('/approvals', req.url), 303);
  res.cookies.set(SESSION_COOKIE, makeSessionCookie(email), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 3600 });
  return res;
}
