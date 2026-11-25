import { config } from '../src/lib/config';

export type FaultMode = 'timeout' | 'error5xx' | 'invalid_args' | 'partial' | 'slow' | 'duplicate';

export interface FaultRule {
  tool: string; // tool name or '*'
  mode: FaultMode;
  /** How many calls the fault applies to. Omit for "until cleared". */
  times?: number;
  delayMs?: number;
}

/** Test-mode only fault injection. Disabled unless FAULT_INJECTION=1 or NODE_ENV=test. */
class FaultInjector {
  private rules: FaultRule[] = [];

  set(rule: FaultRule) { if (config.faultInjection) this.rules.push({ ...rule }); }
  clear() { this.rules = []; }

  /** Returns the fault to apply for this call, consuming one use. */
  next(tool: string, inline?: Partial<FaultRule>): FaultRule | null {
    if (!config.faultInjection) return null;
    if (inline?.mode) return { tool, mode: inline.mode, delayMs: inline.delayMs };
    const i = this.rules.findIndex((r) => (r.tool === tool || r.tool === '*') && (r.times === undefined || r.times > 0));
    if (i < 0) return null;
    const r = this.rules[i]!;
    if (r.times !== undefined) r.times--;
    return r;
  }
}

export const faults = new FaultInjector();
