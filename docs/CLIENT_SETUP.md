# Onboarding a real business: checklist

## 1. Scope and risk (day 1)
- [ ] Agree what the agent may do alone (answer from documents, look up orders, draft, create tickets, book consultations) and what always needs a person (refunds, outbound messages, cancellations).
- [ ] Set `APPROVAL_VALUE_THRESHOLD` and decide who approves what (single approver, or a manager above a value).
- [ ] Decide the escalation owner and response time for escalated tickets (and a Slack channel, if used).
- [ ] List what the agent must never discuss (legal, medical, price negotiation) and add those as eval cases.

## 2. Documents to ingest
- [ ] Refund/returns, shipping, warranty, hours, product FAQ, manuals, pricing/discount rules, privacy rules. Plain Markdown with `##` headings, one topic per section, facts stated plainly (numbers, windows, fees).
- [ ] Remove anything out of date or contradictory first; the agent cannot tell which version is right.
- [ ] Put files in `data/docs/`, run `pnpm ingest`, write 30+ real questions with the passage that answers each into `evals/retrieval/questions.json`, run `pnpm eval:retrieval` and pick the config on a dev split.

## 3. Systems to connect
- [ ] **Orders/customers:** replace the seed tables with a read-only view or sync from the shop platform (Shopify, WooCommerce, ERP). Keep `lookup_order` scoped to the verified customer.
- [ ] **Inbound channel:** point the email/chat provider's webhook at `/api/webhooks/inbound` (share the HMAC secret), or write an adapter.
- [ ] **Outbound channel:** implement `ChannelAdapter` for the real channel. Keep replies approval-gated at first.
- [ ] **Calendar:** dedicated Google account/calendar and OAuth client (see `docs/INTEGRATIONS.md`).
- [ ] **Identity:** decide how a sender is verified (the account email at minimum; order number + postcode for guests).
- [ ] **Bookings:** add a `list_bookings` tool (not in this demo) so reschedules and cancels do not need a booking id.

## 4. Safety checks before go-live
- [ ] Replace every dev secret (`MCP_TOKEN_SECRET`, `WEBHOOK_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD`); never set `FAULT_INJECTION`.
- [ ] Run `pnpm eval` with the real model and the client's own cases; safety must be 100%.
- [ ] Shadow mode first: the agent drafts, humans send, for 1 to 2 weeks. Compare drafts with what staff actually sent.
- [ ] Review denied calls on the audit page weekly.
- [ ] Data protection: retention policy, who can see traces (they contain customer messages), deletion process, a privacy notice that says an AI assists.

## 5. Costs to expect (estimates; verify with your own run)
- **LLM:** a request is roughly 1 classification call plus 2 to 4 agent calls of ~1 to 3k input tokens each. Run `pnpm eval` with the real key, read `cost_usd_mean`, multiply by monthly volume. Prices in `src/lib/llm/pricing.ts` are assumptions, not quotes.
- **Hosting:** Vercel (Hobby to demo; Pro for frequent cron and longer functions) plus Supabase (free tier to start).
- **Optional:** embeddings (small), Slack (free), Google Calendar API (free).
- **People time:** onboarding 2 to 4 days; weekly review of failures and new eval cases about 1 hour.

## 6. After launch
Weekly: top escalation reasons, thumbs-down reasons, denied tool calls. Turn each real failure into an eval case, fix, re-run, and record it in `evals/IMPROVEMENTS.md`.
