-- Session 13: RLS policy fixes
-- Adds missing DELETE policies needed for data management and account deletion.

-- value_category_rules: missing DELETE policy (needed for settings/data management)
DROP POLICY IF EXISTS "vcr_delete_own" ON public.value_category_rules;
CREATE POLICY "vcr_delete_own" ON public.value_category_rules
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- profiling_queue: missing DELETE policy (needed for account deletion flow)
DROP POLICY IF EXISTS "profiling_queue_delete" ON public.profiling_queue;
CREATE POLICY "profiling_queue_delete" ON public.profiling_queue
  FOR DELETE TO authenticated USING (user_id = auth.uid());
