import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { GoogleCalendar } from '@/lib/integrations/calendar';
import { newId } from '@/lib/util';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireAdmin()).ok) return NextResponse.redirect(new URL('/login', req.url));
  if (!GoogleCalendar.configured()) return NextResponse.json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set; calendar runs in mock mode.' }, { status: 400 });
  const state = newId('st');
  const res = NextResponse.redirect(GoogleCalendar.authUrl(state));
  res.cookies.set('g_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}
