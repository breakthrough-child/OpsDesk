-- Row Level Security. The app server uses the service role (bypasses RLS). Browser/anon roles get nothing
-- by default, authenticated admins may read operational tables. On plain Postgres/PGlite without these roles this is a no-op.
do $$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach t in array array['customers','products','orders','documents','chunks','messages','traces','trace_steps','approvals','tickets','bookings','refunds','outbox','drafts','audit_log','queue_jobs','dead_letters','webhook_events','rate_limits','feedback','eval_runs','integration_status','oauth_tokens','cost_ledger']
    loop
      execute format('alter table %I enable row level security', t);
    end loop;
    foreach t in array array['messages','traces','trace_steps','approvals','tickets','bookings','refunds','outbox','audit_log','feedback','eval_runs','integration_status']
    loop
      execute format('create policy %I on %I for select to authenticated using (true)', t || '_admin_read', t);
    end loop;
    -- oauth_tokens, rate_limits, webhook_events, queue tables: no policy = service role only.
  end if;
end $$;
