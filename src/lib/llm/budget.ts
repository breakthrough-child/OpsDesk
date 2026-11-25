import { costOf, priceFor } from './pricing';
import type { LlmProvider, LlmRequest, LlmResponse } from './types';

export class BudgetExceeded extends Error {
  constructor(public spent: number, public budget: number, public wouldCost: number) {
    super(`EVAL_BUDGET_USD ${budget.toFixed(2)} would be exceeded (spent $${spent.toFixed(4)}, next call up to $${wouldCost.toFixed(4)})`);
  }
}

/**
 * Hard spend limit around any provider. Before each call it assumes the worst case (pessimistic input estimate plus
 * the full max_tokens as output) and refuses to make the call if that could pass the budget. Spend is the sum of the
 * actual per-call costs computed from the API's usage numbers.
 */
export class BudgetedProvider implements LlmProvider {
  spent = 0;
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  constructor(private inner: LlmProvider, public budgetUsd: number) {}
  get name() { return this.inner.name; }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const p = priceFor(req.model);
    const estIn = Math.ceil((req.system.length + JSON.stringify(req.messages).length + JSON.stringify(req.tools ?? []).length) / 3);
    const worst = (estIn * p.in + (req.maxTokens ?? 1500) * p.out) / 1_000_000;
    if (this.spent + worst > this.budgetUsd) throw new BudgetExceeded(this.spent, this.budgetUsd, worst);
    const res = await this.inner.complete(req);
    this.calls++;
    this.inputTokens += res.usage.input + res.usage.cacheRead + res.usage.cacheWrite;
    this.outputTokens += res.usage.output;
    this.spent += res.costUsd || costOf(req.model, res.usage);
    return res;
  }
}
