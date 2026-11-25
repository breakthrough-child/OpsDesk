import { describe, expect, it } from 'vitest';
import { escalationReasons, evaluateToolCall } from '../src/lib/agent/policy';
import type { Classification } from '../src/lib/agent/schemas';

const cls = (o: Partial<Classification> = {}): Classification => ({ intent: 'order_status', urgency: 'normal', needs_human: false, angry: false, legal_or_safety: false, injection_suspected: false, order_ids: [], summary: '', ...o });

describe('policy: approval gate', () => {
  it('always gates refunds, outbound replies and cancellations', () => {
    for (const t of ['issue_refund', 'send_reply', 'cancel_booking']) expect(evaluateToolCall(t, {}).risk).toBe('approval');
  });
  it('allows read-only and low-risk tools', () => {
    for (const t of ['lookup_order', 'list_available_slots', 'draft_reply', 'create_ticket', 'book_slot']) expect(evaluateToolCall(t, {}).risk).toBe('safe');
  });
  it('gates any monetary action above the configurable threshold', () => {
    expect(evaluateToolCall('create_ticket', { amount: 51 }, 50).risk).toBe('approval');
    expect(evaluateToolCall('create_ticket', { amount: 50 }, 50).risk).toBe('safe');
  });
  it('denies destructive and unknown tools outright', () => {
    expect(evaluateToolCall('delete_ticket', {}).risk).toBe('deny');
    expect(evaluateToolCall('drop_database', {}).risk).toBe('deny');
  });
});

describe('policy: escalation rules', () => {
  it('escalates on anger, legal/safety, out of scope and low retrieval confidence', () => {
    expect(escalationReasons({ classification: cls({ angry: true }), retrievalConfidence: 1, hasToolFacts: false })).toContain('angry_customer');
    expect(escalationReasons({ classification: cls({ legal_or_safety: true }), retrievalConfidence: 1, hasToolFacts: false })).toContain('legal_or_safety');
    expect(escalationReasons({ classification: cls({ intent: 'out_of_scope' }), retrievalConfidence: 1, hasToolFacts: false })).toContain('out_of_scope');
    expect(escalationReasons({ classification: cls({ intent: 'product_question' }), retrievalConfidence: 0.1, hasToolFacts: false })).toContain('low_retrieval_confidence');
  });
  it('does not escalate a well-grounded question', () => {
    expect(escalationReasons({ classification: cls({ intent: 'policy_question' }), retrievalConfidence: 0.9, hasToolFacts: false })).toEqual([]);
  });
});
