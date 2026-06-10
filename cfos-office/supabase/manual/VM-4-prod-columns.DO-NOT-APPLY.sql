-- VM-4 prod companion — DO NOT APPLY without Lewis's explicit approval.
-- Target: production project iccelmjenljanqrhhzdv (Claude must NEVER run this).
--
-- Mirrors staging migration 072_vm4_taxonomy_columns.sql exactly. Additive
-- and nullable; safe to apply at any time before the VALUE_MAP_V2 flag is
-- enabled in production. No backfill: legacy sessions stay NULL and are
-- distinguished by taxonomy_version.

ALTER TABLE value_map_sessions
  ADD COLUMN IF NOT EXISTS taxonomy_version text,
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS certainty_state text,
  ADD COLUMN IF NOT EXISTS classification_receipt jsonb;

COMMENT ON COLUMN value_map_sessions.taxonomy_version IS
  'VM-4: deterministic archetype taxonomy version (v1). NULL = pre-taxonomy session.';
COMMENT ON COLUMN value_map_sessions.family IS
  'VM-4: growth | security | agency | candor. NULL with taxonomy_version set = unnamed fallback.';
COMMENT ON COLUMN value_map_sessions.certainty_state IS
  'VM-4: certain | exploring. NULL when family is NULL.';
COMMENT ON COLUMN value_map_sessions.classification_receipt IS
  'VM-4: deterministic classification receipt (ratios, certainty components, bands, tension, reading).';
