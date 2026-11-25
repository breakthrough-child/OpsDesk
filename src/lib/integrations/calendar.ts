import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import type { Db } from '../db';
import { withRetry } from '../retry';
import { AppError } from '../util';
import { recordIntegration } from './status';

export interface Slot { start: string; end: string }
export interface SlotPage { slots: Slot[]; nextCursor?: string }

export interface CalendarProvider {
  mode: 'mock' | 'live';
  listSlots(opts: { from?: string; to?: string; cursor?: string; limit?: number }): Promise<SlotPage>;
  createEvent(opts: { start: string; end: string; summary: string; key: string }): Promise<{ eventId: string }>;
  deleteEvent(eventId: string): Promise<void>;
}

const SLOT_MIN = 30;
const DAYS = 10;
// Consultation hours: Mon-Thu 10:00-16:00 Pacific (fixed -08:00 offset; the demo window is in winter).
function candidateSlots(now: Date, from?: string, to?: string): Slot[] {
  const out: Slot[] = [];
  const start = from ? new Date(from) : now;
  const end = to ? new Date(to) : new Date(now.getTime() + DAYS * 86400000);
  for (let d = 0; d < 60; d++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d));
    const dow = day.getUTCDay();
    if (dow < 1 || dow > 4) continue;
    for (let m = 10 * 60; m < 16 * 60; m += SLOT_MIN) {
      const s = new Date(day.getTime() + (m + 8 * 60) * 60000); // 10:00 PST = 18:00 UTC
      const e = new Date(s.getTime() + SLOT_MIN * 60000);
      if (s > now && s >= start && e <= end) out.push({ start: s.toISOString(), end: e.toISOString() });
    }
  }
  return out;
}

export class MockCalendar implements CalendarProvider {
  mode = 'mock' as const;
  constructor(private db: Db) {}

  async listSlots({ from, to, cursor, limit = 8 }: { from?: string; to?: string; cursor?: string; limit?: number }): Promise<SlotPage> {
    const booked = new Set((await this.db.query<{ s: Date }>("select slot_start as s from bookings where status = 'booked'")).map((r) => new Date(r.s).toISOString()));
    const all = candidateSlots(config.now, from, to).filter((s) => !booked.has(s.start));
    const offset = cursor ? Number(cursor) : 0;
    const slots = all.slice(offset, offset + limit);
    const next = offset + limit < all.length ? String(offset + limit) : undefined;
    await recordIntegration(this.db, 'google_calendar', 'mock', true);
    return { slots, nextCursor: next };
  }
  async createEvent(o: { key: string }) { return { eventId: `mock_evt_${o.key.slice(0, 8)}` }; }
  async deleteEvent() { /* nothing external to delete */ }
}

// ---- Token encryption (AES-256-GCM) for refresh tokens at rest ----
const key = () => createHash('sha256').update(config.encryptionKey).digest();
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64url')) as [Buffer, Buffer, Buffer];
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ---- Google Calendar via OAuth 2.0 authorization-code flow (REST, no SDK) ----
export class GoogleCalendar implements CalendarProvider {
  mode = 'live' as const;
  constructor(private db: Db) {}

  static configured() { const g = config.google; return Boolean(g.clientId && g.clientSecret); }

  static authUrl(state: string) {
    const g = config.google;
    const p = new URLSearchParams({ client_id: g.clientId, redirect_uri: g.redirect, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/calendar.events', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  static async exchangeCode(db: Db, code: string) {
    const g = config.google;
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: g.redirect, grant_type: 'authorization_code' }) });
    if (!res.ok) throw new AppError(`google token exchange failed: ${res.status}`, 'OAUTH_FAILED');
    const t = (await res.json()) as { refresh_token?: string };
    if (!t.refresh_token) throw new AppError('no refresh token returned (re-consent required)', 'OAUTH_NO_REFRESH');
    await db.query(`insert into oauth_tokens(provider, encrypted) values ('google', $1) on conflict (provider) do update set encrypted = excluded.encrypted, updated_at = now()`, [encrypt(t.refresh_token)]);
  }

  private async accessToken(): Promise<string> {
    const [row] = await this.db.query<{ encrypted: string }>("select encrypted from oauth_tokens where provider = 'google'");
    if (!row) throw new AppError('Google Calendar not authorised yet', 'OAUTH_MISSING');
    const g = config.google;
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: decrypt(row.encrypted), grant_type: 'refresh_token' }) });
    if (!res.ok) throw new AppError(`google token refresh failed: ${res.status}`, 'OAUTH_REFRESH_FAILED');
    return ((await res.json()) as { access_token: string }).access_token;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    try {
      const out = await withRetry(
        async () => {
          const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.google.calendarId)}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' } });
          if (res.status === 429 || res.status >= 500) throw new AppError(`google ${res.status}`, 'UPSTREAM', true);
          if (!res.ok) throw new AppError(`google ${res.status}: ${await res.text()}`, 'UPSTREAM_4XX');
          return res.status === 204 ? ({} as T) : ((await res.json()) as T);
        },
        { retries: 3, baseMs: 400, shouldRetry: (e) => e instanceof AppError && e.retryable },
      );
      await recordIntegration(this.db, 'google_calendar', 'live', true);
      return out;
    } catch (e) {
      await recordIntegration(this.db, 'google_calendar', 'live', false, String(e));
      throw e;
    }
  }

  async listSlots({ from, to, cursor, limit = 8 }: { from?: string; to?: string; cursor?: string; limit?: number }): Promise<SlotPage> {
    const cands = candidateSlots(config.now, from, to);
    const min = cands[0]?.start ?? new Date().toISOString();
    const max = cands[cands.length - 1]?.end ?? min;
    // Paginate through every event page; stop only when Google stops returning a nextPageToken.
    const busy: Slot[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ timeMin: min, timeMax: max, singleEvents: 'true', maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const page = await this.api<{ items?: Array<{ start?: { dateTime?: string }; end?: { dateTime?: string } }>; nextPageToken?: string }>(`/events?${q}`);
      for (const it of page.items ?? []) if (it.start?.dateTime && it.end?.dateTime) busy.push({ start: new Date(it.start.dateTime).toISOString(), end: new Date(it.end.dateTime).toISOString() });
      pageToken = page.nextPageToken;
    } while (pageToken);
    const free = cands.filter((c) => !busy.some((b) => b.start < c.end && b.end > c.start));
    const offset = cursor ? Number(cursor) : 0;
    return { slots: free.slice(offset, offset + limit), nextCursor: offset + limit < free.length ? String(offset + limit) : undefined };
  }

  async createEvent(o: { start: string; end: string; summary: string; key: string }) {
    // Deterministic event id from the idempotency key makes a retried insert a conflict instead of a duplicate.
    const id = createHash('sha1').update(o.key).digest('hex').slice(0, 32);
    const ev = await this.api<{ id: string }>('/events', { method: 'POST', body: JSON.stringify({ id, summary: o.summary, start: { dateTime: o.start }, end: { dateTime: o.end } }) }).catch((e) => {
      if (String(e).includes('409')) return { id };
      throw e;
    });
    return { eventId: ev.id };
  }
  async deleteEvent(eventId: string) { await this.api(`/events/${eventId}`, { method: 'DELETE' }); }
}

export async function getCalendar(db: Db): Promise<CalendarProvider> {
  if (GoogleCalendar.configured()) {
    const [t] = await db.query("select 1 from oauth_tokens where provider = 'google'");
    if (t) return new GoogleCalendar(db);
  }
  return new MockCalendar(db);
}
