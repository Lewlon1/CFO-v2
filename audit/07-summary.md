# Phase 7 — Branches & Migrations Summary

## Branches

Only **4 local branches** exist, all touched in the last 7 days:

| Date | Branch | Notes |
|---|---|---|
| 2026-05-12 | `audit/codebase-map-2026-05` | This audit's branch (just created) |
| 2026-05-12 | `claude/audit-codebase-map-6NrOr` | Prior Claude-named branch for the same audit task; effectively the working branch this audit was forked off |
| 2026-05-12 | `claude/nervous-shannon-750502` | Claude voice-to-text artefact branch from same day; head is `787d8e2 fix(theme): migrate (office) tree to token-aware text utilities` and is the **same head as `claude/audit-codebase-map-6NrOr`**. Duplicate; delete after audit lands. |
| 2026-05-06 | `main` | v2.1 — Phase A landed (PR #36) |

**No stale branches** (>60 days idle). No abandoned WIP. Branch hygiene is excellent.

Remote mirrors the four local branches; nothing extra.

### Recommended cleanup
- After this audit's PR merges, delete `claude/nervous-shannon-750502` (identical head to `claude/audit-codebase-map-6NrOr`).
- After this audit's PR merges, decide whether to retain `claude/audit-codebase-map-6NrOr` or fold it into the audit branch.

## Migrations

- **On disk:** 41 files in `cfos-office/supabase/migrations/`, numbered `001_initial_schema.sql` → `041_onboarding_v2_marcus_and_bridge.sql`.
- **Tracked in remote `supabase_migrations.schema_migrations`:** 63 rows — includes earlier migrations applied before the disk numbering convention was adopted (`20260101_base_schema`, `20260102_merchant_category_map`, `20260318_fn_generate_monthly_snapshot`, etc.).

### Tracking drift

The remote migration table reflects what was applied via Supabase tooling. The on-disk `001…037` set is fully tracked (all 37 appear in the remote list under their numbered names or earlier-numbered `20260403195502` style stamps).

**On-disk migrations 038–041 are NOT in the remote tracking table:**
- `038_conversation_analysed_at.sql`
- `039_active_experiments.sql`
- `040_onboarding_v2_struggle.sql`
- `041_onboarding_v2_marcus_and_bridge.sql`

However, the **resulting schema state matches what these migrations would produce**:
- `conversations.analysed_at` column exists (proves 038 was effectively applied).
- `active_experiments` table exists (proves 039 was effectively applied).
- `user_profiles.onboarding_progress` column exists (likely from 040/041).

**Interpretation:** these four migrations were applied directly via the Supabase SQL Editor (not through the migration tracker), which is a known pattern in this codebase — note migration `4ea26df fix(migrations): rewrite 031 to apply cleanly from SQL Editor` in the main branch log.

**Risk:** another environment (staging if it exists, a fresh local Supabase) cannot reproduce production by replaying tracked migrations alone. The disk files are SoT; the tracker is incomplete.

### Recommendation for cleanup session

- Backfill `supabase_migrations.schema_migrations` with version rows for 038/039/040/041 so future migration runs don't double-apply.
- Adopt a "every migration must be tracked, even if applied via SQL Editor" rule.
- Pre-disk legacy migrations (`20260101_base_schema`, `20260102_merchant_category_map`, `20260318*`, etc.) should either be moved into the `cfos-office/supabase/migrations/` tree under retro-active numbers or explicitly archived.

## Verdict

- Branch hygiene: **clean**.
- Migration tracking: **moderate drift** — 4 unapplied (per tracker) but effectively applied (per schema) files. No data risk but rebuild-from-tracked-migrations would fail.
