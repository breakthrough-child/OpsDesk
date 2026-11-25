import type { Db } from './db';
import { createMessage } from './agent/loop';
import { enqueue } from './queue/queue';

export interface InboundPayload { id?: string; email: string; subject?: string; body: string; channel?: string }

/** Idempotent ingest of one inbound message: a repeated idempotency key creates no new message or job. */
export async function acceptInbound(db: Db, key: string, p: InboundPayload): Promise<{ messageId: string; duplicate: boolean }> {
  const claimed = await db.query('insert into webhook_events(idempotency_key) values ($1) on conflict do nothing returning idempotency_key', [key]);
  if (!claimed.length) {
    const [e] = await db.query<{ message_id: string | null }>('select message_id from webhook_events where idempotency_key = $1', [key]);
    return { messageId: e?.message_id ?? '', duplicate: true };
  }
  const messageId = await createMessage(db, { email: p.email, subject: p.subject, body: p.body, channel: p.channel, externalId: p.id });
  await db.query('update webhook_events set message_id = $2 where idempotency_key = $1', [key, messageId]);
  await enqueue(db, 'process_message', { messageId });
  return { messageId, duplicate: false };
}
