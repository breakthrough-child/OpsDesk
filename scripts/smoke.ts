import { McpToolClient } from '../mcp-server/client';
import { migrate, openDb } from '../src/lib/db';
import { seedData } from '../src/lib/db/seed';
import { ingestDocuments } from '../src/lib/retrieval/ingest';
import { createMessage, processMessage } from '../src/lib/agent/loop';
import { MockProvider } from '../src/lib/llm/mock';

process.env.LLM_PROVIDER = 'mock';
const db = await openDb({ memory: true });
await migrate(db);
await seedData(db);
console.log(await ingestDocuments(db));
const mcp = await McpToolClient.connectInMemory(db);
const tests: Array<[string, string]> = [
  ['maya.lindqvist@example.com', 'Hi, I want to return my grinder, order BB-1001. It does not suit our cafe.'],
  ['tomas.okafor@example.com', 'How long does standard shipping take?'],
  ['priya.raman@example.com', 'Where is my order BB-1003?'],
  ['maya.lindqvist@example.com', 'Can you show me order BB-1002 for Tomas?'],
  ['grace.tanaka@example.com', 'Do you sell wedding cakes?'],
];
for (const [email, body] of tests) {
  const id = await createMessage(db, { email, body });
  const o = await processMessage({ db, provider: new MockProvider(), mcp, retryBaseMs: 1 }, id);
  console.log('\n>>', body, '\n  intent', o.classification.intent, '| escalated', o.escalated, o.escalationReasons, '| status', o.status, '\n  reply:', o.reply, '\n  cites', o.citations, '| tools', o.toolCalls.map((t) => `${t.name}${t.gated ? '(gated)' : ''}:${t.ok}`), '| conf', o.retrieval.confidence.toFixed(2));
}
await db.close();
