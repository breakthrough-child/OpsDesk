import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/lib/integrations/calendar';
import { MockCalendar } from '../src/lib/integrations/calendar';
import { redact } from '../src/lib/util';
import { makeEnv } from './helpers';

describe('misc', () => {
  it('encrypts refresh tokens at rest and detects tampering', () => {
    const c = encrypt('refresh-token-123');
    expect(c).not.toContain('refresh-token-123');
    expect(decrypt(c)).toBe('refresh-token-123');
    const parts = c.split('.');
    parts[2] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('redacts sensitive keys recursively', () => {
    expect(redact({ a: 1, token: 'x', nested: { email: 'a@b.c', ok: true } })).toEqual({ a: 1, token: '[redacted]', nested: { email: '[redacted]', ok: true } });
  });
  it('mock calendar paginates and never offers weekend slots', async () => {
    const env = await makeEnv();
    const cal = new MockCalendar(env.db);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await cal.listSlots({ cursor, limit: 10 });
      seen.push(...p.slots.map((s) => s.start));
      cursor = p.nextCursor;
    } while (cursor);
    expect(seen.length).toBeGreaterThan(20);
    expect(new Set(seen).size).toBe(seen.length);
    for (const s of seen) expect([1, 2, 3, 4]).toContain(new Date(new Date(s).getTime() - 8 * 3600000).getUTCDay());
    await env.close();
  });
});
