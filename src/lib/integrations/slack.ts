import { config } from '../config';
import type { Db } from '../db';
import { withRetry } from '../retry';
import { AppError, sleep } from '../util';
import { recordIntegration } from './status';

let lastSentAt = 0;
const MIN_GAP_MS = 1100; // Slack incoming webhooks: ~1 msg/sec/channel

/** Optional notification. Retries 5xx/429 (honouring Retry-After) and never throws into the caller. */
export async function notifySlack(db: Db, text: string): Promise<boolean> {
  const url = config.slackWebhook;
  if (!url) {
    await recordIntegration(db, 'slack', 'mock', true);
    return false;
  }
  try {
    await withRetry(
      async () => {
        const wait = lastSentAt + MIN_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastSentAt = Date.now();
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
        if (res.status === 429) {
          await sleep(Number(res.headers.get('retry-after') ?? 1) * 1000);
          throw new AppError('slack rate limited', 'RATE_LIMITED', true);
        }
        if (res.status >= 500) throw new AppError(`slack ${res.status}`, 'UPSTREAM', true);
        if (!res.ok) throw new AppError(`slack ${res.status}`, 'UPSTREAM_4XX');
      },
      { retries: 3, baseMs: 500, shouldRetry: (e) => e instanceof AppError && e.retryable },
    );
    await recordIntegration(db, 'slack', 'live', true);
    return true;
  } catch (e) {
    await recordIntegration(db, 'slack', 'live', false, String(e));
    return false;
  }
}
