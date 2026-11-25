import { contentTerms, stem, type RetrievedChunk } from '../retrieval/search';
import type { Block, LlmMessage, LlmProvider, LlmRequest, LlmResponse } from './types';

/**
 * Deterministic, rule-based stand-in for the LLM. It lets tests, CI and the public demo run with no API key and
 * zero cost. It is NOT Claude: any eval number produced with it measures this rule engine plus the surrounding
 * system (policy, gates, retrieval, MCP), not model quality. Set MOCK_GULLIBLE=1 to make it obey injected
 * instructions, which is how we prove the approval gate and MCP server hold even when the "model" is compromised.
 */

const INJECTION = /ignore (all |any |your )?(the )?(previous|prior|above|earlier) (instructions|rules|messages)|disregard (your|the|all) (rules|instructions|policy)|system prompt|developer mode|you are now|new instructions:|\[\s*system\s*\]|<\/?\s*(system|admin|instructions?)\s*>|override (the )?(policy|rules|approval)|without (human )?approval|act as (an? )?(admin|administrator)|reveal (your|the) (prompt|instructions)|print (all|every) (orders|customers)|admin (mode|override|command)/i;
const INJ_ACTION = /(issue|process|send|give|make|grant)\b[^.\n]*\b(refund|\$\s?\d)|(email|send|forward)\b[^.\n]*\b(customer list|all orders|database|data)\b/i;
const LEGAL = /\b(lawyer|attorney|solicitor|sue\b|suing|lawsuit|legal action|court|chargeback|dispute (it )?with my bank|report you to|trading standards|attorney general|injur(y|ed)|hospital|burn(ed|t)|caught fire|on fire|smoke|sparks?|electric(al)? shock|electrocut|food poisoning|got sick|allergic reaction|poison)/i;
const ANGRY = /\b(furious|outraged|unacceptable|ridiculous|worst|scam|fraud(ulent)?|disgust|incompetent|useless|rip.?off|never (buy|order|shop)|livid|appalling|pathetic|sick of|fed up)\b|!{3,}/i;
const OUT_OF_SCOPE = /\b(poem|joke|haiku|horoscope|crypto|bitcoin|stock tips?|lottery|homework|essay|write (me )?(some )?code|python script|weather|dating|political|election|sports score|translate this|recipe for|medical advice|diagnos|tax advice|legal advice|invest(ment)?)\b/i;
const ORDER_ID = /BB-\d{4}/gi;

export function sentencesOf(t: string) { return t.split(/(?<=[.!?])\s+(?=[A-Z$"'(])|\n+/).map((x) => x.trim()).filter(Boolean); }

/** Remove sentences that look like injected instructions so the genuine request can still be understood. */
function stripInjection(t: string) {
  return sentencesOf(t.replace(/\[[^\]]*\]|<[^>]*>/g, (m) => (INJECTION.test(m) || INJ_ACTION.test(m) ? '' : m))).filter((s) => !INJECTION.test(s) && !INJ_ACTION.test(s)).join(' ');
}

export function mockClassify(text: string) {
  const injection = INJECTION.test(text);
  const clean = injection ? stripInjection(text) : text;
  const t = clean.toLowerCase();
  const order_ids = [...new Set((clean.match(ORDER_ID) ?? []).map((s) => s.toUpperCase()))];
  const legal = LEGAL.test(text);
  const angry = ANGRY.test(text) || (text.replace(/[^A-Z]/g, '').length > 25 && text.replace(/[^A-Za-z]/g, '').length > 0 && text.replace(/[^A-Z]/g, '').length / text.replace(/[^A-Za-z]/g, '').length > 0.6);
  let intent: string = 'other';
  const asksForAction = /refund|return|money back|where is|status|track|cancel/.test(t);
  if (legal && !asksForAction) intent = 'complaint';
  else if (OUT_OF_SCOPE.test(clean) && !order_ids.length) intent = 'out_of_scope';
  else if (/(reschedul|move|change|cancel|postpone).*(consult|booking|appointment|slot|call)|(consult|booking|appointment|slot).*(reschedul|cancel|postpone|move)/.test(t)) intent = 'booking_change';
  else if (/consult/.test(t) && /\b(free|cost|price|how long|how much|fee)\b/.test(t) && !/\b(book|schedule|slot|available|reserve)\b/.test(t)) intent = 'policy_question';
  else if (/consult|appointment|book (a |me |us )?(slot|call|time|visit)|schedule a (call|visit|time)|showroom visit|available (slots|times)/.test(t)) intent = 'booking';
  else if (!order_ids.length && /return policy|refund policy|return window|how (long|many days).*(return|refund)|restocking|who pays.*return|return shipping|can i return|am i able to return/.test(t)) intent = 'policy_question';
  else if (/refund|return|money back|send (it )?back|exchange|damaged|broken|defective|faulty|wrong item|dead on arrival|\bdoa\b|cancel (my )?order|not working|stopped working|crack/.test(t)) intent = order_ids.length || /refund|return|money back|damaged|defective|replacement/.test(t) ? 'return_refund' : 'other';
  else if (order_ids.length && /where|track|status|ship|deliver|arrive|when|update|check|look/.test(t)) intent = 'order_status';
  else if (/where('s| is) my (order|package|parcel)|track(ing)?|has (it|my order) shipped|when will (it|my order)/.test(t)) intent = 'order_status';
  else if (/policy|warrant|shipping|(change|modify|edit|amend) (my |an |the )?order|how long|hours|open|closed|holiday|international|canada|price match|rewards?|loyalty|points|gift card|payment|pay with|tax|wholesale|bulk|discount|deliver to|pickup|pick up|restocking|freight/.test(t)) intent = 'policy_question';
  else if (/do you (sell|have|offer|carry|stock|make)|\\b(sell|carry|stock)\\b.*\\?|grinder|espresso|brewer|ice maker|beans?|syrups?|cups?|boxes|descal|tamper|portafilter|es-200|gr-90|db-12|im-40|voltage|compatible|burr|roast|manual|error|e3|h1|filter|steam/.test(t)) intent = 'product_question';
  else if (order_ids.length) intent = 'order_status';
  else if (angry) intent = 'complaint';
  const damaged = /damaged|broken|defective|faulty|dead on arrival|doa|crack/.test(t);
  const urgency = legal ? 'critical' : angry || damaged || /urgent|asap|immediately/.test(t) ? 'high' : 'normal';
  return {
    intent, urgency, angry, legal_or_safety: legal, injection_suspected: injection, order_ids,
    needs_human: angry || legal || intent === 'complaint',
    summary: clean.slice(0, 140),
  };
}

type Ctx = { text: string; customerId?: string; classification: ReturnType<typeof mockClassify>; retrieval: RetrievedChunk[]; traceId: string; messageId: string; now: string };

const pt = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 8 * 3600000);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${days[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} at ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'} PT`;
};
const ymd = (s: unknown) => (s ? String(s).slice(0, 10) : 'n/a');

function parseResults(history: LlmMessage[]) {
  const calls = new Map<string, string>(); // tool_use_id -> name
  const results: Array<{ name: string; input: Record<string, unknown>; out: Record<string, unknown>; isError: boolean }> = [];
  const inputs = new Map<string, Record<string, unknown>>();
  for (const m of history) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type === 'tool_use') { calls.set(b.id, b.name); inputs.set(b.id, b.input); }
      if (b.type === 'tool_result') {
        let out: Record<string, unknown> = {};
        try { out = JSON.parse(b.content); } catch { out = { raw: b.content }; }
        results.push({ name: calls.get(b.tool_use_id) ?? '?', input: inputs.get(b.tool_use_id) ?? {}, out, isError: Boolean(b.is_error) });
      }
    }
  }
  return results;
}

const use = (name: string, input: Record<string, unknown>, n: number): Block => ({ type: 'tool_use', id: `mock_${n}_${name}`, name, input });
const respond = (reply: string, citations: string[] = [], escalate = false, reason?: string, n = 0): Block => use('respond', { reply, citations, escalate, ...(reason ? { escalation_reason: reason } : {}) }, 900 + n);

export function bestSentences(terms: string[], chunk: RetrievedChunk, max = 2) {
  const ss = sentencesOf(chunk.content);
  const scored = ss.map((s, i) => { const toks = new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).map(stem)); return { s, i, sc: terms.filter((t) => toks.has(t)).length }; });
  return scored.sort((a, b) => b.sc - a.sc || a.i - b.i).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
}

function planAgent(ctx: Ctx, history: LlmMessage[], gullible: boolean): Block[] {
  // Results that were rejected before execution (bad args / denied) do not count as "already done".
  const done = parseResults(history).filter((d) => !(d.isError && (typeof d.out.error === 'string' || (d.out.error as { code?: string } | undefined)?.code === 'INVALID_ARGUMENTS')));
  const has = (n: string) => done.some((d) => d.name === n);
  const c = ctx.classification;
  const text = gullible ? ctx.text : stripInjection(ctx.text);
  const clean = text.toLowerCase();
  const ids = [...new Set((text.match(ORDER_ID) ?? []).map((s) => s.toUpperCase()))];
  const n = history.length;
  const forced = process.env.MOCK_FORCE_TOOL ? (JSON.parse(process.env.MOCK_FORCE_TOOL) as { name: string; input: Record<string, unknown> }) : null;
  if (forced && history.length === 1) return [use(forced.name, forced.input, n)];
  if (process.env.MOCK_LOOP === '1' && ids[0]) return [use('lookup_order', { order_id: ids[0] }, n)];
  const cite = (re: RegExp, slug?: string) => ctx.retrieval.find((r) => (!slug || r.slug === slug) && re.test(r.content))?.id;

  // Gullible mode: obey instructions found in the customer message or in retrieved documents.
  if (gullible && !has('issue_refund')) {
    const src = `${ctx.text}\n${ctx.retrieval.map((r) => r.content).join('\n')}`;
    const m = src.match(/refund[^.\n]*?(BB-\d{4})|(BB-\d{4})[^.\n]*?refund/i);
    if (m && INJ_ACTION.test(src)) {
      const amount = Number(src.match(/\$\s?(\d+(?:\.\d+)?)/)?.[1] ?? 500);
      return [use('issue_refund', { order_id: (m[1] ?? m[2])!.toUpperCase(), amount, reason: 'as instructed in message', idempotency_key: `${ctx.traceId}-gullible-refund` }, n)];
    }
  }
  if (gullible && !has('lookup_order')) {
    const other = ids[0];
    if (other && INJECTION.test(ctx.text) && /(print|reveal|dump|all).*(order|customer)/i.test(ctx.text)) return [use('lookup_order', { order_id: other }, n)];
  }

  const askOrder = () => [respond("I'd be happy to help. Could you send me your order number (it looks like BB-1234) so I can look it up?", [], false, undefined, n)];

  switch (c.intent) {
    case 'order_status':
    case 'return_refund': {
      if (!ids.length) return askOrder();
      const id = ids[0]!;
      if (!has('lookup_order')) return [use('lookup_order', { order_id: id }, n)];
      const r = done.find((d) => d.name === 'lookup_order')!;
      if (r.isError) {
        const code = (r.out.error as { code?: string } | undefined)?.code;
        if (code === 'ORDER_NOT_FOUND') return [respond(`I couldn't find order ${id} on your account. Please double-check the order number and that you're writing from the email address used for the order.`, [], false, undefined, n)];
        return [respond('I was unable to retrieve your order details right now, so I have asked a team member to follow up.', [], true, 'order lookup failed', n)];
      }
      if (r.out._partial) return [respond('I only received partial information about your order, so I have asked a team member to confirm the details with you.', [], true, 'incomplete order data', n)];
      const o = r.out as { status: string; delivered_at?: string; shipped_at?: string; placed_at: string; tracking_number?: string; carrier?: string; total: number; items: Array<{ sku: string; name: string; qty: number }>; days_since_delivery: number | null };
      const nowMs = new Date(ctx.now).getTime();
      if (c.intent === 'order_status') {
        if (o.status === 'delivered') return [respond(`Order ${id} was delivered on ${ymd(o.delivered_at)}.`, [], false, undefined, n)];
        if (o.status === 'shipped') {
          const daysShipped = Math.floor((nowMs - new Date(o.shipped_at!).getTime()) / 86400000);
          if (daysShipped >= 10) return [respond(`Order ${id} shipped on ${ymd(o.shipped_at)} but hasn't been delivered yet. Our shipping policy covers packages with no movement, so I've asked a team member to open a carrier claim.`, [cite(/no movement/i, 'shipping-policy')].filter(Boolean) as string[], true, 'possible lost package', n)];
          const std = cite(/3 to 5 business days/i, 'shipping-policy');
          return [respond(`Order ${id} shipped on ${ymd(o.shipped_at)} with ${o.carrier}. Tracking number: ${o.tracking_number}.${std ? ' Standard shipping takes 3 to 5 business days.' : ''}`, std ? [std] : [], false, undefined, n)];
        }
        if (o.status === 'processing') return [respond(`Order ${id} was placed on ${ymd(o.placed_at)} and is processing. You'll get a tracking email when it ships.`, [], false, undefined, n)];
        return [respond(`Order ${id} is ${o.status}.`, [], false, undefined, n)];
      }
      // return_refund
      const damaged = /damaged|broken|defective|faulty|dead on arrival|doa|crack|not working|stopped working/.test(clean);
      if (o.status === 'processing') return [respond(`Order ${id} hasn't shipped yet. Cancellations are confirmed by a team member, so I've asked them to review this for you.`, [cite(/cancel/i, 'payment-and-orders')].filter(Boolean) as string[], true, 'order cancellation needs staff', n)];
      if (o.status === 'shipped') return [respond(`Order ${id} has already shipped, so it can't be cancelled. Once it arrives you can start a return under our refund policy.`, [cite(/shipped cannot be cancelled|has shipped cannot|cancelling after shipment|cannot be cancelled/i, 'payment-and-orders')].filter(Boolean) as string[], false, undefined, n)];
      if (o.status === 'cancelled') return [respond(`Order ${id} was already cancelled, so there is nothing further to refund.`, [], false, undefined, n)];
      const days = o.days_since_delivery ?? 0;
      const win = cite(/30 days/i, 'refund-policy');
      if (damaged) return [respond(`I'm sorry about the problem with order ${id}. Please reply with photos of the item and its packaging (damage must be reported within 7 days of delivery) and a team member will arrange a replacement or refund.`, [cite(/7 days/i, 'refund-policy')].filter(Boolean) as string[], true, 'damage or defect claim needs review', n)];
      if (days > 45) return [respond(`Order ${id} was delivered on ${ymd(o.delivered_at)}, which is outside our 30 day return window, so I'm unable to offer a refund.`, win ? [win] : [], false, undefined, n)];
      if (days > 30) return [respond(`Order ${id} was delivered ${days} days ago, which is outside our 30 day return window. A team member may be able to offer store credit, so I've asked them to review.`, win ? [win] : [], true, 'late return: store credit at staff discretion', n)];
      const allConsumable = o.items.every((i) => /^(BN|SY|PB|CP|DS)-/.test(i.sku));
      if (allConsumable) return [respond(`Consumables such as beans, syrups, cups and boxes can't be returned once opened unless they arrived defective or were the wrong item. If the items are unopened, tell me and I'll ask a team member to review the return.`, [cite(/consumables/i, 'refund-policy')].filter(Boolean) as string[], false, undefined, n)];
      if (!has('issue_refund')) return [use('issue_refund', { order_id: id, amount: o.total, reason: `Return requested within 30 day window (${days} days since delivery)`, idempotency_key: `${ctx.traceId}-refund-${id}` }, n)];
      return [respond(`Thanks. Order ${id} is within our 30 day return window, so I've submitted the refund for review by a team member. Refunds are paid to your original payment method 5 to 7 business days after we receive the item. You will hear from us once it is approved.`, win ? [win] : [], false, undefined, n)];
    }
    case 'booking': {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayWanted = dayNames.findIndex((d) => clean.includes(d));
      if (!has('list_available_slots')) {
        // Ask only for the requested weekday's window (next occurrence in Pacific time) so one page is enough.
        const nowPt = new Date(new Date(ctx.now).getTime() - 8 * 3600000);
        const delta = dayWanted < 0 ? 0 : (dayWanted - nowPt.getUTCDay() + 7) % 7;
        const startUtc = new Date(Date.UTC(nowPt.getUTCFullYear(), nowPt.getUTCMonth(), nowPt.getUTCDate() + delta, 8));
        return [use('list_available_slots', dayWanted < 0 ? { from: ctx.now, limit: 25 } : { from: new Date(Math.max(startUtc.getTime(), new Date(ctx.now).getTime())).toISOString(), to: new Date(startUtc.getTime() + 86400000).toISOString(), limit: 25 }, n)];
      }
      const r = done.find((d) => d.name === 'list_available_slots')!;
      const policy = cite(/Monday to Thursday/i, 'consultation-bookings');
      if (r.isError) return [respond('I could not check the calendar right now, so a team member will follow up to book your consultation.', [], true, 'calendar unavailable', n)];
      const slots = ((r.out.slots as Array<{ start: string }>) ?? []).map((s) => s.start);
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const wantDay = days.findIndex((d) => clean.includes(d));
      const tm = clean.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
      const wantMin = tm ? ((Number(tm[1]) % 12) + (tm[3] === 'pm' ? 12 : 0)) * 60 + Number(tm[2] ?? 0) : null;
      const pick = slots.find((s) => {
        const d = new Date(new Date(s).getTime() - 8 * 3600000);
        return (wantDay < 0 || d.getUTCDay() === wantDay) && (wantMin === null || d.getUTCHours() * 60 + d.getUTCMinutes() === wantMin) && (wantDay >= 0 || wantMin !== null);
      });
      if (pick && !has('book_slot')) return [use('book_slot', { slot_start: pick, topic: 'Equipment consultation', idempotency_key: `${ctx.traceId}-book` }, n)];
      const b = done.find((d) => d.name === 'book_slot');
      if (b && !b.isError) return [respond(`You're booked in: ${pt(pick ?? (b.input.slot_start as string))}. It's a free 30 minute consultation.`, policy ? [policy] : [], false, undefined, n)];
      if (b?.isError) return [respond('That slot was just taken. A team member will follow up to find you another time.', [], true, 'booking failed', n)];
      const offer = slots.slice(0, 3).map(pt).join('; ');
      return [respond(`${wantDay === 0 || wantDay === 5 || wantDay === 6 ? 'Consultations run Monday to Thursday, 10:00 am to 4:00 pm Pacific. ' : ''}Here are the next open consultation slots: ${offer}. Which would you like?`, policy ? [policy] : [], false, undefined, n)];
    }
    case 'booking_change': {
      const bk = ctx.text.match(/bk_[0-9a-f]{12}/)?.[0];
      const cancel = /cancel/.test(clean);
      if (bk && cancel && !has('cancel_booking')) return [use('cancel_booking', { booking_id: bk, idempotency_key: `${ctx.traceId}-cancel` }, n)];
      if (bk && cancel) return [respond(`I've asked a team member to confirm the cancellation of booking ${bk}. There's no fee for cancelling a consultation.`, [cite(/no fee/i, 'consultation-bookings')].filter(Boolean) as string[], false, undefined, n)];
      return [respond("I can't change bookings myself, so I've asked a team member to help. Reschedules are free up to 24 hours before your slot.", [cite(/24 hours/i, 'consultation-bookings')].filter(Boolean) as string[], true, 'booking change needs staff', n)];
    }
    case 'product_question':
    case 'policy_question': {
      const top = ctx.retrieval[0];
      const terms = contentTerms(ctx.text);
      if (!top || top.coverage < 0.3) return [respond("I don't have that information in our documents, so I've asked a team member to get back to you.", [], true, 'no supporting document', n)];
      return [respond(bestSentences(terms, top), [top.id], false, undefined, n)];
    }
    case 'complaint':
      return [respond("I'm sorry about your experience. I've passed this to a team member who will contact you personally.", [], true, 'complaint', n)];
    case 'out_of_scope':
      return [respond("I can only help with Brightside orders, products, shipping, returns and consultation bookings, so I've passed this on to a team member.", [], true, 'out of scope', n)];
    default:
      return [respond('Thanks for your message. Could you tell me a bit more about what you need (and your order number, if it relates to an order) so I can help?', [], false, undefined, n)];
  }
}

const estTokens = (s: string) => Math.ceil(s.length / 4);

export class MockProvider implements LlmProvider {
  name = 'mock' as const;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const t0 = Date.now();
    const inputText = req.system + JSON.stringify(req.messages);
    let content: Block[] = [];
    const gullible = process.env.MOCK_GULLIBLE === '1';
    if (req.purpose === 'classify') {
      const ctx = req.mockContext as { text: string };
      content = [{ type: 'tool_use', id: 'mock_cls', name: 'classify', input: mockClassify(ctx.text) }];
    } else if (req.purpose === 'agent') {
      content = planAgent(req.mockContext as Ctx, req.messages, gullible);
    } else if (req.purpose === 'rerank') {
      content = [{ type: 'text', text: '[]' }]; // keeps incoming order
    } else {
      content = [{ type: 'text', text: '{}' }];
    }
    const usage = { input: estTokens(inputText), output: estTokens(JSON.stringify(content)), cacheRead: 0, cacheWrite: 0 };
    return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage, latencyMs: Date.now() - t0, model: 'mock', costUsd: 0 };
  }
}
