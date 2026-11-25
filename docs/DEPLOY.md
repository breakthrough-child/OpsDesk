# Deploy to Vercel + Supabase in about 20 minutes

Status: **not deployed by me.** No `VERCEL_TOKEN` or Supabase credentials were available, so this is a checklist you can follow, not a record of something I did. The production build passes (`pnpm build`) and the server refuses to start with unsafe settings (see step 3).

You need: a GitHub account (the repo), a Vercel account, a Supabase account. Optional: an Anthropic API key (without one the public demo runs on the deterministic mock agent, which costs nothing).

## 1. Supabase (5 min)
1. New project (any region near your Vercel region). Save the database password.
2. Project Settings → Database → **Connection string** → *Transaction pooler* (port 6543). Copy it and put your password in. This is `DATABASE_URL`.
3. From your laptop, create the schema, seed the fictional shop and index the documents:
   ```bash
   export DATABASE_URL='postgresql://postgres.<ref>:<password>@<host>:6543/postgres'
   pnpm install
   pnpm db:migrate && pnpm db:seed && pnpm ingest
   ```
   Expected output: `applied: 001_init.sql, 002_rls.sql`, `seeded 20 customers, 15 products, 30 orders`, `ingested 14 documents into 116 chunks`.
4. (Optional, for Supabase Auth admin login) Authentication → Users → add an admin user; copy the project URL and the `anon` key. Skip this to use `ADMIN_PASSWORD` instead.

## 2. Secrets (2 min)
Generate four values and keep them somewhere safe:
```bash
openssl rand -hex 24   # MCP_TOKEN_SECRET
openssl rand -hex 24   # WEBHOOK_SECRET
openssl rand -hex 24   # ENCRYPTION_KEY
openssl rand -base64 24 # ADMIN_PASSWORD (at least 12 characters)
```

## 3. Vercel (10 min)
1. Vercel → Add New → Project → import the GitHub repo. Framework: Next.js (auto-detected). Build command and output are the defaults.
2. Environment variables (Production):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | from step 1 |
   | `MCP_TOKEN_SECRET`, `WEBHOOK_SECRET`, `ENCRYPTION_KEY` | from step 2 (not the dev defaults) |
   | `ADMIN_PASSWORD` | from step 2 (see the note below) |
   | `DEMO_MODE` | `1` (visitors are read-only except the simulate box) |
   | `DEMO_RATE_LIMIT_PER_HOUR` | `20` |
   | `DEMO_DAILY_COST_CAP_USD` | `0.25` (small; raise only if you want) |
   | `DEMO_DAILY_REQUEST_CAP` | `200` |
   | `CRON_SECRET` | any random string (lets the daily cron call `/api/worker/tick`) |
   | `ANTHROPIC_API_KEY` | optional. Leave unset to run on the mock agent. |
   | `AGENT_MODEL`, `CLASSIFIER_MODEL` | if you set a key and want it cheap: `claude-haiku-5-5` for both |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | optional, only for Supabase Auth login |

   **Startup guard:** in production the app refuses to start if `ADMIN_PASSWORD` is missing, is `admin`, or is weak (under 12 characters / fewer than 6 distinct), if `MCP_TOKEN_SECRET`, `WEBHOOK_SECRET` or `ENCRYPTION_KEY` are missing or still the development defaults, or if `FAULT_INJECTION` / `MOCK_GULLIBLE` are on. If the deployment fails at startup, open the function logs: the message starts with `Refusing to start in production` and lists what to fix.
3. Deploy. Then check:
   ```bash
   curl https://<your-app>.vercel.app/api/health
   # {"ok":true,"provider":"mock","documents":14,"demo":true}
   ```
4. Open the site, click *Admin sign in*, use `ADMIN_PASSWORD`, open *Approvals*. Use the simulate box on the Inbox page; open the trace.

## 4. Cost safety for the public demo
Keep `DEMO_MODE=1` and the caps above. The simulate endpoint is rate limited per IP and refuses once the day's recorded LLM spend or request count reaches the cap. With no API key there is no spend at all. Do not put your main API key on a public demo unless the balance is small and capped.

## 5. Optional integrations
- **Inbound email/chat webhook:** `POST https://<app>/api/webhooks/inbound`, signed with `WEBHOOK_SECRET` (see `docs/INTEGRATIONS.md`).
- **Google Calendar:** create an OAuth client, redirect URI `https://<app>/api/oauth/google/callback`, set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`, then *Integrations → Authorise*.
- **Slack:** set `SLACK_WEBHOOK_URL`.
- **Cron:** `vercel.json` registers a daily `/api/worker/tick` fallback (Hobby allows daily crons; webhook jobs are normally processed right after the response).

## 6. CLI alternative
```bash
npm i -g vercel
vercel login && vercel link
vercel env add DATABASE_URL production      # repeat for each variable above
vercel --prod
```

## Troubleshooting
- *500 on every page, log says `Refusing to start in production`*: fix the listed setting and redeploy.
- *`/api/health` shows `documents: 0`*: you skipped `pnpm ingest` on the production `DATABASE_URL` (the app also auto-seeds an empty database on first request; if it cannot, run the three commands from step 1).
- *Function timeout on simulate with a real model*: `maxDuration` is 60 s; use Haiku, or lower `MAX_AGENT_STEPS`.
- *Without `DATABASE_URL`* a serverless deploy falls back to an in-memory database that resets on every cold start. Fine for a throwaway look, not for a demo with approvals.
