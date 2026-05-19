-- v2.3 fix — INSERT policy was missing on proposed_experiments.
--
-- The v2.3 experiment-engine work (migration 052_experiment_engine) refreshed
-- SELECT and added UPDATE policies but didn't add INSERT for users. The
-- propose_catalog_experiment tool runs under the chat route's user-auth
-- client (ctx.supabase), so every insert was silently rejected by RLS and
-- no experiments ever persisted in prod or staging.
--
-- This adds the missing policy. user_id is constrained to the authenticated
-- user; conversation_id, related_goal_id and the rest are already gated by
-- the tool's own scoping logic.

DROP POLICY IF EXISTS "Users can insert own experiments" ON public.proposed_experiments;
CREATE POLICY "Users can insert own experiments"
  ON public.proposed_experiments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
