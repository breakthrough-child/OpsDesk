import { Badge, PageTitle, when } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { config } from '@/lib/config';
import { getDb } from '@/lib/db';
import { GoogleCalendar } from '@/lib/integrations/calendar';

export const dynamic = 'force-dynamic';

export default async function Integrations() {
  const db = await getDb();
  const session = await getSession();
  const rows = await db.query<{ name: string; mode: string; last_success_at: string | null; last_error_at: string | null; last_error: string | null }>('select * from integration_status');
  const by = new Map(rows.map((r) => [r.name, r]));
  const [q] = await db.query<{ queued: number; dead: number }>("select (select count(*)::int from queue_jobs where status = 'queued') as queued, (select count(*)::int from dead_letters) as dead");
  const [tok] = await db.query('select 1 from oauth_tokens where provider = \'google\'');
  const items = [
    { name: 'google_calendar', title: 'Google Calendar (OAuth 2.0)', mode: GoogleCalendar.configured() && tok ? 'live' : 'mock', note: GoogleCalendar.configured() ? (tok ? 'Authorised.' : 'Credentials set, not yet authorised.') : 'GOOGLE_CLIENT_ID/SECRET not set: using the mock calendar.' },
    { name: 'inbound_webhook', title: 'Inbound webhook (signed)', mode: by.get('inbound_webhook') ? 'live' : 'mock', note: 'POST /api/webhooks/inbound. HMAC + replay window + idempotency.' },
    { name: 'slack', title: 'Slack notifications', mode: config.slackWebhook ? 'live' : 'mock', note: config.slackWebhook ? 'Notifies on escalations and waiting approvals.' : 'SLACK_WEBHOOK_URL not set.' },
    { name: 'outbound_channel', title: 'Outbound channel', mode: 'mock', note: 'Simulated outbox only. Replace via the ChannelAdapter interface.' },
    { name: 'llm', title: 'LLM provider', mode: config.provider === 'anthropic' ? 'live' : 'mock', note: config.provider === 'anthropic' ? `agent ${config.agentModel}, classifier ${config.classifierModel}` : 'Deterministic mock provider (no API key).' },
    { name: 'database', title: 'Database', mode: config.databaseUrl ? 'live' : 'mock', note: config.databaseUrl ? 'Postgres (Supabase).' : 'Embedded Postgres (PGlite).' },
  ];
  return (
    <div className="space-y-4">
      <PageTitle title="Integrations" sub="Which integrations are live or in mock mode, and their last success and error" right={session && GoogleCalendar.configured() ? <a href="/api/oauth/google/start" className="btn btn-ghost">Authorise Google Calendar</a> : undefined} />
      <div className="grid gap-3 md:grid-cols-2">{items.map((i) => { const s = by.get(i.name); return (
        <div key={i.name} className="card space-y-1 p-4"><div className="flex items-center justify-between"><h2 className="font-medium">{i.title}</h2><Badge value={i.mode} /></div><p className="text-xs text-stone-500">{i.note}</p>
          <p className="text-xs">Last success: {s?.last_success_at ? when(s.last_success_at) : '—'}</p><p className="text-xs">Last error: {s?.last_error_at ? `${when(s.last_error_at)} · ${s.last_error}` : '—'}</p></div>); })}
        <div className="card space-y-1 p-4"><h2 className="font-medium">Queue</h2><p className="text-sm">Queued jobs: <b>{q?.queued ?? 0}</b> · Dead letters: <b>{q?.dead ?? 0}</b></p><p className="text-xs text-stone-500">Postgres-backed; retries with exponential backoff, then dead-letter.</p></div></div>
    </div>
  );
}
