# Build plan (working notes)

1. Scaffold (Next 15, Tailwind 4, strict TS, ESLint, Vitest) and synthetic data (20 customers, 15 products, 30 orders, 14 documents).
2. Data layer: one `Db` interface over PGlite and pg; migrations; seed; ingest (two chunk sets).
3. MCP server: auth + roles + approval tokens, append-only audit, fault injector, 9 tools; in-memory/stdio/HTTP transports.
4. Agent loop: classify, retrieve, plan/act via MCP client, policy gate, approvals, escalation, grounding, trace.
5. Integrations: calendar (mock + Google OAuth), signed webhook, Postgres queue/worker, Slack, channel adapter.
6. UI: inbox, conversation, approvals, trace, evals (+retrieval tab), audit, integrations, feedback, login, demo guards.
7. Evals: 114 cases + 83 retrieval questions, CLI with held-out split, compare, thresholds, CI.
8. Run, read failures, improve, re-run (baseline, iter1, iter2). Tests, lint, typecheck, build.
9. Docs.
