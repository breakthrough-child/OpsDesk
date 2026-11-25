// Run:  OPSDESK_TOKEN=$(pnpm -s token --role operator) pnpm mcp
// Connect from Claude Desktop / Claude Code: see docs/INTEGRATIONS.md
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb, migrate } from '../src/lib/db';
import { seedIfEmpty } from '../src/lib/db/seed';
import { createOpsDeskServer } from './server';

const db = await openDb();
await migrate(db);
await seedIfEmpty(db);
const server = createOpsDeskServer({ db, transportToken: () => process.env.OPSDESK_TOKEN });
await server.connect(new StdioServerTransport());
console.error('opsdesk MCP server ready on stdio');
