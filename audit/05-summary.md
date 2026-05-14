# Phase 5 — Schema Audit Summary

## Headline

| Metric | Count |
|---|---:|
| Public-schema tables | 37 |
| **Dead tables** (0 application refs) | **4** |
| Likely-dead table (write-only, no reader) | 1 (`merchant_category_map`) |
| Empty but referenced (scaffolded, dormant) | 4 (`nudges`, `correction_signals`, `investment_holdings`, `accounts`) |
| Live and exercised | 27 |

## Dead tables (cleanup-session candidates)

1. **`active_experiments`** — 0 rows, 0 app refs. Recent feature scaffold, never wired up.
2. **`dsar_requests`** — 0 rows, 0 app refs. GDPR scaffold, no code consumer.
3. **`savings_tips`** — 18 seeded rows, 0 app refs. Feature designed but never built.
4. **`third_party_data_flows`** — 3 seeded rows, 0 app refs. Compliance metadata, no consumer.

## Likely-dead, needs decision

5. **`merchant_category_map`** — 0 rows; only writer is `components/value-map/value-map-flow.tsx:357`; no reader. Superseded by `user_merchant_rules` (58 rows, healthy). Recommended action: delete the write site, then drop the table.

## Schema drift instances

- **None detected at the table-name level** — every table referenced in code exists in the schema.
- Column-level drift was not fully audited (time-boxed). One specific call-out: `messages.tools_used` is `text[]` in production, not JSONB; verify code reads it as an array.

## CLAUDE.md alignment notes

- The note about pre-S-W1.5-10 messages having NULL `tools_used`, `profile_updates`, `actions_created`, `insights_generated` is confirmed: all 146 assistant messages predate the cutoff (deploy 2026-05-03, last assistant message 2026-04-24).
- This means the message audit trail is currently **100% data-unavailable** in production. The dedicated tables are still SoT.

## Verdict

The schema is **clean structurally** — no orphan FKs, no drift between code and schema at the table level. The mess is at the edges:
- 4 truly unused tables can be dropped to reduce schema noise.
- 4 empty-but-coded tables represent features that were built and not turned on; decide whether to enable (`nudges`, `correction_signals`) or remove the code paths.
- Production has been quiet for 3 weeks (last assistant message 2026-04-24). The audit can't tell whether features work or not — only that they aren't being exercised.

Schema discipline shows. The dead-table risk is low.
