-- v2.3 fix for PROD — apply the missing INSERT policy on proposed_experiments.
--
-- Status: DO NOT auto-apply. Lewis runs this manually on prod after the
-- v2.2-prod-readiness branch (which contains the v2.3 merge) is deployed.
--
-- WHY: Migration 052_experiment_engine omitted an INSERT policy. The
-- propose_catalog_experiment tool runs under the user's auth client and is
-- silently blocked by RLS — no experiments persist. Verified on staging:
-- `messages.tools_used` showed propose/decline tool calls but zero rows in
-- public.proposed_experiments.

DROP POLICY IF EXISTS "Users can insert own experiments" ON public.proposed_experiments;
CREATE POLICY "Users can insert own experiments"
  ON public.proposed_experiments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Verification:
--   SELECT polname, polcmd FROM pg_policy
--   WHERE polrelid = 'public.proposed_experiments'::regclass
--   ORDER BY polcmd;
--   -- Expect 4 policies: service-role, view (r), insert (a), update (w).
