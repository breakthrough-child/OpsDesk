import { config } from '../config';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import type { LlmProvider } from './types';

export function getProvider(): LlmProvider {
  return config.provider === 'anthropic' ? new AnthropicProvider() : new MockProvider();
}
export * from './types';
