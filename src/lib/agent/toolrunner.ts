import { argsHash } from '../../../mcp-server/auth';
import type { McpToolClient, ToolResult } from '../../../mcp-server/client';
import { TOOLS } from '../../../mcp-server/tools';
import { backoffMs } from '../retry';
import { sleep } from '../util';
import type { CircuitBreaker } from './breaker';
import type { TraceRecorder } from './trace';

export interface ToolOutcome {
  ok: boolean;
  data?: Record<string, unknown>;
  partial?: boolean;
  error?: { code: string; message: string; retryable: boolean };
  attempts: number;
}

export interface RunnerOpts {
  mcp: McpToolClient;
  token: string;
  trace: TraceRecorder;
  breaker: CircuitBreaker;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  /** Test-only: fault to inject on the next calls. */
  fault?: unknown;
  maxRepeats?: number;
}

/**
 * Executes tool calls on behalf of the model with: argument validation, per-tool circuit breaker, bounded
 * retries with backoff for idempotent calls only, and a loop guard against repeating the same call.
 */
export class ToolRunner {
  private seen = new Map<string, number>();
  loopDetected = false;
  constructor(private o: RunnerOpts) {}

  async run(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const { trace, breaker } = this.o;
    const sig = `${name}:${argsHash(args)}`;
    const n = (this.seen.get(sig) ?? 0) + 1;
    this.seen.set(sig, n);
    if (n > (this.o.maxRepeats ?? 2)) {
      this.loopDetected = true;
      await trace.record({ kind: 'guard', name: 'loop_detected', data: { tool: name, args, repeats: n } });
      return { ok: false, error: { code: 'LOOP_DETECTED', message: `${name} called repeatedly with the same arguments`, retryable: false }, attempts: 0 };
    }

    const def = TOOLS[name as keyof typeof TOOLS];
    const v = def?.schema.safeParse(args);
    if (!def || !v || !v.success) {
      const message = !def || !v ? `unknown tool ${name}` : v.error!.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ');
      await trace.record({ kind: 'tool', name, data: { args, rejected: 'client-side schema validation', message } });
      return { ok: false, error: { code: 'INVALID_ARGUMENTS', message, retryable: false }, attempts: 0 };
    }

    if (!breaker.allow(name)) {
      await trace.record({ kind: 'guard', name: 'circuit_open', data: { tool: name } });
      return { ok: false, error: { code: 'CIRCUIT_OPEN', message: `${name} is temporarily unavailable`, retryable: false }, attempts: 0 };
    }

    // Non-idempotent calls are only retried when they carry an idempotency key.
    const retriable = def.idempotent || typeof args.idempotency_key === 'string';
    const maxRetries = retriable ? (this.o.maxRetries ?? 2) : 0;
    let last: ToolOutcome = { ok: false, attempts: 0, error: { code: 'UNKNOWN', message: 'no attempt', retryable: false } };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const t0 = Date.now();
      let res: ToolResult;
      try {
        res = await this.o.mcp.call(name, args, { token: this.o.token, traceId: trace.id, fault: this.o.fault, timeoutMs: this.o.timeoutMs ?? 5000 });
      } catch (e) {
        res = { ok: false, error: { code: 'TRANSPORT_ERROR', message: e instanceof Error ? e.message : String(e), retryable: true } };
      }
      last = { ...res, attempts: attempt + 1 };
      await trace.record({ kind: 'tool', name, latencyMs: Date.now() - t0, data: { args, attempt: attempt + 1, ok: res.ok, result: res.ok ? res.data : undefined, error: res.error, partial: res.partial } });
      if (res.ok) { breaker.success(name); return last; }
      const upstream = res.error?.retryable === true;
      if (upstream) breaker.failure(name);
      if (!upstream || attempt === maxRetries) break;
      await sleep(backoffMs(attempt, this.o.retryBaseMs ?? 150));
    }
    return last;
  }
}
