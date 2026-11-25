import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Db } from '../src/lib/db';
import type { CalendarProvider } from '../src/lib/integrations/calendar';
import { createOpsDeskServer } from './server';

export interface ToolResult {
  ok: boolean;
  data?: Record<string, unknown>;
  partial?: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

/** A real MCP client connected to the OpsDesk MCP server (in-process transport; same protocol as stdio/HTTP). */
export class McpToolClient {
  private constructor(private client: Client, private closeFn: () => Promise<void>) {}

  static async connectInMemory(db: Db, calendar?: CalendarProvider) {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createOpsDeskServer({ db, calendar });
    const client = new Client({ name: 'opsdesk-agent', version: '0.1.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    return new McpToolClient(client, async () => { await client.close(); await server.close(); });
  }

  async listTools(token: string) {
    return (await this.client.listTools({ _meta: { token } } as never)).tools;
  }

  async call(name: string, args: Record<string, unknown>, o: { token?: string; approvalToken?: string; traceId?: string; fault?: unknown; timeoutMs?: number }): Promise<ToolResult> {
    const res = await this.client.callTool(
      { name, arguments: args, _meta: { token: o.token, approvalToken: o.approvalToken, traceId: o.traceId, fault: o.fault } } as never,
      undefined,
      { timeout: o.timeoutMs ?? 10_000 },
    );
    const t = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
    return JSON.parse(t) as ToolResult;
  }

  close() { return this.closeFn(); }
}
