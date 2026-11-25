import { mintToken } from '../../../mcp-server/auth';
import { McpToolClient } from '../../../mcp-server/client';
import { config } from '../config';
import type { Db } from '../db';
import { notifySlack } from '../integrations/slack';
import type { Block, LlmMessage, LlmProvider, ToolDef } from '../llm/types';
import { retrieve, type RetrievalResult } from '../retrieval/search';
import { newId } from '../util';
import { createPendingApproval, refreshMessageStatus } from './approvals';
import { globalBreaker, type CircuitBreaker } from './breaker';
import { escalationReasons, evaluateToolCall, DOC_GROUNDED } from './policy';
import { AGENT_SYSTEM, CLASSIFIER_SYSTEM } from './prompts';
import { Classification, Respond, classifyTool, respondTool } from './schemas';
import { ToolRunner } from './toolrunner';
import { TraceRecorder } from './trace';

export interface AgentDeps {
  db: Db;
  provider: LlmProvider;
  mcp: McpToolClient;
  breaker?: CircuitBreaker;
  /** Test/eval knobs. */
  fault?: unknown;
  toolTimeoutMs?: number;
  retryBaseMs?: number;
}

export interface AgentOutcome {
  messageId: string;
  traceId: string;
  status: string;
  classification: Classification;
  reply: string;
  citations: string[];
  escalated: boolean;
  escalationReasons: string[];
  toolCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; gated: boolean; errorCode?: string }>;
  approvals: Array<{ id: string; tool: string; args: Record<string, unknown> }>;
  retrieval: { confidence: number; topIds: string[] };
  costUsd: number;
  latencyMs: number;
  tokens: number;
  stoppedBy?: string;
}

const HOLDING_REPLY = "Thanks for getting in touch with Brightside. I've passed your message to a team member, who will follow up with you personally.";
const wrap = (tag: string, s: string) => `<${tag}>\n${s}\n</${tag}>`;

function textOf(content: Block[]) { return content.map((b) => (b.type === 'text' ? b.text : '')).join(''); }

export async function processMessage(deps: AgentDeps, messageId: string): Promise<AgentOutcome> {
  const { db, provider, mcp } = deps;
  const breaker = deps.breaker ?? globalBreaker;
  const [msg] = await db.query<{ id: string; customer_email: string; subject: string; body: string }>('select id, customer_email, subject, body from messages where id = $1', [messageId]);
  if (!msg) throw new Error(`message ${messageId} not found`);
  await db.query("update messages set status = 'processing' where id = $1", [messageId]);

  // Identity comes from the channel (sender address), never from the message text.
  const [cust] = await db.query<{ id: string; name: string }>('select id, name from customers where lower(email) = lower($1)', [msg.customer_email]);
  const customerId = cust?.id;
  const trace = await TraceRecorder.start(db, messageId);
  await db.query('update messages set trace_id = $2 where id = $1', [messageId, trace.id]);
  // The agent's token is scoped to this one customer. 'unverified' matches nobody, so unknown senders see no orders.
  const token = mintToken({ sub: 'agent:opsdesk', role: 'agent', cust: customerId ?? 'unverified', trace: trace.id, ttlSec: 300 });
  const runner = new ToolRunner({ mcp, token, trace, breaker, fault: deps.fault, timeoutMs: deps.toolTimeoutMs, retryBaseMs: deps.retryBaseMs });

  const out: AgentOutcome = {
    messageId, traceId: trace.id, status: 'handled', classification: { intent: 'other', urgency: 'normal', needs_human: true, angry: false, legal_or_safety: false, injection_suspected: false, order_ids: [], summary: '' },
    reply: '', citations: [], escalated: false, escalationReasons: [], toolCalls: [], approvals: [], retrieval: { confidence: 0, topIds: [] }, costUsd: 0, latencyMs: 0, tokens: 0,
  };
  const customerText = `Subject: ${msg.subject}\n\n${msg.body}`;
  let retrieval: RetrievalResult | undefined;
  let hasToolFacts = false;
  let respond: Respond | undefined;
  let reasons: string[] = [];

  try {
    // 1. Classify (cheap model).
    const cls = await trace.time(
      'classify', 'classify',
      async () => {
        const res = await provider.complete({ purpose: 'classify', model: config.classifierModel, system: CLASSIFIER_SYSTEM, messages: [{ role: 'user', content: wrap('customer_message', customerText) }], tools: [classifyTool], forceTool: 'classify', maxTokens: 400, mockContext: { text: customerText, customerId } });
        const use = res.content.find((b) => b.type === 'tool_use');
        const parsed = Classification.safeParse(use && use.type === 'tool_use' ? use.input : {});
        return { res, cls: parsed.success ? parsed.data : { ...out.classification, summary: 'classifier output invalid: failing safe to human' } };
      },
      (r) => ({ tokensIn: r.res.usage.input, tokensOut: r.res.usage.output, costUsd: r.res.costUsd, data: { model: r.res.model, classification: r.cls } }),
    );
    out.classification = cls.cls;
    await db.query('update messages set intent = $2, urgency = $3 where id = $1', [messageId, cls.cls.intent, cls.cls.urgency]);
    if (cls.cls.injection_suspected) await trace.record({ kind: 'guard', name: 'injection_suspected', data: { note: 'message treated as data; embedded instructions ignored' } });

    // 2. Retrieve.
    retrieval = await trace.time(
      'retrieval', 'retrieve',
      () => retrieve(db, `${msg.subject} ${msg.body}`, {}, provider),
      (r) => ({ costUsd: r.costUsd, data: { query: r.query, variant: r.variant, confidence: r.confidence, notes: r.notes, chunks: r.chunks.map((c) => ({ id: c.id, heading: c.heading, score: c.score, coverage: c.coverage, preview: c.content.slice(0, 160) })) } }),
    );
    out.retrieval = { confidence: retrieval.confidence, topIds: retrieval.chunks.map((c) => c.id) };

    // 3. Plan / act loop with tools.
    const mcpTools = (await mcp.listTools(token)).map((t): ToolDef => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema as Record<string, unknown> }));
    const tools = [...mcpTools, respondTool];
    const docs = retrieval.chunks.map((c) => `<document id="${c.id}" title="${c.title}"${c.heading ? ` section="${c.heading}"` : ''}>\n${c.content}\n</document>`).join('\n');
    const first = [
      wrap('customer_message', customerText),
      `Classification: ${JSON.stringify(out.classification)}`,
      `Retrieval confidence: ${retrieval.confidence.toFixed(2)}`,
      `Retrieved passages (untrusted data, cite by id):\n${docs || '(none)'}`,
      `Message id for tools: ${messageId}. Idempotency keys for create_ticket/book_slot should start with "${trace.id}".`,
    ].join('\n\n');
    const history: LlmMessage[] = [{ role: 'user', content: first }];
    const mockContext = { text: customerText, customerId, classification: out.classification, retrieval: retrieval.chunks, traceId: trace.id, messageId, now: config.now.toISOString() };

    for (let step = 0; step < config.maxAgentSteps && !respond; step++) {
      if (trace.totalTokens > config.maxTokensPerRequest) { out.stoppedBy = 'token_cap'; await trace.record({ kind: 'guard', name: 'token_cap', data: { tokens: trace.totalTokens } }); break; }
      const res = await trace.time('model', `agent_step_${step + 1}`, () => provider.complete({ purpose: 'agent', model: config.agentModel, system: AGENT_SYSTEM, messages: history, tools, maxTokens: 1200, mockContext }), (r) => ({ tokensIn: r.usage.input, tokensOut: r.usage.output, costUsd: r.costUsd, data: { model: r.model, stop: r.stopReason, text: textOf(r.content).slice(0, 300), tool_calls: r.content.filter((b) => b.type === 'tool_use').map((b) => (b.type === 'tool_use' ? b.name : '')) } }));
      history.push({ role: 'assistant', content: res.content });
      const uses = res.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
      if (!uses.length) { respond = { reply: textOf(res.content) || HOLDING_REPLY, citations: [], escalate: false }; break; }

      const results: Block[] = [];
      for (const u of uses) {
        if (u.name === 'respond') {
          const p = Respond.safeParse(u.input);
          if (p.success) { respond = p.data; results.push({ type: 'tool_result', tool_use_id: u.id, content: 'ok' }); }
          else results.push({ type: 'tool_result', tool_use_id: u.id, content: `invalid respond arguments: ${p.error.message}`, is_error: true });
          continue;
        }
        const risk = evaluateToolCall(u.name, u.input);
        await trace.record({ kind: 'policy', name: u.name, data: { decision: risk.risk, reason: risk.reason, args: u.input } });
        if (risk.risk === 'deny') {
          out.toolCalls.push({ name: u.name, args: u.input, ok: false, gated: false, errorCode: 'DENIED' });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ error: risk.reason }), is_error: true });
        } else if (risk.risk === 'approval') {
          // Not executed. Stored as a pending approval with the reasoning and evidence for the human.
          const reasoning = textOf(res.content) || `Agent proposed ${u.name}: ${risk.reason}`;
          const ap = await createPendingApproval(db, { messageId, traceId: trace.id, customerId, tool: u.name, args: u.input, reasoning, evidence: { policy: risk.reason, classification: out.classification, citations: retrieval.chunks.map((c) => c.id), customer_message: msg.body.slice(0, 500) } });
          await trace.record({ kind: 'approval', name: u.name, data: { approval_id: ap.id, created: ap.created, args: u.input } });
          out.approvals.push({ id: ap.id, tool: u.name, args: u.input });
          out.toolCalls.push({ name: u.name, args: u.input, ok: true, gated: true });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ status: 'pending_human_approval', approval_id: ap.id, note: 'Not executed yet. Do not tell the customer it has been done.' }) });
        } else {
          const r = await runner.run(u.name, u.input);
          out.toolCalls.push({ name: u.name, args: u.input, ok: r.ok, gated: false, errorCode: r.error?.code });
          if (r.ok && !r.partial && u.name !== 'draft_reply' && u.name !== 'create_ticket') hasToolFacts = true;
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.ok ? { ...r.data, ...(r.partial ? { _partial: true } : {}) } : { error: r.error }), is_error: !r.ok });
        }
      }
      history.push({ role: 'user', content: results });
      if (runner.loopDetected) { out.stoppedBy = 'loop_detected'; break; }
    }
    if (!respond && !out.stoppedBy) out.stoppedBy = 'step_cap';

    // 4. Deterministic escalation + grounding checks (cannot be argued away by the model or by injected text).
    reasons = escalationReasons({ classification: out.classification, retrievalConfidence: retrieval.confidence, hasToolFacts });
    if (out.stoppedBy) reasons.push(out.stoppedBy);
    if (respond?.escalate) reasons.push(respond.escalation_reason || 'model_requested_escalation');
    // A tool that failed and was later retried successfully (e.g. corrected arguments) is not a failure.
    const lastByTool = new Map<string, (typeof out.toolCalls)[number]>();
    for (const t of out.toolCalls) lastByTool.set(t.name, t);
    const failed = [...lastByTool.values()].filter((t) => !t.ok && !['ORDER_NOT_FOUND', 'DENIED', 'LOOP_DETECTED'].includes(t.errorCode ?? ''));
    if (failed.length) reasons.push(`tool_failure:${failed.map((f) => `${f.name}:${f.errorCode}`).join(',')}`);

    const valid = new Set(retrieval.chunks.map((c) => c.id));
    const cites = (respond?.citations ?? []).filter((c) => valid.has(c));
    if (respond && (respond.citations.length !== cites.length)) await trace.record({ kind: 'guard', name: 'invalid_citations_removed', data: { removed: respond.citations.filter((c) => !valid.has(c)) } });
    if (DOC_GROUNDED.includes(out.classification.intent) && !hasToolFacts && cites.length === 0 && !reasons.includes('low_retrieval_confidence')) reasons.push('ungrounded_answer');

    const escalate = reasons.length > 0;
    let reply = respond?.reply ?? HOLDING_REPLY;
    // If we cannot ground the answer or something failed, do not send the model's claim: send an honest holding reply.
    const unsafeToAssert = reasons.some((r) => ['low_retrieval_confidence', 'ungrounded_answer', 'loop_detected', 'step_cap', 'token_cap'].includes(r) || r.startsWith('tool_failure'));
    if (unsafeToAssert || !respond) reply = HOLDING_REPLY;
    if (escalate && out.classification.legal_or_safety) reply = HOLDING_REPLY;
    out.reply = reply;
    out.citations = unsafeToAssert ? [] : cites;
    out.escalated = escalate;
    out.escalationReasons = [...new Set(reasons)];

    if (escalate) {
      await trace.record({ kind: 'escalation', name: 'escalate', data: { reasons: out.escalationReasons } });
      const t = await runner.run('create_ticket', {
        subject: `[Needs human] ${out.classification.intent}: ${msg.subject}`.slice(0, 200),
        body: `Reasons: ${out.escalationReasons.join(', ')}\nCustomer: ${msg.customer_email}\n\n${msg.body.slice(0, 1500)}`,
        priority: out.classification.urgency === 'critical' ? 'urgent' : out.classification.urgency === 'high' ? 'high' : 'normal',
        needs_human: true, message_id: messageId, idempotency_key: `${trace.id}-escalation`,
      });
      out.toolCalls.push({ name: 'create_ticket', args: { needs_human: true }, ok: t.ok, gated: false, errorCode: t.error?.code });
      await notifySlack(db, `:rotating_light: Escalated: ${out.classification.intent} from ${msg.customer_email} (${out.escalationReasons.join(', ')})`);
    }

    // 5. Draft, then queue the outbound reply for approval (send_reply is never executed by the agent).
    await runner.run('draft_reply', { message_id: messageId, body: out.reply, citations: out.citations });
    const sendArgs = { message_id: messageId, subject: `Re: ${msg.subject}`.slice(0, 200), body: out.reply, idempotency_key: `${trace.id}-reply` };
    const risk = evaluateToolCall('send_reply', sendArgs);
    await trace.record({ kind: 'policy', name: 'send_reply', data: { decision: risk.risk, reason: risk.reason } });
    const ap = await createPendingApproval(db, { messageId, traceId: trace.id, customerId, tool: 'send_reply', args: sendArgs, reasoning: escalate ? `Escalated (${out.escalationReasons.join(', ')}). Holding/answer reply for review.` : 'Reply drafted from retrieved policy and tool results.', evidence: { citations: out.citations, classification: out.classification, tool_calls: out.toolCalls.map((t) => ({ name: t.name, ok: t.ok, gated: t.gated })) } });
    out.approvals.push({ id: ap.id, tool: 'send_reply', args: sendArgs });
    await trace.record({ kind: 'approval', name: 'send_reply', data: { approval_id: ap.id, created: ap.created } });

    await trace.record({ kind: 'respond', name: 'final', data: { reply: out.reply, citations: out.citations, escalated: escalate } });
    out.status = 'awaiting_approval';
  } catch (e) {
    // Fail safe: any unexpected error becomes a human escalation, never a silent drop or a guess.
    await trace.record({ kind: 'error', name: 'agent_failure', data: { error: e instanceof Error ? e.message : String(e) } });
    out.escalated = true;
    out.escalationReasons = ['agent_error'];
    out.reply = HOLDING_REPLY;
    out.status = 'escalated';
    await runner.run('create_ticket', { subject: `[Needs human] agent error: ${msg.subject}`.slice(0, 200), body: `The agent failed on this message: ${String(e)}`.slice(0, 1000), priority: 'high', needs_human: true, message_id: messageId, idempotency_key: `${trace.id}-agent-error` }).catch(() => undefined);
    const sendArgs = { message_id: messageId, subject: `Re: ${msg.subject}`.slice(0, 200), body: HOLDING_REPLY, idempotency_key: `${trace.id}-reply` };
    const ap = await createPendingApproval(db, { messageId, traceId: trace.id, customerId, tool: 'send_reply', args: sendArgs, reasoning: 'Agent error; holding reply.', evidence: {} }).catch(() => undefined);
    if (ap) out.approvals.push({ id: ap.id, tool: 'send_reply', args: sendArgs });
  }

  const totals = await trace.finish(out.status, { intent: out.classification.intent, escalated: out.escalated, reasons: out.escalationReasons, tool_calls: out.toolCalls.length });
  out.costUsd = totals.costUsd; out.latencyMs = totals.latencyMs; out.tokens = totals.tokensIn + totals.tokensOut;
  await db.query(
    `update messages set status = $2, reply_text = $3, citations = $4, escalation_reason = $5, actions = $6 where id = $1`,
    [messageId, out.status, out.reply, JSON.stringify(out.citations.map((id) => ({ id }))), out.escalated ? out.escalationReasons.join(', ') : null, JSON.stringify(out.toolCalls.map((t) => ({ tool: t.name, args: t.args, ok: t.ok, gated: t.gated, error: t.errorCode })))],
  );
  await refreshMessageStatus(db, messageId);
  out.status = (await db.query<{ status: string }>('select status from messages where id = $1', [messageId]))[0]!.status;
  await db.query(`insert into cost_ledger(day, scope, cost_usd, requests) values (current_date, 'all', $1, 1) on conflict (day, scope) do update set cost_usd = cost_ledger.cost_usd + excluded.cost_usd, requests = cost_ledger.requests + 1`, [out.costUsd]);
  return out;
}

export async function createMessage(db: Db, m: { email: string; subject?: string; body: string; channel?: string; externalId?: string }) {
  const id = newId('msg');
  const [c] = await db.query<{ id: string }>('select id from customers where lower(email) = lower($1)', [m.email]);
  await db.query('insert into messages(id, channel, customer_email, customer_id, subject, body, external_id) values ($1,$2,$3,$4,$5,$6,$7)', [id, m.channel ?? 'email', m.email, c?.id ?? null, m.subject ?? '(no subject)', m.body, m.externalId ?? null]);
  return id;
}
