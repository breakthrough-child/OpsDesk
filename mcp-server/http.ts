// Streamable HTTP transport. Authorization: Bearer <token> is verified inside the server for every call.
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { openDb, migrate } from '../src/lib/db';
import { seedIfEmpty } from '../src/lib/db/seed';
import { createOpsDeskServer } from './server';

const db = await openDb();
await migrate(db);
await seedIfEmpty(db);
const port = Number(process.env.MCP_PORT ?? 3333);

http
  .createServer(async (req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    // Stateless: a fresh server+transport per request; the token travels as authInfo.
    (req as unknown as { auth?: unknown }).auth = token ? { token, clientId: 'http', scopes: [] } : undefined;
    const server = createOpsDeskServer({ db });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  })
  .listen(port, () => console.error(`opsdesk MCP over HTTP on :${port}/mcp`));
