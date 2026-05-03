# Wasted Data Points

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

## OPEN: messages metadata (written per message, never queried)

- `profile_updates` -- JSON of profile changes made during this message
- `actions_created` -- JSON of action items created during this message
- `insights_generated` -- JSON of insights produced during this message

**Decision needed:** Are these for a future admin dashboard? Audit trail? If neither, stop writing them to save payload size.

## OPEN: monthly_snapshots (columns exist, never populated)

- `dining_out_count` -- needs category-specific counting in snapshot compute function
- `avg_transaction_size` -- simple arithmetic, just never added to compute function
- `largest_transaction` -- same
- `largest_transaction_desc` -- same

**Decision needed:** Wire into snapshot compute function. Low effort, high value -- the CFO could reference "your biggest purchase this month."

## OPEN: value_map_results (written, but context-builder reads from financial_portrait instead)

- `certainty_areas`, `conflict_areas`, `comfort_patterns` -- written during Value Map, but `buildPortraitContext()` reads them from `financial_portrait` traits
- `archetype_subtitle`, `full_analysis` -- written but only `archetype_name` is read

**Decision needed:** Either read these directly in context-builder (they're richer than the portrait summary), or stop writing them and rely on portrait traits. The raw Value Map fields contain more nuance than the portrait summary.
