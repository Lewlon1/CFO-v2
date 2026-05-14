# Backlog

Items deferred out of completed sessions for future work. Not a roadmap (that lives in `CLAUDE.md`); this captures things that were verified or scoped but intentionally not shipped.

---

## Tier 2 cleanup deferrals — Session 05 (2026-05-13)

### `merchant_category_map` table — needs read-site refactor before drop

The Tier 2 candidate list flagged `merchant_category_map` for deletion, but `cfos-office/src/components/value-map/value-map-flow.tsx:357` reads from it during first-categorisation at signup. Dropping it without a refactor regresses new-user onboarding.

**Work to do:** migrate the lookup to `user_merchant_rules` (or another live table), then drop. Likely a half-session because the read happens on the unauthenticated public flow and the source data needs a home.

### Tier 1 leftover — `ValuePill.tsx`

Session 03's Tier 1 list named three v2.4 primitives for deletion (`MetricTile.tsx`, `ValuePill.tsx`, `FolderCard.tsx`); only two were deleted. `cfos-office/src/components/data/ValuePill.tsx` survived because it was still imported by `DataComponents.tsx` at the time.

**Work to do:** re-grep, confirm it is now orphan, delete (and prune any remaining barrel re-export).

### Production migration application — 042 + 043

- `042_drop_dead_tables.sql` — applied to staging in Session 03, **not** applied to production. Lewis-only. Run advisors immediately after.
- `043_backfill_schema_migrations.sql` — metadata-only backfill of versions 038–041 in the production tracker. Applied to staging in Session 05 (no-op there). Apply to production manually after merge.

### Tier 3 — out of cleanup scope, real code work

- `llm_usage_log` instrumentation — schema design + write sites are real code, not cleanup.
- Export-style standardisation across `src/lib/**` — codemod scope; do as its own pass.

---
