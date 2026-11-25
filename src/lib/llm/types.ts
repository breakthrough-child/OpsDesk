export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type Purpose = 'classify' | 'agent' | 'rerank' | 'judge';

export interface LlmRequest {
  purpose: Purpose;
  model: string;
  system: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  /** Force a specific tool (used for classification so the model cannot answer in free text). */
  forceTool?: string;
  /** Structured side-channel used only by the deterministic mock provider. Never sent to a real model. */
  mockContext?: unknown;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LlmResponse {
  content: Block[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: Usage;
  latencyMs: number;
  model: string;
  costUsd: number;
}

export interface LlmProvider {
  name: 'anthropic' | 'mock';
  complete(req: LlmRequest): Promise<LlmResponse>;
}
