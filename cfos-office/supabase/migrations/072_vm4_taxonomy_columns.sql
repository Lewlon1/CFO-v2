-- VM-4 — Archetype v2 deterministic taxonomy columns.
--
-- The only schema delta in the VM line. Additive: four nullable columns on
-- value_map_sessions. Legacy rows keep NULLs (pre-taxonomy sessions are not
-- back-classified — taxonomy_version distinguishes the populations).
--
--   taxonomy_version        'v1' for rows classified by classify-archetype.ts
--   family                  'growth' | 'security' | 'agency' | 'candor' | NULL
--                           (NULL + taxonomy_version set = unnamed fallback)
--   certainty_state         'certain' | 'exploring' | NULL
--   classification_receipt  full deterministic receipt JSON (ratios, certainty
--                           components, band counts, tension choice, reading)

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
