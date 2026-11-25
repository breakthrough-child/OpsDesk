import { McpToolClient } from '../mcp-server/client';
import { mintToken, type Role } from '../mcp-server/auth';
import { CircuitBreaker } from '../src/lib/agent/breaker';
import { createMessage, processMessage } from '../src/lib/agent/loop';
import type { Db } from '../src/lib/db';
import { migrate, openDb } from '../src/lib/db';
import { seedData } from '../src/lib/db/seed';
import { MockProvider } from '../src/lib/llm/mock';
import { ingestDocuments } from '../src/lib/retrieval/ingest';

process.env.LLM_PROVIDER = 'mock';

export async function makeEnv() {
  const db: Db = await openDb({ memory: true });
  await migrate(db);
  await seedData(db);
  await ingestDocuments(db);
  const mcp = await McpToolClient.connectInMemory(db);
  return { db, mcp, close: async () => { await mcp.close(); await db.close(); } };
}

export const tokenFor = (role: Role, cust?: string, sub = `test-${role}`) => mintToken({ sub, role, cust });

export async function runAgent(env: { db: Db; mcp: McpToolClient }, email: string, body: string, extra: Partial<Parameters<typeof processMessage>[0]> = {}) {
  const id = await createMessage(env.db, { email, body, subject: body.slice(0, 40) });
  return processMessage({ db: env.db, provider: new MockProvider(), mcp: env.mcp, breaker: new CircuitBreaker(), retryBaseMs: 1, ...extra }, id);
}

export const MAYA = 'maya.lindqvist@example.com';
export const PRIYA = 'priya.raman@example.com';
