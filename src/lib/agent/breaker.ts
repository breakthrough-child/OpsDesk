/** Per-tool circuit breaker: opens after N consecutive failures, half-opens after a cooldown. */
export class CircuitBreaker {
  private state = new Map<string, { failures: number; openedAt: number | null }>();
  constructor(private threshold = 3, private cooldownMs = 30_000, private now = () => Date.now()) {}

  allow(tool: string): boolean {
    const s = this.state.get(tool);
    if (!s || s.openedAt === null) return true;
    if (this.now() - s.openedAt >= this.cooldownMs) return true; // half-open: let one probe through
    return false;
  }
  success(tool: string) { this.state.set(tool, { failures: 0, openedAt: null }); }
  failure(tool: string) {
    const s = this.state.get(tool) ?? { failures: 0, openedAt: null };
    s.failures++;
    if (s.failures >= this.threshold) s.openedAt = this.now();
    this.state.set(tool, s);
  }
  isOpen(tool: string) { return !this.allow(tool); }
}

/** Process-wide breaker so failures accumulate across requests. */
export const globalBreaker = new CircuitBreaker();
