import net from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../util';
import { costOf } from './pricing';
import type { Block, LlmProvider, LlmRequest, LlmResponse } from './types';

export class AnthropicProvider implements LlmProvider {
  name = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    // Node's happy-eyeballs default (250 ms per address) makes connections fail on slow or high-latency networks.
    net.setDefaultAutoSelectFamilyAttemptTimeout(5000);
    if (!apiKey) throw new AppError('ANTHROPIC_API_KEY is not set', 'NO_API_KEY');
    // At most ONE retry of a failed call (budget rule): maxRetries 1.
    // baseURL is explicit: an ambient ANTHROPIC_BASE_URL (e.g. set by a dev tool's proxy) must not silently redirect the app's own key.
    this.client = new Anthropic({ apiKey, baseURL: process.env.OPSDESK_ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com', maxRetries: 1, timeout: 60_000 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const t0 = Date.now();
    // The system prompt is stable across requests, so mark it cacheable.
    const res = (await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1500,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages as never,
      tools: req.tools as never,
      ...(req.forceTool ? { tool_choice: { type: 'tool', name: req.forceTool } } : {}),
      // Haiku 5.5: thinking off + low effort keeps cost and latency down (thinking can be disabled at effort <= high).
      thinking: { type: (process.env.LLM_THINKING ?? 'disabled') as 'disabled' | 'adaptive' },
      output_config: { effort: process.env.LLM_EFFORT ?? 'low' },
    } as never)) as Anthropic.Message;
    const content: Block[] = res.content.flatMap((b): Block[] => {
      if (b.type === 'text') return [{ type: 'text', text: b.text }];
      if (b.type === 'tool_use') return [{ type: 'tool_use', id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }];
      return [];
    });
    const u = res.usage as unknown as Record<string, number | undefined>;
    const usage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    };
    return {
      content,
      stopReason: res.stop_reason === 'tool_use' ? 'tool_use' : res.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
      usage,
      latencyMs: Date.now() - t0,
      model: req.model,
      costUsd: costOf(req.model, usage),
    };
  }
}
