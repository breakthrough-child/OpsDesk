import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../src/lib/config';
import { canonicalJson, sha256 } from '../src/lib/util';

export type Role = 'viewer' | 'agent' | 'operator' | 'admin';

export interface Claims {
  sub: string;
  role: Role;
  exp: number; // unix seconds
  /** Customer the agent is acting for. When set, tools may only touch this customer's data. */
  cust?: string;
  trace?: string;
}

export const TOOL_NAMES = ['lookup_order', 'create_ticket', 'list_available_slots', 'book_slot', 'draft_reply', 'issue_refund', 'send_reply', 'cancel_booking', 'delete_ticket'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const AGENT: ToolName[] = ['lookup_order', 'create_ticket', 'draft_reply', 'list_available_slots', 'book_slot'];
const OPERATOR: ToolName[] = [...AGENT, 'issue_refund', 'send_reply', 'cancel_booking'];

/** Enforced inside the MCP server, independent of whatever the agent decides to call. */
export const ROLE_TOOLS: Record<Role, ToolName[]> = {
  viewer: ['lookup_order', 'list_available_slots'],
  agent: AGENT,
  operator: OPERATOR,
  admin: [...OPERATOR, 'delete_ticket'],
};

/** Tools that additionally need a signed approval token minted when a human approved this exact call. */
export const NEEDS_APPROVAL_TOKEN: ToolName[] = ['issue_refund', 'send_reply', 'cancel_booking'];

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (prefix: string, body: string) => createHmac('sha256', config.tokenSecret).update(`${prefix}.${body}`).digest('base64url');

function open<T>(prefix: string, token: string | undefined): T | null {
  if (!token) return null;
  const [p, body, sig] = token.split('.');
  if (p !== prefix || !body || !sig) return null;
  const expected = sign(prefix, body);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

export function mintToken(c: Omit<Claims, 'exp'> & { ttlSec?: number; exp?: number }): string {
  const body = b64(JSON.stringify({ ...c, ttlSec: undefined, exp: c.exp ?? nowSec() + (c.ttlSec ?? 900) }));
  return `opsdesk.${body}.${sign('opsdesk', body)}`;
}

export type AuthResult = { ok: true; claims: Claims } | { ok: false; reason: 'missing' | 'invalid' | 'expired' };

export function verifyToken(token: string | undefined): AuthResult {
  if (!token) return { ok: false, reason: 'missing' };
  const c = open<Claims>('opsdesk', token.replace(/^Bearer\s+/i, ''));
  if (!c || !c.sub || !(c.role in ROLE_TOOLS)) return { ok: false, reason: 'invalid' };
  if (c.exp <= nowSec()) return { ok: false, reason: 'expired' };
  return { ok: true, claims: c };
}

interface ApprovalClaims { aid: string; tool: string; ah: string; exp: number }

export const argsHash = (args: unknown) => sha256(canonicalJson(args));

export function mintApprovalToken(a: { approvalId: string; tool: string; args: unknown; ttlSec?: number }): string {
  const body = b64(JSON.stringify({ aid: a.approvalId, tool: a.tool, ah: argsHash(a.args), exp: nowSec() + (a.ttlSec ?? 300) } satisfies ApprovalClaims));
  return `apr.${body}.${sign('apr', body)}`;
}

export function verifyApprovalToken(token: string | undefined, tool: string, args: unknown): { ok: true; approvalId: string } | { ok: false; reason: string } {
  const c = open<ApprovalClaims>('apr', token);
  if (!c) return { ok: false, reason: 'approval token missing or invalid' };
  if (c.exp <= nowSec()) return { ok: false, reason: 'approval token expired' };
  if (c.tool !== tool) return { ok: false, reason: 'approval token is for a different tool' };
  if (c.ah !== argsHash(args)) return { ok: false, reason: 'approval token does not match these arguments' };
  return { ok: true, approvalId: c.aid };
}
