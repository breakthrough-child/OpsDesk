import { config } from '../config';
import type { Classification, Intent } from './schemas';

export type Risk = { risk: 'safe' | 'approval' | 'deny'; reason: string };

/** Tools that always need a human regardless of arguments. */
export const ALWAYS_APPROVE = new Set(['issue_refund', 'send_reply', 'cancel_booking']);
/** Tools the agent may never call. */
export const NEVER_FOR_AGENT = new Set(['delete_ticket']);
const KNOWN = new Set(['lookup_order', 'create_ticket', 'list_available_slots', 'book_slot', 'draft_reply', 'issue_refund', 'send_reply', 'cancel_booking']);

/** Decide whether a tool call may run now, needs human approval, or is denied outright. Pure function. */
export function evaluateToolCall(tool: string, args: Record<string, unknown>, threshold = config.approvalValueThreshold): Risk {
  if (NEVER_FOR_AGENT.has(tool)) return { risk: 'deny', reason: `${tool} is destructive and not available to the agent` };
  if (!KNOWN.has(tool)) return { risk: 'deny', reason: `unknown tool ${tool}` };
  if (ALWAYS_APPROVE.has(tool)) return { risk: 'approval', reason: `${tool} always requires human approval` };
  const money = Math.max(0, ...['amount', 'total', 'value'].map((k) => (typeof args[k] === 'number' ? (args[k] as number) : 0)));
  if (money > threshold) return { risk: 'approval', reason: `monetary value ${money} exceeds approval threshold ${threshold}` };
  return { risk: 'safe', reason: 'read-only or low-risk action' };
}

export const DOC_GROUNDED: Intent[] = ['product_question', 'policy_question'];

export interface EscalationInput {
  classification: Classification;
  retrievalConfidence: number;
  hasToolFacts: boolean;
}

/** Deterministic escalation rules. The model can add more, but these cannot be talked out of. */
export function escalationReasons(i: EscalationInput): string[] {
  const r: string[] = [];
  const c = i.classification;
  if (c.legal_or_safety) r.push('legal_or_safety');
  if (c.angry) r.push('angry_customer');
  if (c.intent === 'out_of_scope') r.push('out_of_scope');
  if (c.intent === 'complaint') r.push('complaint');
  if (c.needs_human) r.push('classifier_requested_human');
  if (DOC_GROUNDED.includes(c.intent) && i.retrievalConfidence < MIN_CONFIDENCE() && !i.hasToolFacts) r.push('low_retrieval_confidence');
  return r;
}

export const MIN_CONFIDENCE = () => Number(process.env.MIN_RETRIEVAL_CONFIDENCE ?? 0.5);
