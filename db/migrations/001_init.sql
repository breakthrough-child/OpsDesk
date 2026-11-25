-- OpsDesk core schema. Works on Postgres 14+ (Supabase) and PGlite.

create table customers (
  id text primary key,
  name text not null,
  email text not null unique
);

create table products (
  sku text primary key,
  name text not null,
  price numeric not null,
  category text not null,
  freight boolean not null default false
);

create table orders (
  id text primary key,
  customer_id text not null references customers(id),
  status text not null,
  placed_at timestamptz not null,
  shipped_at timestamptz,
  delivered_at timestamptz,
  items jsonb not null,
  total numeric not null,
  shipping_method text not null,
  carrier text,
  tracking_number text
);
create index orders_customer_idx on orders(customer_id);

create table documents (
  id text primary key,
  slug text not null unique,
  title text not null,
  content text not null
);

create table chunks (
  id text primary key,
  doc_id text not null references documents(id) on delete cascade,
  chunk_set text not null,
  ord int not null,
  heading text,
  content text not null,
  embedding jsonb,
  tsv tsvector generated always as (to_tsvector('english', coalesce(heading, '') || ' ' || content)) stored,
  tsv_heading tsvector generated always as (to_tsvector('english', coalesce(heading, ''))) stored
);
create index chunks_tsv_idx on chunks using gin (tsv);
create index chunks_set_idx on chunks(chunk_set);

create table messages (
  id text primary key,
  channel text not null default 'email',
  customer_email text not null,
  customer_id text references customers(id),
  subject text not null default '',
  body text not null,
  status text not null default 'new',
  received_at timestamptz not null default now(),
  external_id text,
  trace_id text,
  intent text,
  urgency text,
  reply_text text,
  citations jsonb,
  escalation_reason text,
  actions jsonb not null default '[]'::jsonb
);
create index messages_status_idx on messages(status);

create table traces (
  id text primary key,
  message_id text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running',
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric not null default 0,
  latency_ms int not null default 0,
  summary jsonb not null default '{}'::jsonb
);

create table trace_steps (
  id text primary key,
  trace_id text not null references traces(id) on delete cascade,
  seq int not null,
  kind text not null,
  name text not null,
  started_at timestamptz not null default now(),
  latency_ms int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric not null default 0,
  data jsonb not null default '{}'::jsonb
);
create index trace_steps_trace_idx on trace_steps(trace_id, seq);

create table approvals (
  id text primary key,
  message_id text,
  trace_id text,
  customer_id text,
  tool text not null,
  args jsonb not null,
  edited_args jsonb,
  reasoning text,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  idempotency_key text not null unique,
  decided_by text,
  decided_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create table tickets (
  id text primary key,
  customer_id text,
  message_id text,
  subject text not null,
  body text not null,
  priority text not null default 'normal',
  needs_human boolean not null default false,
  status text not null default 'open',
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table bookings (
  id text primary key,
  customer_id text,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  status text not null default 'booked',
  topic text,
  external_event_id text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table refunds (
  id text primary key,
  order_id text not null,
  amount numeric not null,
  reason text,
  status text not null default 'issued',
  idempotency_key text not null unique,
  approval_id text,
  created_at timestamptz not null default now()
);

create table outbox (
  id text primary key,
  message_id text,
  to_email text not null,
  subject text,
  body text not null,
  channel text not null default 'email',
  status text not null default 'simulated_sent',
  idempotency_key text not null unique,
  approval_id text,
  created_at timestamptz not null default now()
);

create table drafts (
  id text primary key,
  message_id text,
  body text not null,
  citations jsonb,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  actor text not null,
  role text not null,
  tool text not null,
  args jsonb,
  status text not null,
  error text,
  latency_ms int,
  trace_id text
);
create or replace function audit_log_immutable() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;
create trigger audit_log_no_update before update on audit_log for each row execute function audit_log_immutable();
create trigger audit_log_no_delete before delete on audit_log for each row execute function audit_log_immutable();

create table queue_jobs (
  id text primary key,
  kind text not null,
  payload jsonb not null,
  status text not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index queue_jobs_ready_idx on queue_jobs(status, run_at);

create table dead_letters (
  id text primary key,
  job_id text not null,
  kind text not null,
  payload jsonb not null,
  error text,
  attempts int not null,
  failed_at timestamptz not null default now()
);

create table webhook_events (
  idempotency_key text primary key,
  received_at timestamptz not null default now(),
  message_id text
);

create table rate_limits (
  key text not null,
  window_start bigint not null,
  count int not null default 0,
  primary key (key, window_start)
);

create table feedback (
  id text primary key,
  trace_id text,
  message_id text,
  approval_id text,
  target text not null,
  rating text not null,
  reason text,
  note text,
  created_at timestamptz not null default now()
);

create table eval_runs (
  id text primary key,
  kind text not null,
  provider text not null,
  created_at timestamptz not null default now(),
  summary jsonb not null,
  path text
);

create table integration_status (
  name text primary key,
  mode text not null,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table oauth_tokens (
  provider text primary key,
  encrypted text not null,
  updated_at timestamptz not null default now()
);

create table cost_ledger (
  day date not null,
  scope text not null,
  cost_usd numeric not null default 0,
  requests int not null default 0,
  primary key (day, scope)
);
