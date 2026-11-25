import { createHash, randomBytes } from 'node:crypto';

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Deterministic JSON (sorted keys) so hashes of arguments are stable. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

const SENSITIVE = /(token|secret|password|authorization|card|email|phone|address|api_?key)/i;
/** Redact sensitive fields before anything is written to the audit log. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(val)]),
    );
  }
  return v;
}

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable = false,
  ) {
    super(message);
  }
}
