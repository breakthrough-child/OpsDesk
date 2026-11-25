import type { Db } from '../db';
import { newId, round } from '../util';

export type StepKind = 'classify' | 'retrieval' | 'model' | 'tool' | 'policy' | 'approval' | 'escalation' | 'guard' | 'respond' | 'error';

export interface StepInput {
  kind: StepKind;
  name: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  data?: unknown;
}

/** Records every step of a request with tokens, cost and latency. Steps are persisted as they happen. */
export class TraceRecorder {
  seq = 0;
  tokensIn = 0;
  tokensOut = 0;
  costUsd = 0;
  readonly startedAt = Date.now();

  private constructor(private db: Db, public id: string) {}

  static async start(db: Db, messageId?: string) {
    const id = newId('tr');
    await db.query('insert into traces(id, message_id) values ($1,$2)', [id, messageId ?? null]);
    return new TraceRecorder(db, id);
  }

  get totalTokens() { return this.tokensIn + this.tokensOut; }

  async record(s: StepInput) {
    this.tokensIn += s.tokensIn ?? 0;
    this.tokensOut += s.tokensOut ?? 0;
    this.costUsd += s.costUsd ?? 0;
    await this.db.query(
      'insert into trace_steps(id, trace_id, seq, kind, name, latency_ms, tokens_in, tokens_out, cost_usd, data) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [newId('st'), this.id, this.seq++, s.kind, s.name, Math.round(s.latencyMs ?? 0), s.tokensIn ?? 0, s.tokensOut ?? 0, round(s.costUsd ?? 0), JSON.stringify(s.data ?? {})],
    );
  }

  /** Time an async operation and record it. */
  async time<T>(kind: StepKind, name: string, fn: () => Promise<T>, describe: (r: T) => Partial<StepInput> = () => ({})): Promise<T> {
    const t0 = Date.now();
    try {
      const r = await fn();
      await this.record({ kind, name, latencyMs: Date.now() - t0, ...describe(r) });
      return r;
    } catch (e) {
      await this.record({ kind: 'error', name, latencyMs: Date.now() - t0, data: { error: String(e) } });
      throw e;
    }
  }

  async finish(status: string, summary: Record<string, unknown> = {}) {
    const latency = Date.now() - this.startedAt;
    await this.db.query('update traces set ended_at = now(), status = $2, tokens_in = $3, tokens_out = $4, cost_usd = $5, latency_ms = $6, summary = $7 where id = $1', [this.id, status, this.tokensIn, this.tokensOut, round(this.costUsd), latency, JSON.stringify(summary)]);
    return { latencyMs: latency, costUsd: this.costUsd, tokensIn: this.tokensIn, tokensOut: this.tokensOut };
  }
}
