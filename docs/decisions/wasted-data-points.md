# Wasted Data Points

> Last reviewed: 2026-05-03 (Session 27).

Data points that are written but never read, or exist in schema but are never populated.
Each needs a decision: wire it up, stop collecting it, or drop the column.

**Do not alter the database schema directly. All changes go through reviewed migration files.**

## RESOLVED: user_profiles write-only columns

These 5 fields were collected but never injected into the CFO context. Now wired into `buildProfileContext()` in `context-builder.ts`:
- `values_ranking`
- `financial_awareness`
- `residency_status`
- `tax_residency_country`
- `years_in_country`

## RESOLVED: monthly_snapshots — 3 of 4 numeric fields wired

`src/lib/analytics/monthly-snapshot.ts:102–104` now writes:
- `avg_transaction_size`
- `largest_transaction`
- `largest_transaction_desc`

`dining_out_count` remains unimplemented (see Open below).

## OPEN: messages metadata (written per message, never queried)

- `profile_updates` -- JSON of profile changes made during this message
- `actions_created` -- JSON of action items created during this message
- `insights_generated` -- JSON of insights produced during this message

**Decision needed:** Are these for a future admin dashboard? Audit trail? If neither, stop writing them to save payload size.

## OPEN: monthly_snapshots — `dining_out_count` only

- `dining_out_count` -- needs category-specific counting in snapshot compute function

**Decision needed:** Wire it up (low effort once category mapping is settled) or drop the column.

## OPEN: value_map_results (written, but context-builder reads from financial_portrait instead)

- `certainty_areas`, `conflict_areas`, `comfort_patterns` -- written during Value Map, but `buildPortraitContext()` reads them from `financial_portrait` traits
- `archetype_subtitle`, `full_analysis` -- written but only `archetype_name` is read

**Decision needed:** Either read these directly in context-builder (they're richer than the portrait summary), or stop writing them and rely on portrait traits. The raw Value Map fields contain more nuance than the portrait summary.
