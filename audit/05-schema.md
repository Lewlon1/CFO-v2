# Phase 5 — Schema Audit (cross-reference detail)

## Table inventory

37 tables in `public` schema on project `iccelmjenljanqrhhzdv`.

### Table-level usage matrix

`code refs` counts files containing `from('table_name')` calls against the Supabase client. `last write` is `MAX(created_at)`. Today = 2026-05-13.

| Table | Rows | Code refs | Last write | Verdict |
|---|---:|---:|---|---|
| user_profiles | 10 | 44 | 2026-04-13 | live |
| transactions | 393 | 42 | 2026-04-13 | live |
| recurring_expenses | 21 | 23 | 2026-04-13 | live |
| categories | 16 | 20 | (static) | live |
| value_map_sessions | 6 | 20 | 2026-05-06 | live |
| monthly_snapshots | 11 | 19 | 2026-04-13 | live |
| conversations | 40 | 15 | 2026-04-24 | live |
| financial_portrait | 29 | 14 | 2026-05-07 | live |
| value_category_rules | 61 | 14 | 2026-04-18 | live |
| user_events | 2691 | 13 | 2026-05-08 | live |
| goals | 7 | 12 | 2026-04-18 | live |
| assets | 6 | 11 | 2026-04-18 | live |
| liabilities | 2 | 9 | 2026-04-18 | live |
| nudges | 0 | 9 | (never) | scaffolded but unused |
| action_items | 5 | 8 | 2026-04-13 | live |
| messages | 274 | 7 | 2026-04-24 | live |
| profiling_queue | 32 | 6 | 2026-04-17 | live |
| value_map_results | 60 | 6 | 2026-05-06 | live |
| trips | 4 | 5 | 2026-04-13 | live |
| correction_signals | 0 | 4 | (never) | scaffolded but unused |
| demo_sessions | 6 | 4 | 2026-04-13 | live |
| user_merchant_rules | 58 | 3 | 2026-05-06 | live |
| net_worth_snapshots | 2 | 3 | 2026-04-18 | live |
| investment_holdings | 0 | 3 | (never) | scaffolded but unused |
| message_feedback | 1 | 1 | 2026-04-10 | live (stale) |
| merchant_category_map | 0 | 1 | (never) | **likely dead** (write-only from `value-map-flow.tsx`, zero reads, superseded by `user_merchant_rules`) |
| llm_usage_log | 13 | 1 | 2026-05-06 | live (under-instrumented — see Phase 4) |
| demo_waitlist | 3 | 1 | 2026-04-06 | live (stale) |
| demo_question_responses | 60 | 1 | 2026-04-13 | live |
| consent_records | 30 | 1 | 2026-04-13 | live |
| benchmarks | 28 | 1 | (static) | live (reference data) |
| bank_format_templates | 1 | 1 | n/a | live |
| accounts | 0 | 1 | (never) | scaffolded but unused |
| **active_experiments** | 0 | 0 application + 1 in types.ts only | (never) | **DEAD — recently added scaffolding, no consumer** |
| **dsar_requests** | 0 | 0 application + 1 in types.ts only | (never) | **DEAD — compliance scaffolding, no consumer** |
| **savings_tips** | 18 | 0 application + 1 in types.ts only | (static seed) | **DEAD — 18 rows of seed data, nothing reads it** |
| **third_party_data_flows** | 3 | 0 application + 1 in types.ts only | (static seed) | **DEAD — compliance metadata, nothing reads it** |

## Dead tables (0 application references)

| Table | Schema age | Row state | Recommendation |
|---|---|---|---|
| `active_experiments` | Recent (migration 040?) | 0 rows | Drop or wire in. Look at "Wow Moment v2" mentions in comments — feature was scaffolded but never connected to a code path. |
| `dsar_requests` | GDPR compliance scaffolding | 0 rows | Keep (compliance requirement) but the table is unreachable from the app. Future DSAR work will need new code; current table is structurally orphaned. |
| `savings_tips` | Seeded reference data | 18 rows | The feature it supports (tier-gated savings tips) was never wired. Either build the consumer or drop the table and the seed. |
| `third_party_data_flows` | Compliance metadata | 3 rows | Same as DSAR — likely required by privacy policy but not consumed by code. |
| `merchant_category_map` | Legacy categorisation | 0 rows | Superseded by `user_merchant_rules` (58 rows, 3 refs, fresh writes). Write site at `value-map-flow.tsx:357` should be removed in cleanup. |

## Empty but referenced tables (alive in code, dormant in production)

These have working write/read code paths but no production data. Either the feature is rarely exercised or it's behind a flag:

- `nudges` — Session 11's nudge system; never sent (likely needs cron + flag enablement)
- `correction_signals` — value-category correction learning loop; possibly behind a path that hasn't been exercised
- `investment_holdings` — pension/investment positions; users haven't uploaded any
- `accounts` — abstract bank-account model; possibly displaced by transactions-only path

## Stale activity (no writes in 30+ days)

- `demo_waitlist` (37 days) — public Value Map signup; suggests no recent demo traffic
- `message_feedback` (33 days) — only 1 row total; feedback UI may not be discoverable
- Borderline: `transactions`, `action_items`, `user_profiles`, `recurring_expenses`, `monthly_snapshots`, `consent_records`, `trips`, `demo_sessions`, `demo_question_responses` all last-written on 2026-04-13 — exactly the 30-day boundary. The pattern suggests one big batch on that date and quiet since.

## Column-level drift (sample only)

Time-box did not permit per-column grep across all 37 tables. Sampled the most actionable:

- `messages.tools_used` (`text[]`) — referenced; 0 production rows have non-empty array (CLAUDE.md acknowledges this — forward-only fix from S-W1.5-10).
- `messages.profile_updates`, `messages.actions_created`, `messages.insights_generated` — same forward-only fix; expected to be NULL on historical rows.
- `messages.tool_results` — referenced in code but **not** in the schema column list above. Verify whether code-side reference targets a different column (e.g. `tools_used` payloads).

**Cleanup-session action:** spawn an Explore agent to do the full column-by-column grep for every non-trivial column name. The candidate list to run against:
- Every column whose name doesn't appear in the common set: `id, user_id, profile_id, name, created_at, updated_at, deleted_at, anonymised_at, status, type, metadata, source, currency, amount, description, date`.

## Notes on `messages.tools_used` data type

The session spec assumed `tools_used` was JSONB; production schema has it as **`text[]`** (array of strings). Code that processes this column needs to use array-element access, not JSON path access. Verify the message audit pipeline matches.
