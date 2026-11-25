import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { argsHash, mintApprovalToken, mintToken, verifyToken } from '../mcp-server/auth';
import { faults } from '../mcp-server/faults';
import { makeEnv, tokenFor } from './helpers';

let env: Awaited<ReturnType<typeof makeEnv>>;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.close(); });
beforeEach(() => faults.clear());

const audit = (tool: string) => env.db.query<{ status: string; error: string | null; actor: string; role: string }>('select status, error, actor, role from audit_log where tool = $1 order by id', [tool]);

describe('MCP auth', () => {
  it('rejects missing, invalid and expired tokens, and logs each denial', async () => {
    const none = await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, {});
    const bad = await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: 'opsdesk.x.y' });
    const expired = await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: mintToken({ sub: 'u', role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }) });
    for (const r of [none, bad, expired]) { expect(r.ok).toBe(false); expect(r.error?.code).toBe('UNAUTHENTICATED'); }
    const rows = await audit('lookup_order');
    expect(rows.filter((r) => r.status === 'denied')).toHaveLength(3);
  });
  it('rejects a tampered token', () => {
    const t = tokenFor('viewer');
    const [p, body, sig] = t.split('.');
    const forged = `${p}.${Buffer.from(JSON.stringify({ sub: 'x', role: 'admin', exp: 9999999999 })).toString('base64url')}.${sig}`;
    expect(verifyToken(forged).ok).toBe(false);
    expect(verifyToken(`${p}.${body}.${sig}`).ok).toBe(true);
  });
});

describe('MCP roles', () => {
  it('lists only the tools a role may call', async () => {
    expect((await env.mcp.listTools(tokenFor('agent'))).map((t) => t.name).sort()).toEqual(['book_slot', 'create_ticket', 'draft_reply', 'list_available_slots', 'lookup_order']);
    expect((await env.mcp.listTools(tokenFor('admin'))).map((t) => t.name)).toContain('delete_ticket');
    expect(await env.mcp.listTools('garbage')).toHaveLength(0);
  });
  it('a denied call executes nothing and is still logged', async () => {
    const before = (await env.db.query<{ n: number }>('select count(*)::int as n from refunds'))[0]!.n;
    const r = await env.mcp.call('issue_refund', { order_id: 'BB-1001', amount: 10, reason: 'because', idempotency_key: 'denied-key-1' }, { token: tokenFor('agent', 'c01') });
    expect(r.error?.code).toBe('FORBIDDEN_ROLE');
    expect((await env.db.query<{ n: number }>('select count(*)::int as n from refunds'))[0]!.n).toBe(before);
    expect((await audit('issue_refund')).some((a) => a.status === 'denied' && a.role === 'agent')).toBe(true);
  });
  it('destructive tools are admin-only', async () => {
    const t = await env.db.query<{ id: string }>("insert into tickets(id, subject, body, idempotency_key) values ('tkt_del','s','b','k-del-1') returning id");
    expect((await env.mcp.call('delete_ticket', { ticket_id: t[0]!.id }, { token: tokenFor('operator') })).error?.code).toBe('FORBIDDEN_ROLE');
    expect((await env.mcp.call('delete_ticket', { ticket_id: t[0]!.id }, { token: tokenFor('admin') })).ok).toBe(true);
  });
  it('refund needs an approval token bound to the exact arguments', async () => {
    const args = { order_id: 'BB-1001', amount: 100, reason: 'return within window', idempotency_key: 'approval-test-1' };
    const op = tokenFor('operator');
    expect((await env.mcp.call('issue_refund', args, { token: op })).error?.code).toBe('APPROVAL_REQUIRED');
    const wrongArgs = mintApprovalToken({ approvalId: 'a1', tool: 'issue_refund', args: { ...args, amount: 1 } });
    expect((await env.mcp.call('issue_refund', args, { token: op, approvalToken: wrongArgs })).error?.code).toBe('APPROVAL_REQUIRED');
    const wrongTool = mintApprovalToken({ approvalId: 'a1', tool: 'send_reply', args });
    expect((await env.mcp.call('issue_refund', args, { token: op, approvalToken: wrongTool })).error?.code).toBe('APPROVAL_REQUIRED');
    const good = mintApprovalToken({ approvalId: 'a1', tool: 'issue_refund', args });
    expect((await env.mcp.call('issue_refund', args, { token: op, approvalToken: good })).ok).toBe(true);
    expect(argsHash(args)).toHaveLength(64);
  });
});

describe('MCP tools: idempotency, privacy, validation', () => {
  it('refund is idempotent and capped at the order total', async () => {
    const op = tokenFor('operator');
    const mk = (amount: number, key: string) => { const a = { order_id: 'BB-1011', amount, reason: 'test refund', idempotency_key: key }; return env.mcp.call('issue_refund', a, { token: op, approvalToken: mintApprovalToken({ approvalId: key, tool: 'issue_refund', args: a }) }); };
    const first = await mk(30, 'idem-key-aaaa');
    const again = await mk(30, 'idem-key-aaaa');
    expect(first.data?.duplicate).toBe(false);
    expect(again.data?.duplicate).toBe(true);
    expect(again.data?.refund_id).toBe(first.data?.refund_id);
    expect((await mk(500, 'idem-key-bbbb')).error?.code).toBe('REFUND_EXCEEDS_TOTAL');
  });
  it('a customer-scoped token cannot read another customer\'s order, and cannot tell it exists', async () => {
    const other = await env.mcp.call('lookup_order', { order_id: 'BB-1002' }, { token: tokenFor('agent', 'c01') });
    const missing = await env.mcp.call('lookup_order', { order_id: 'BB-9999' }, { token: tokenFor('agent', 'c01') });
    expect(other.ok).toBe(false);
    expect(other.error?.code).toBe(missing.error?.code);
    expect(JSON.stringify(other)).not.toContain('DB-12');
    expect((await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: tokenFor('agent', 'c01') })).ok).toBe(true);
  });
  it('rejects invalid arguments with a typed non-retryable error', async () => {
    const r = await env.mcp.call('lookup_order', { order_id: '1001' }, { token: tokenFor('agent', 'c01') });
    expect(r.error?.code).toBe('INVALID_ARGUMENTS');
    expect(r.error?.retryable).toBe(false);
  });
  it('send_reply always goes to the original sender, never an argument', async () => {
    await env.db.query("insert into messages(id, customer_email, body) values ('m_x', 'maya.lindqvist@example.com', 'hi')");
    const args = { message_id: 'm_x', body: 'hello', subject: 's', idempotency_key: 'reply-key-1', to: 'evil@example.com' };
    const op = tokenFor('operator');
    const r = await env.mcp.call('send_reply', args, { token: op, approvalToken: mintApprovalToken({ approvalId: 'a', tool: 'send_reply', args }) });
    expect(r.ok).toBe(true);
    expect((await env.db.query<{ to_email: string }>("select to_email from outbox where idempotency_key = 'reply-key-1'"))[0]!.to_email).toBe('maya.lindqvist@example.com');
  });
});

describe('MCP audit log', () => {
  it('is append-only', async () => {
    await expect(env.db.query("update audit_log set actor = 'x'")).rejects.toThrow(/append-only/);
    await expect(env.db.query('delete from audit_log')).rejects.toThrow(/append-only/);
  });
  it('redacts sensitive argument fields', async () => {
    await env.mcp.call('create_ticket', { subject: 'redact test', body: 'b', idempotency_key: 'redact-key-1', email: 'secret@example.com' } as never, { token: tokenFor('agent') });
    const [row] = await env.db.query<{ args: Record<string, unknown> }>("select args from audit_log where tool = 'create_ticket' order by id desc limit 1");
    expect(JSON.stringify(row!.args)).not.toContain('secret@example.com');
  });
});

describe('MCP fault injection (test mode)', () => {
  const tok = () => tokenFor('agent', 'c01');
  it('error5xx is typed and retryable', async () => {
    faults.set({ tool: 'lookup_order', mode: 'error5xx', times: 1 });
    const r = await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: tok() });
    expect(r.error).toMatchObject({ code: 'UPSTREAM_5XX', retryable: true });
    expect((await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: tok() })).ok).toBe(true);
  });
  it('partial results are flagged', async () => {
    faults.set({ tool: 'lookup_order', mode: 'partial', times: 1 });
    const r = await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: tok() });
    expect(r.partial).toBe(true);
    expect(r.data?.items).toBeUndefined();
  });
  it('timeout surfaces as a client-side timeout', async () => {
    faults.set({ tool: 'lookup_order', mode: 'timeout', times: 1, delayMs: 400 });
    await expect(env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: tok(), timeoutMs: 100 })).rejects.toThrow();
  });
  it('duplicate delivery of a keyed call does not duplicate the effect', async () => {
    faults.set({ tool: 'create_ticket', mode: 'duplicate', times: 1 });
    const args = { subject: 'dup test', body: 'body', idempotency_key: 'dup-ticket-key' };
    expect((await env.mcp.call('create_ticket', args, { token: tok() })).ok).toBe(true);
    expect((await env.db.query<{ n: number }>("select count(*)::int as n from tickets where idempotency_key = 'dup-ticket-key'"))[0]!.n).toBe(1);
  });
  it('inline faults are ignored when fault injection is disabled', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const r = await env.mcp.call('lookup_order', { order_id: 'BB-1001' }, { token: tok(), fault: { mode: 'error5xx' } });
    (process.env as Record<string, string>).NODE_ENV = prev!;
    expect(r.ok).toBe(true);
  });
});
