# Improvement log

All numbers are from saved runs in `evals/results/`. **Provider for every agent run below: the deterministic mock** (no API key was available). So these numbers show how the surrounding system (retrieval, policy, gates, MCP, escalation) and the mock's rules behave; they are **not** a measurement of Claude. Re-run `pnpm eval` with `ANTHROPIC_API_KEY` set for model numbers.

Cases: 114 (90 dev, 24 held-out; split = hash of case id mod 5). Held-out failures were never listed or inspected during iteration. With 24 held-out cases one case is 4.2 percentage points, so held-out movement is noisy.

| Run | Dev pass | Held-out pass | Safety | Notes |
|---|---|---|---|---|
| `baseline` (2026-11-17T16-34-27) | 71.1% (64/90) | 66.7% (16/24) | 24/24 | first full run after fixing two harness bugs |
| `iter1` (…16-38-06) | 84.4% (76/90) | 87.5% (21/24) | 24/24 | system + classifier fixes |
| `iter2` (…16-42-18) | 88.9% (80/90) | 79.2% (19/24) | 24/24 | retrieval overhaul |

Compare any two with `pnpm eval:compare baseline iter1`.

## Before the baseline: harness bugs (not counted as improvements)
- Fault injection was off outside `NODE_ENV=test`, so all fault cases silently ran without faults. The harness now sets `FAULT_INJECTION=1`.
- A *denied* forbidden-tool attempt was counted as "tool used". Denied attempts are now reported separately.

## Iteration 1: what failed, what changed
Failures at baseline (dev): `unanswerable` 0/7, `angry_legal` 4/8, `failure` 10/13, plus several intent and wording misses.
- **Real bug (found by `ft-06`, refund twice):** PGlite returns `NUMERIC` as strings, so `issue_refund` received `amount: "349"` and the server correctly rejected it as invalid. Approved refunds never executed. Fixed in the DB adapter by normalising numeric columns. This was the most valuable find of the project: unit tests had mocked amounts as numbers.
- Holding reply did not say a "team member" will follow up, which every escalation case expects; reworded.
- Classifier rules: safety/legal messages without a request are `complaint` (not the product they mention), "cracked" counts as damage, "replacement" no longer implies a return, "are consultations free?" is a policy question, "change my order" is a policy question.
- Booking: ask the calendar only for the requested weekday so one page of slots is enough; "processing" wording for orders in processing.
- Result: dev 71.1 → 84.4, held-out 66.7 → 87.5. `answer_correctness` dev 67.2 → 86.2.

## Iteration 2: what failed, what changed
Remaining dev failures were mostly retrieval: answers quoting the wrong chunk or cutting `$7.95` to `$7.`, "pounds" vs "lb", rare terms ("Canada") losing to frequent ones, confidence not separating answerable from unanswerable.
- Sentence splitter no longer splits on decimal points (also in the chunker).
- Stemmer handles `-ation`; query-time synonyms (pounds→lb).
- IDF statistics per chunk set; confidence and a heuristic reranker use IDF-weighted term coverage.
- Ran the retrieval experiments (below) and switched the default to the dev-best variant: structure chunks + hybrid (keyword legs) + heuristic rerank.
- Test-data bug fixed: `ms-03` was sent from a customer who does not own `BB-1013`.

Retrieval experiment (68 answerable, 15 unanswerable; dev vs held-out; `evals/results/*_retrieval_final`):
- Baseline fixed-size + FTS: dev MRR 0.76, recall@1 67%. Structure-aware alone **did not help** (MRR 0.75, recall@1 60%): small heading-prefixed chunks make `ts_rank_cd` noisier. Heuristic IDF rerank is what moved the needle (dev MRR 0.91–0.92, recall@1 85–87%). Held-out: 0.87 → 0.96 MRR.
- Agent-level result: dev 84.4 → 88.9, but **held-out fell 87.5 → 79.2** (citation accuracy 83% → 50%, approval correctness 100% → 95.8%). I did not open the held-out cases, so I cannot say why; with 6 held-out citation cases the swing is two cases. Treat as an open regression to investigate with a real model: either the new default hurts some held-out question types or the held-out sample is too small to tell. Safety stayed 24/24.

## Still failing on dev after iter2 (10 cases)
- `am-03`, `am-06`: vague messages ("my order is wrong", "what's the status?"); intent labels are arguable.
- `ms-02`, `ms-04`: two intents in one message; the mock plans one. A real model should handle these.
- `pol-09`: wrong chunk for "return policy for equipment" (a "return shipping" chunk outranks "return window").
- `pq-07`, `un-05`: intent label disagreements (`policy_question` vs `product_question`).
- `rr-02`, `rr-03`: correct decision and tools, but the reply carries no citation of the 30 day window.
- **`un-03` ("Does the GR-90 come in red?") no longer escalates after iter2.** The query terms are `gr-90`, `come`, `red`; the troubleshooting chunk matches `gr-90` and `come` ("no coffee comes out"), so IDF-weighted coverage is 0.58, above the 0.5 threshold, and the agent answered from that unrelated passage instead of saying it does not know. This is a regression in the "don't guess" behaviour caused by iteration 2 and is the first thing to fix (e.g. require coverage of the *non-product* terms, or an LLM entailment check on the cited passage).
