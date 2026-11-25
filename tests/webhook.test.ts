import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptInbound } from '../src/lib/inbound';
import { signPayload, verifySignature } from '../src/lib/webhook/verify';
import { rateLimit } from '../src/lib/webhook/ratelimit';
import { makeEnv } from './helpers';

const body = JSON.stringify({ email: 'maya.lindqvist@example.com', body: 'hello' });
const now = 1_800_000_000;

describe('webhook signature', () => {
  it('accepts a valid signature', () => expect(verifySignature('s', body, signPayload('s', body, now), now).ok).toBe(true));
  it('rejects a missing, malformed, wrong or tampered signature', () => {
    expect(verifySignature('s', body, undefined, now)).toMatchObject({ ok: false, reason: 'missing_signature' });
    expect(verifySignature('s', body, 'garbage', now)).toMatchObject({ ok: false });
    expect(verifySignature('other', body, signPayload('s', body, now), now)).toMatchObject({ reason: 'bad_signature' });
    expect(verifySignature('s', body + ' ', signPayload('s', body, now), now)).toMatchObject({ reason: 'bad_signature' });
  });
  it('rejects replays outside the timestamp tolerance', () => {
    expect(verifySignature('s', body, signPayload('s', body, now - 301), now)).toMatchObject({ reason: 'timestamp_out_of_tolerance' });
    expect(verifySignature('s', body, signPayload('s', body, now + 301), now)).toMatchObject({ reason: 'timestamp_out_of_tolerance' });
    expect(verifySignature('s', body, signPayload('s', body, now - 299), now).ok).toBe(true);
  });
});

describe('inbound idempotency and rate limiting', () => {
  let env: Awaited<ReturnType<typeof makeEnv>>;
  beforeAll(async () => { env = await makeEnv(); });
  afterAll(async () => { await env.close(); });

  it('a duplicate delivery creates no second message or job', async () => {
    const p = { email: 'maya.lindqvist@example.com', body: 'where is BB-1001' };
    const a = await acceptInbound(env.db, 'evt-1', p);
    const b = await acceptInbound(env.db, 'evt-1', p);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.messageId).toBe(a.messageId);
    expect((await env.db.query<{ n: number }>('select count(*)::int as n from messages'))[0]!.n).toBe(1);
    expect((await env.db.query<{ n: number }>('select count(*)::int as n from queue_jobs'))[0]!.n).toBe(1);
  });
  it('rate limits per key within a window and resets in the next', async () => {
    const t = 10_000_000;
    const r = [];
    for (let i = 0; i < 4; i++) r.push((await rateLimit(env.db, 'ip:1', 3, 60, t)).allowed);
    expect(r).toEqual([true, true, true, false]);
    expect((await rateLimit(env.db, 'ip:2', 3, 60, t)).allowed).toBe(true);
    expect((await rateLimit(env.db, 'ip:1', 3, 60, t + 61_000)).allowed).toBe(true);
  });
});
