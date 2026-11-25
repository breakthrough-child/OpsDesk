import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { GoogleCalendar } from '@/lib/integrations/calendar';
import { recordIntegration } from '@/lib/integrations/status';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireAdmin()).ok) return NextResponse.redirect(new URL('/login', req.url));
  const u = new URL(req.url);
  const cookieState = req.headers.get('cookie')?.match(/g_oauth_state=([^;]+)/)?.[1];
  const code = u.searchParams.get('code');
  if (!code || !cookieState || cookieState !== u.searchParams.get('state')) return NextResponse.json({ error: 'invalid oauth state' }, { status: 400 });
  const db = await getDb();
  try {
    await GoogleCalendar.exchangeCode(db, code);
    await recordIntegration(db, 'google_calendar', 'live', true);
  } catch (e) {
    await recordIntegration(db, 'google_calendar', 'live', false, String(e));
    return NextResponse.json({ error: 'token exchange failed' }, { status: 502 });
  }
  return NextResponse.redirect(new URL('/integrations', req.url));
}
