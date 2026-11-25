import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Db } from '../src/lib/db';
import type { CalendarProvider } from '../src/lib/integrations/calendar';
import { getCalendar } from '../src/lib/integrations/calendar';
import { AppError, sleep } from '../src/lib/util';
import { NEEDS_APPROVAL_TOKEN, ROLE_TOOLS, verifyApprovalToken, verifyToken, type ToolName } from './auth';
import { writeAudit } from './audit';
import { faults, type FaultRule } from './faults';
import { TOOLS } from './tools';

export interface ServerOpts {
  db: Db;
  calendar?: CalendarProvider;
  /** Token from the transport (HTTP Authorization header). In-memory/stdio clients pass it in request _meta instead. */
  transportToken?: () => string | undefined;
}

type Meta = { token?: string; approvalToken?: string; traceId?: string; fault?: Partial<FaultRule> } | undefined;

const text = (v: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }], isError });

export function createOpsDeskServer(opts: ServerOpts) {
  const { db } = opts;
  const server = new Server({ name: 'opsdesk-tools', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
    const meta = req.params?._meta as Meta;
    const auth = verifyToken(extra.authInfo?.token ?? meta?.token ?? opts.transportToken?.());
    if (!auth.ok) return { tools: [] };
    return {
      tools: ROLE_TOOLS[auth.claims.role].map((name) => ({
        name,
        description: TOOLS[name].description,
        inputSchema: zodToJsonSchema(TOOLS[name].schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as { type: 'object' },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const t0 = Date.now();
    const name = req.params.name;
    const rawArgs = req.params.arguments ?? {};
    const meta = req.params._meta as Meta;
    const auth = verifyToken(extra.authInfo?.token ?? meta?.token ?? opts.transportToken?.());
    const actor = auth.ok ? auth.claims.sub : 'anonymous';
    const role = auth.ok ? auth.claims.role : 'none';
    const traceId = meta?.traceId ?? (auth.ok ? auth.claims.trace : undefined);
    const audit = (status: 'ok' | 'error' | 'denied', error?: string) => writeAudit(db, { actor, role, tool: name, args: rawArgs, status, error, latencyMs: Date.now() - t0, traceId });
    // Denied calls execute nothing, are logged, and return a typed error.
    const deny = async (code: string, message: string) => {
      await audit('denied', `${code}: ${message}`);
      return text({ ok: false, error: { code, message, retryable: false } }, true);
    };

    if (!auth.ok) return deny('UNAUTHENTICATED', `bearer token ${auth.reason}`);
    const tool = name as ToolName;
    if (!(name in TOOLS)) return deny('UNKNOWN_TOOL', `no such tool: ${name}`);
    if (!ROLE_TOOLS[auth.claims.role].includes(tool)) return deny('FORBIDDEN_ROLE', `role ${auth.claims.role} may not call ${name}`);

    let approvalId: string | undefined;
    if (NEEDS_APPROVAL_TOKEN.includes(tool)) {
      // The approval token is bound to the tool and the exact args a human approved (approval_id is part of the args).
      const v = verifyApprovalToken(meta?.approvalToken, name, rawArgs);
      if (!v.ok) return deny('APPROVAL_REQUIRED', v.reason);
      approvalId = v.approvalId;
    }

    const def = TOOLS[tool];
    const parsed = def.schema.safeParse(rawArgs);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ');
      await audit('error', `INVALID_ARGUMENTS: ${msg}`);
      return text({ ok: false, error: { code: 'INVALID_ARGUMENTS', message: msg, retryable: false } }, true);
    }

    try {
      const fault = faults.next(name, meta?.fault);
      if (fault?.mode === 'timeout') { await sleep(fault.delayMs ?? 5000); throw new AppError('upstream timeout', 'TIMEOUT', true); }
      if (fault?.mode === 'error5xx') throw new AppError('upstream 503 service unavailable', 'UPSTREAM_5XX', true);
      if (fault?.mode === 'invalid_args') throw new AppError('server rejected arguments (injected)', 'INVALID_ARGUMENTS', false);
      if (fault?.mode === 'slow') await sleep(fault.delayMs ?? 300);

      const calendar = opts.calendar ?? (await getCalendar(db));
      const ctx = { db, claims: auth.claims, calendar, partial: fault?.mode === 'partial' };
      let data = await def.handler(ctx, parsed.data);
      // Simulated duplicate delivery: the same call arrives twice. Idempotency keys must make the second a no-op.
      if (fault?.mode === 'duplicate') data = await def.handler(ctx, parsed.data);
      await audit('ok', approvalId ? `approval:${approvalId}` : undefined);
      return text({ ok: true, data, partial: fault?.mode === 'partial' || undefined });
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError(e instanceof Error ? e.message : String(e), 'INTERNAL', false);
      await audit('error', `${err.code}: ${err.message}`);
      return text({ ok: false, error: { code: err.code, message: err.message, retryable: err.retryable } }, true);
    }
  });

  return server;
}
