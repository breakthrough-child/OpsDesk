import { mintApprovalToken, mintToken } from '../../../mcp-server/auth';
import { McpToolClient } from '../../../mcp-server/client';
import type { Db } from '../db';
import { notifySlack } from '../integrations/slack';
import { argsHash } from '../../../mcp-server/auth';
import { newId } from '../util';

export interface ApprovalRow {
  id: string; message_id: string | null; trace_id: string | null; customer_id: string | null; tool: string;
  args: Record<string, unknown>; edited_args: Record<string, unknown> | null; reasoning: string | null; evidence: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'failed'; idempotency_key: string; decided_by: string | null; result: Record<string, unknown> | null; created_at: string;
}

export async function createPendingApproval(db: Db, a: { messageId?: string; traceId?: string; customerId?: string; tool: string; args: Record<string, unknown>; reasoning: string; evidence: Record<string, unknown> }) {
  const key = `${a.traceId ?? 'none'}:${a.tool}:${argsHash(a.args)}`;
  const id = newId('apr');
  const rows = await db.query<{ id: string }>(
    `insert into approvals(id, message_id, trace_id, customer_id, tool, args, reasoning, evidence, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (idempotency_key) do nothing returning id`,
    [id, a.messageId ?? null, a.traceId ?? null, a.customerId ?? null, a.tool, JSON.stringify(a.args), a.reasoning, JSON.stringify(a.evidence), key],
  );
  if (rows.length) {
    await notifySlack(db, `:warning: Approval waiting: ${a.tool} (${id}) ${a.reasoning.slice(0, 120)}`);
    return { id, created: true };
  }
  const [e] = await db.query<{ id: string }>('select id from approvals where idempotency_key = $1', [key]);
  return { id: e!.id, created: false };
}

export async function refreshMessageStatus(db: Db, messageId: string | null | undefined) {
  if (!messageId) return;
  const pending = (await db.query<{ pending: number }>("select count(*)::int as pending from approvals where message_id = $1 and status = 'pending'", [messageId]))[0]!.pending;
  const [m] = await db.query<{ escalation_reason: string | null; status: string }>('select escalation_reason, status from messages where id = $1', [messageId]);
  if (!m || m.status === 'new' || m.status === 'processing') return;
  const status = pending > 0 ? 'awaiting_approval' : m.escalation_reason ? 'escalated' : 'handled';
  await db.query('update messages set status = $2 where id = $1', [messageId, status]);
}

export interface DecideInput { decision: 'approve' | 'reject'; by: string; editedArgs?: Record<string, unknown>; mcp?: McpToolClient }

/**
 * Human decision on a pending approval. The transition pending -> approved/rejected is atomic, so a double click or a
 * replayed request cannot decide (or execute) twice. Execution uses a stable idempotency key derived from the approval id.
 */
export async function decideApproval(db: Db, id: string, input: DecideInput): Promise<{ approval: ApprovalRow; executed: boolean; alreadyDecided: boolean }> {
  const next = input.decision === 'approve' ? 'approved' : 'rejected';
  const claimed = await db.query<ApprovalRow>(
    `update approvals set status = $2, decided_by = $3, decided_at = now(), edited_args = $4 where id = $1 and status = 'pending' returning *`,
    [id, next, input.by, input.editedArgs ? JSON.stringify(input.editedArgs) : null],
  );
  if (!claimed.length) {
    const [cur] = await db.query<ApprovalRow>('select * from approvals where id = $1', [id]);
    if (!cur) throw new Error(`approval ${id} not found`);
    // A previously failed execution may be retried by approving again: same idempotency key, so no double effect.
    if (cur.status === 'failed' && input.decision === 'approve') {
      await db.query("update approvals set status = 'approved', result = null where id = $1 and status = 'failed'", [id]);
      return { ...(await executeApproved(db, id, input.mcp)), alreadyDecided: true };
    }
    return { approval: cur, executed: false, alreadyDecided: true };
  }
  const approval = claimed[0]!;
  if (next === 'rejected') {
    await refreshMessageStatus(db, approval.message_id);
    return { approval, executed: false, alreadyDecided: false };
  }
  const out = await executeApproved(db, id, input.mcp);
  return { ...out, alreadyDecided: false };
}

export async function executeApproved(db: Db, id: string, mcp?: McpToolClient): Promise<{ approval: ApprovalRow; executed: boolean }> {
  const [a] = await db.query<ApprovalRow>('select * from approvals where id = $1', [id]);
  if (!a || a.status !== 'approved') throw new Error('approval is not in approved state');
  const own = !mcp;
  const client = mcp ?? (await McpToolClient.connectInMemory(db));
  try {
    const args: Record<string, unknown> = { ...(a.edited_args ?? a.args), idempotency_key: `approval-${a.id}`, approval_id: a.id };
    if (a.tool === 'cancel_booking' || a.tool === 'send_reply' || a.tool === 'issue_refund') {
      const token = mintToken({ sub: a.decided_by ?? 'operator', role: 'operator', cust: a.customer_id ?? undefined, trace: a.trace_id ?? undefined, ttlSec: 120 });
      const approvalToken = mintApprovalToken({ approvalId: a.id, tool: a.tool, args });
      const res = await client.call(a.tool, args, { token, approvalToken, traceId: a.trace_id ?? undefined, timeoutMs: 10_000 });
      if (!res.ok) {
        await db.query("update approvals set result = $2, status = 'failed' where id = $1", [id, JSON.stringify({ ok: false, error: res.error })]);
        const [cur] = await db.query<ApprovalRow>('select * from approvals where id = $1', [id]);
        return { approval: cur!, executed: false };
      }
      await db.query('update approvals set result = $2, executed_at = now() where id = $1', [id, JSON.stringify({ ok: true, ...res.data })]);
    }
    await refreshMessageStatus(db, a.message_id);
    const [cur] = await db.query<ApprovalRow>('select * from approvals where id = $1', [id]);
    return { approval: cur!, executed: true };
  } finally {
    if (own) await client.close();
  }
}
