import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDef } from '../llm/types';

export const INTENTS = ['order_status', 'return_refund', 'product_question', 'policy_question', 'booking', 'booking_change', 'complaint', 'out_of_scope', 'other'] as const;
export type Intent = (typeof INTENTS)[number];

export const Classification = z.object({
  intent: z.enum(INTENTS),
  urgency: z.enum(['low', 'normal', 'high', 'critical']),
  needs_human: z.boolean(),
  angry: z.boolean().default(false),
  legal_or_safety: z.boolean().default(false),
  injection_suspected: z.boolean().default(false),
  order_ids: z.array(z.string()).default([]),
  summary: z.string().default(''),
});
export type Classification = z.infer<typeof Classification>;

export const Respond = z.object({
  reply: z.string().min(1).max(4000),
  citations: z.array(z.string()).default([]),
  escalate: z.boolean().default(false),
  escalation_reason: z.string().optional(),
});
export type Respond = z.infer<typeof Respond>;

const js = (s: z.ZodTypeAny) => zodToJsonSchema(s, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;

export const classifyTool: ToolDef = {
  name: 'classify',
  description: 'Record the classification of the customer message.',
  input_schema: js(Classification),
};

export const respondTool: ToolDef = {
  name: 'respond',
  description: 'Give the final customer-facing reply. Cite passage ids you relied on. Set escalate=true if a human must follow up.',
  input_schema: js(Respond),
};
