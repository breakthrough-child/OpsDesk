import type { Db } from '../db';
import { newId } from '../util';
import { recordIntegration } from './status';

export interface OutboundMessage {
  messageId?: string;
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  approvalId?: string;
}

/**
 * Channel adapter. To go live with real email/WhatsApp, implement this interface (see docs/INTEGRATIONS.md)
 * and register it in getChannel(). The default adapter only writes to the outbox table.
 */
export interface ChannelAdapter {
  name: string;
  send(db: Db, msg: OutboundMessage): Promise<{ outboxId: string; duplicate: boolean }>;
}

export const simulatedChannel: ChannelAdapter = {
  name: 'simulated_outbox',
  async send(db, m) {
    const id = newId('out');
    const rows = await db.query<{ id: string }>(
      `insert into outbox(id, message_id, to_email, subject, body, channel, status, idempotency_key, approval_id)
       values ($1,$2,$3,$4,$5,'email','simulated_sent',$6,$7) on conflict (idempotency_key) do nothing returning id`,
      [id, m.messageId ?? null, m.to, m.subject, m.body, m.idempotencyKey, m.approvalId ?? null],
    );
    await recordIntegration(db, 'outbound_channel', 'mock', true);
    if (rows.length) return { outboxId: id, duplicate: false };
    const [existing] = await db.query<{ id: string }>('select id from outbox where idempotency_key = $1', [m.idempotencyKey]);
    return { outboxId: existing!.id, duplicate: true };
  },
};

export const getChannel = (): ChannelAdapter => simulatedChannel;
