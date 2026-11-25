import { sleep } from './util';

export interface RetryOpts {
  retries: number;
  baseMs: number;
  maxMs?: number;
  shouldRetry?: (e: unknown, attempt: number) => boolean;
  onRetry?: (e: unknown, attempt: number, delayMs: number) => void;
}

export const backoffMs = (attempt: number, baseMs: number, maxMs = 30_000) => Math.min(maxMs, baseMs * 2 ** attempt);

/** Exponential backoff with a hard cap on attempts. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      last = e;
      if (attempt === o.retries || (o.shouldRetry && !o.shouldRetry(e, attempt))) throw e;
      const delay = backoffMs(attempt, o.baseMs, o.maxMs);
      o.onRetry?.(e, attempt, delay);
      await sleep(delay);
    }
  }
  throw last;
}
