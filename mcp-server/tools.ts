import { z } from 'zod';
import { config } from '../src/lib/config';
import type { Db } from '../src/lib/db';
import { getChannel } from '../src/lib/integrations/channel';
import type { CalendarProvider } from '../src/lib/integrations/calendar';
import { AppError, newId, round } from '../src/lib/util';
import type { Claims, ToolName } from './auth';

export interface ToolCtx {
  db: Db;
  claims: Claims;
  calendar: CalendarProvider;
  /** True when a fault asked for partial results. */
  partial: boolean;
}

interface ToolDef<S extends z.ZodTypeAny> {
  description: string;
  schema: S;
  /** Safe to retry without an idempotency key (pure reads). */
  idempotent: boolean;
  handler: (ctx: ToolCtx, args: z.infer<S>) => Promise<unknown>;
}

interface AnyTool {
  description: string;
  schema: z.ZodTypeAny;
  idempotent: boolean;
  handler: (ctx: ToolCtx, args: any) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const def = <S extends z.ZodTypeAny>(d: ToolDef<S>) => d as unknown as AnyTool;
const orderId = z.string().regex(/^BB-\d{4}$/, 'order ids look like BB-1234');
const idemKey = z.string().min(8).max(120);

export const TOOLS: Record<ToolName, AnyTool> = {
  lookup_order: def({
    description: 'Look up one order by id. Only returns orders belonging to the customer in this conversation.',
    schema: z.object({ order_id: orderId }),
    idempotent: true,
    async handler({ db, claims, partial }, { order_id }) {
      const [o] = await db.query<Record<string, unknown>>('select * from orders where id = $1', [order_id]);
      // Same error for "does not exist" and "belongs to someone else" so ids cannot be enumerated.
      if (!o || (claims.cust && o.customer_id !== claims.cust)) {
        throw new AppError(`order ${order_id} not found for this customer`, 'ORDER_NOT_FOUND', false);
      }
      const delivered = o.delivered_at ? new Date(o.delivered_at as string) : null;
      const out = {
        order_id: o.id, status: o.status, placed_at: o.placed_at, shipped_at: o.shipped_at, delivered_at: o.delivered_at,
        items: o.items, total: o.total, shipping_method: o.shipping_method, carrier: o.carrier, tracking_number: o.tracking_number,
        days_since_delivery: delivered ? Math.floor((config.now.getTime() - delivered.getTime()) / 86400000) : null,
      };
      if (partial) return { order_id: out.order_id, status: out.status, _partial: true };
      return out;
    },
  }),

  create_ticket: def({
    description: 'Create a support ticket. Set needs_human=true to flag it for a person to handle.',
    schema: z.object({ subject: z.string().min(3).max(200), body: z.string().min(3).max(4000), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), needs_human: z.boolean().default(false), message_id: z.string().optional(), idempotency_key: idemKey }),
    idempotent: false,
    async handler({ db, claims }, a) {
      const id = newId('tkt');
      const rows = await db.query<{ id: string }>(
        `insert into tickets(id, customer_id, message_id, subject, body, priority, needs_human, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (idempotency_key) do nothing returning id`,
        [id, claims.cust ?? null, a.message_id ?? null, a.subject, a.body, a.priority, a.needs_human, a.idempotency_key],
      );
      if (rows.length) return { ticket_id: id, duplicate: false };
      const [t] = await db.query<{ id: string }>('select id from tickets where idempotency_key = $1', [a.idempotency_key]);
      return { ticket_id: t!.id, duplicate: true };
    },
  }),

  list_available_slots: def({
    description: 'List open 30-minute consultation slots (Mon-Thu 10:00-16:00 Pacific). Paginated: pass next_cursor back to get more.',
    schema: z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(25).default(8) }),
    idempotent: true,
    async handler({ calendar }, a) {
      const page = await calendar.listSlots(a);
      return { slots: page.slots, next_cursor: page.nextCursor ?? null, calendar_mode: calendar.mode };
    },
  }),

  book_slot: def({
    description: 'Book a consultation slot for the customer in this conversation.',
    schema: z.object({ slot_start: z.string().datetime(), topic: z.string().max(200).optional(), idempotency_key: idemKey }),
    idempotent: false,
    async handler({ db, claims, calendar }, a) {
      const [dup] = await db.query<{ id: string; slot_start: string }>('select id, slot_start from bookings where idempotency_key = $1', [a.idempotency_key]);
      if (dup) return { booking_id: dup.id, slot_start: dup.slot_start, duplicate: true };
      const page = await calendar.listSlots({ from: a.slot_start, to: new Date(new Date(a.slot_start).getTime() + 1800000).toISOString(), limit: 1 });
      const slot = page.slots.find((s) => new Date(s.start).getTime() === new Date(a.slot_start).getTime());
      if (!slot) throw new AppError('that slot is not available', 'SLOT_UNAVAILABLE');
      const ev = await calendar.createEvent({ start: slot.start, end: slot.end, summary: `Consultation (${claims.cust ?? 'guest'})`, key: a.idempotency_key });
      const id = newId('bk');
      await db.query('insert into bookings(id, customer_id, slot_start, slot_end, topic, external_event_id, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7)', [id, claims.cust ?? null, slot.start, slot.end, a.topic ?? null, ev.eventId, a.idempotency_key]);
      return { booking_id: id, slot_start: slot.start, slot_end: slot.end, duplicate: false };
    },
  }),

  cancel_booking: def({
    description: 'Cancel a booking. Requires a human approval token.',
    schema: z.object({ booking_id: z.string().min(3), idempotency_key: idemKey }),
    idempotent: false,
    async handler({ db, calendar }, a) {
      const [b] = await db.query<{ id: string; status: string; external_event_id: string | null }>('select id, status, external_event_id from bookings where id = $1', [a.booking_id]);
      if (!b) throw new AppError('booking not found', 'BOOKING_NOT_FOUND');
      if (b.status === 'cancelled') return { booking_id: b.id, status: 'cancelled', duplicate: true };
      if (b.external_event_id) await calendar.deleteEvent(b.external_event_id);
      await db.query("update bookings set status = 'cancelled' where id = $1", [b.id]);
      return { booking_id: b.id, status: 'cancelled', duplicate: false };
    },
  }),

  draft_reply: def({
    description: 'Save a draft reply to the customer (does not send anything).',
    schema: z.object({ message_id: z.string(), body: z.string().min(1).max(6000), citations: z.array(z.string()).default([]) }),
    idempotent: true,
    async handler({ db }, a) {
      const id = newId('drf');
      await db.query('insert into drafts(id, message_id, body, citations) values ($1,$2,$3,$4)', [id, a.message_id, a.body, JSON.stringify(a.citations)]);
      return { draft_id: id };
    },
  }),

  issue_refund: def({
    description: 'Issue a refund. Requires a human approval token. Idempotent on idempotency_key and capped at the order total across all refunds.',
    schema: z.object({ order_id: orderId, amount: z.number().positive().max(100000), reason: z.string().min(3).max(500), idempotency_key: idemKey, approval_id: z.string().optional() }),
    idempotent: false,
    async handler({ db }, a) {
      return db.tx(async (tx) => {
        const [dup] = await tx.query<{ id: string; amount: number }>('select id, amount from refunds where idempotency_key = $1', [a.idempotency_key]);
        if (dup) return { refund_id: dup.id, amount: dup.amount, duplicate: true };
        const [o] = await tx.query<{ total: number; status: string }>('select total, status from orders where id = $1', [a.order_id]);
        if (!o) throw new AppError('order not found', 'ORDER_NOT_FOUND');
        if (o.status !== 'delivered') throw new AppError(`order is ${o.status}, only delivered orders can be refunded`, 'NOT_REFUNDABLE');
        const paid = (await tx.query<{ paid: number }>('select coalesce(sum(amount),0)::float8 as paid from refunds where order_id = $1', [a.order_id]))[0]!.paid;
        if (round(paid + a.amount, 2) > o.total) throw new AppError(`refund would exceed order total (${o.total}, already refunded ${paid})`, 'REFUND_EXCEEDS_TOTAL');
        const id = newId('rf');
        await tx.query('insert into refunds(id, order_id, amount, reason, idempotency_key, approval_id) values ($1,$2,$3,$4,$5,$6)', [id, a.order_id, a.amount, a.reason, a.idempotency_key, a.approval_id ?? null]);
        return { refund_id: id, amount: a.amount, duplicate: false };
      });
    },
  }),

  send_reply: def({
    description: 'Send a reply to the customer. Requires a human approval token. The recipient is always the sender of the original message.',
    schema: z.object({ message_id: z.string(), subject: z.string().max(200).default('Re: your message'), body: z.string().min(1).max(6000), idempotency_key: idemKey, approval_id: z.string().optional() }),
    idempotent: false,
    async handler({ db }, a) {
      const [m] = await db.query<{ customer_email: string }>('select customer_email from messages where id = $1', [a.message_id]);
      if (!m) throw new AppError('message not found', 'MESSAGE_NOT_FOUND');
      const r = await getChannel().send(db, { messageId: a.message_id, to: m.customer_email, subject: a.subject, body: a.body, idempotencyKey: a.idempotency_key, approvalId: a.approval_id });
      return { outbox_id: r.outboxId, duplicate: r.duplicate, channel: getChannel().name };
    },
  }),

  delete_ticket: def({
    description: 'Destructive: permanently delete a ticket. Admin only, never exposed to the agent.',
    schema: z.object({ ticket_id: z.string() }),
    idempotent: false,
    async handler({ db }, a) {
      const rows = await db.query('delete from tickets where id = $1 returning id', [a.ticket_id]);
      return { deleted: rows.length };
    },
  }),
};
