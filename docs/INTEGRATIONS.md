# Integrations

Each integration has a **mock mode** that runs with no credentials, behind the same interface. The Integrations page (`/integrations`) shows mode, last success and last error for each. Only the mock modes were exercised in development; live modes are implemented but untested against the real services.

## Google Calendar (OAuth 2.0)
- Used by `list_available_slots` and `book_slot` (MCP tools). Interface: `CalendarProvider` in `src/lib/integrations/calendar.ts`.
- **Setup:** create a *dedicated test Google account* and a Google Cloud project; enable the Calendar API; create an OAuth client (Web). Redirect URI `http://localhost:3000/api/oauth/google/callback` (and your deployed URL). Scope: `https://www.googleapis.com/auth/calendar.events` only. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optionally `GOOGLE_CALENDAR_ID`. Sign in as admin, open Integrations, click *Authorise Google Calendar*.
- **Flow:** authorization-code with `access_type=offline`; the refresh token is stored AES-256-GCM encrypted (`ENCRYPTION_KEY`) in `oauth_tokens`; access tokens are minted per call.
- **Pagination:** `events.list` is followed through every `nextPageToken`; slots are paginated to the agent with `next_cursor`.
- **Failure:** 429/5xx are retried with exponential backoff (3 retries); a still-failing call returns a typed retryable error, the agent's circuit breaker may open, and the request escalates to a human with an honest reply. Not authorised yet: falls back to the mock calendar and says so on the page. Event ids are derived from the idempotency key so a retried insert is a no-op.

## Signed inbound webhook
- `POST /api/webhooks/inbound`, header `X-OpsDesk-Signature: t=<unix>,v1=<hex hmac_sha256(WEBHOOK_SECRET, "<t>.<raw body>")>`.
- Body: `{ "id": "evt-1", "email": "...", "subject": "...", "body": "..." }`. `id` (or an `Idempotency-Key` header) makes redelivery a no-op (`200 {duplicate:true}`).
- Rejects: missing/bad signature (401), timestamp outside +-300 s (401, replay), invalid payload (400), over 60 req/min per IP (429 + `Retry-After`).
- Returns 202 immediately; the job is enqueued and processed after the response (`after()`), with `/api/worker/tick` (Vercel Cron or admin) as fallback.
- **Failure:** a failed job is retried with exponential backoff (2 s base, doubling, 5 attempts) then moved to `dead_letters` (count shown on the Integrations page).

```bash
BODY='{"id":"evt-1","email":"priya.raman@example.com","body":"Where is BB-1003?"}'; T=$(date +%s)
SIG="t=$T,v1=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')"
curl -X POST localhost:3000/api/webhooks/inbound -H "x-opsdesk-signature: $SIG" -d "$BODY"
```
(I ran exactly this flow locally with the dev secret: accepted, duplicate returned `duplicate:true`, a bad signature and a 1000 s old timestamp were both rejected with 401.)

## Queue and worker
Postgres table `queue_jobs` claimed with `FOR UPDATE SKIP LOCKED`; stale `running` jobs (crashed worker) are re-queued after 5 minutes. Run `pnpm worker` for a loop, or call `/api/worker/tick`.

## Slack (optional)
`SLACK_WEBHOOK_URL` (an Incoming Webhook). Posts when a message is escalated or an approval is waiting. Spaced to ~1 msg/s, honours `Retry-After` on 429, retries 5xx, and never fails the agent if Slack is down (the failure is recorded on the Integrations page).

## Outbound channel (simulated)
`send_reply` writes to the `outbox` table; nothing is sent. To go live implement `ChannelAdapter` (`src/lib/integrations/channel.ts`):
```ts
export interface ChannelAdapter { name: string; send(db: Db, msg: OutboundMessage): Promise<{ outboxId: string; duplicate: boolean }> }
```
Use the idempotency key as the provider's dedup key, record the provider message id, and register the adapter in `getChannel()`. Because replies are always approval-gated and the recipient is always the original sender, a real adapter inherits those protections.

## MCP server (use it from Claude Desktop / Claude Code)
The same business tools, over stdio or Streamable HTTP. Mint a token (roles: viewer, agent, operator, admin):
```bash
export OPSDESK_TOKEN=$(pnpm -s token --role viewer --sub me)
```
Claude Code: `claude mcp add opsdesk --env OPSDESK_TOKEN=$OPSDESK_TOKEN -- pnpm --dir /path/to/OpsDesk mcp`

Claude Desktop (`claude_desktop_config.json`):
```json
{ "mcpServers": { "opsdesk": { "command": "pnpm", "args": ["--dir", "/path/to/OpsDesk", "mcp"], "env": { "OPSDESK_TOKEN": "<token>" } } } }
```
HTTP: `pnpm mcp:http`, then send `Authorization: Bearer <token>` to `http://localhost:3333/mcp`. A `viewer` token only sees `lookup_order` and `list_available_slots`. `issue_refund`, `send_reply` and `cancel_booking` additionally need a signed approval token and cannot be used by `agent` or `viewer` at all. (Stdio/HTTP entry points are implemented but I did not connect Claude Desktop in this environment; the in-memory transport is what the tests exercise.)
