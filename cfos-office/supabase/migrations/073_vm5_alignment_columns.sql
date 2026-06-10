-- VM-5 — Alignment Score columns.
--
-- Additive: three nullable columns on monthly_snapshots. The score is pure
-- arithmetic over spending_by_value_category (see
-- src/lib/value-map/alignment.ts for the pinned v1 formula); the snapshot
-- writer persists all three on every refresh. Legacy rows are backfilled
-- from their stored jsonb (staging: VM-5 backfill; prod: companion script
-- in supabase/manual/, Lewis-gated).
--
--   aligned_spend_pct     (foundation + investment) / (foundation +
--                         investment + leak) over displayable spend, as a
--                         percentage 0–100 (4 dp). NULL = no displayable
--                         F/I/L spend — no score, never a fake number.
--                         Burden is deliberately excluded from the ratio:
--                         necessary costs are not judged.
--   alignment_confidence  displayable spend / eligible spend, 0–1 (4 dp).
--                         The honesty gate: surfaces render the score only
--                         at or above ALIGNMENT_DISPLAY_MIN_CONFIDENCE
--                         (value-config.ts), otherwise a calibrating state.
--   alignment_version     formula version ('v1'). The formula is pinned —
--                         changes mean a new version, never an in-place
--                         edit, so populations stay comparable.

ALTER TABLE monthly_snapshots
  ADD COLUMN IF NOT EXISTS aligned_spend_pct numeric,
  ADD COLUMN IF NOT EXISTS alignment_confidence numeric,
  ADD COLUMN IF NOT EXISTS alignment_version text;

COMMENT ON COLUMN monthly_snapshots.aligned_spend_pct IS
  'VM-5: (foundation+investment)/(foundation+investment+leak) over displayable spend, 0-100. NULL = ratio denominator was 0. Burden excluded from the ratio by design.';
COMMENT ON COLUMN monthly_snapshots.alignment_confidence IS
  'VM-5: displayable spend / eligible spend, 0-1. Score renders only at or above the value-config display floor.';
COMMENT ON COLUMN monthly_snapshots.alignment_version IS
  'VM-5: alignment formula version (v1). NULL = row not yet computed/backfilled.';
