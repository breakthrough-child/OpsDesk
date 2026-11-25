import { McpToolClient } from '../../../mcp-server/client';
import { processMessage } from '../agent/loop';
import { config } from '../config';
import type { Db } from '../db';
import { getProvider } from '../llm';
import { runWorker } from './queue';

/** The standard handler set: one job kind, "process_message". */
export async function drainQueue(db: Db, o: { max?: number; baseMs?: number } = {}) {
  const mcp = await McpToolClient.connectInMemory(db);
  try {
    const provider = getProvider();
    return await runWorker(db, { process_message: async (job) => { await processMessage({ db, provider, mcp }, String(job.payload.messageId)); } }, o);
  } finally {
    await mcp.close();
  }
}
void config;
