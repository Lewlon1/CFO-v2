-- 047_drop_dead_tables.sql
--
-- Recovers the drop_dead_tables migration applied to CFO Staging on
-- 2026-05-13 (registry version 20260513153216) but never committed to the
-- repo. The original SQL comment named this `042_drop_dead_tables.sql`; that
-- slot is now occupied by 042_llm_usage_log_tool_calls, hence the 047
-- renumber.
--
-- Audit reference: docs/audits/2026-05-01-dead-code.md identified four
-- tables with zero application-code consumers:
--   - active_experiments       (created in 039, never wired up)
--   - dsar_requests            (recreated in 028, no read/write path)
--   - savings_tips             (legacy seed; consumer removed pre-V2)
--   - third_party_data_flows   (legacy seed; consumer removed pre-V2)
--
-- Production has zero inbound FK references to all four (verified
-- 2026-05-15 via information_schema.constraint_column_usage). Their drops
-- are structurally safe — nothing else points at them.
--
-- DATA-SAFETY POLICY enforced in the DO block below: drop the table only if
-- it is currently empty. If any row exists (for example a seed row carried
-- forward from pre-V2), the DROP is skipped and a NOTICE is raised. No
-- silent data loss is possible regardless of which env this is applied to,
-- and regardless of when. As of 2026-05-15 prod state:
--   - active_experiments:        0 rows  → will drop
--   - dsar_requests:             0 rows  → will drop
--   - savings_tips:             18 rows  → skipped, Lewis to review
--   - third_party_data_flows:    3 rows  → skipped, Lewis to review
--
-- Lewis: if you decide the two seed tables are also safe to drop on prod,
-- run a manual TRUNCATE first, then re-run this migration. The empty-check
-- will then succeed and the drops will fire on the next pass.
--
-- Idempotent. Re-running is safe on either env. Staging already has all
-- four tables dropped (the existence check shortcuts to the absent-skip
-- branch; the row-count branch never triggers there).

DO $$
DECLARE
  tbl text;
  rc  bigint;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'active_experiments',
    'dsar_requests',
    'savings_tips',
    'third_party_data_flows'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE NOTICE '[047] public.% already absent; skipping', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT COUNT(*) FROM public.%I', tbl) INTO rc;

    IF rc > 0 THEN
      RAISE NOTICE '[047] public.% has % row(s); NOT dropping — manual review required', tbl, rc;
    ELSE
      EXECUTE format('DROP TABLE public.%I', tbl);
      RAISE NOTICE '[047] dropped public.% (was empty)', tbl;
    END IF;
  END LOOP;
END $$;
