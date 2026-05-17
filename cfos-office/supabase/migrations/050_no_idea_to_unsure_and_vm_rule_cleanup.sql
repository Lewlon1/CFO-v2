-- Session v2.2 (Chat Intelligence) preparatory migration.
-- 1. Migrate any value_category_type='no_idea' rows back to 'unsure'.
-- 2. Drop the broken VM merchant rules so the Gap analyser stops substring-matching
--    sample-card labels against bank descriptions.
-- 3. Drop the redundant 3-column unique index on value_category_rules; the 4-column
--    COALESCE form (vcr_unique_match) is what onConflict targets.
--
-- The `no_idea` enum value remains in value_category_type for safety; a follow-up
-- migration will recreate the enum without it once all code paths are confirmed
-- to write `unsure`. Phase 0 confirms 0 rows currently use `no_idea`.

begin;

-- Migrate any straggler rows (Phase 0 shows zero; this is defensive).
update public.value_map_results
   set quadrant = 'unsure'
 where quadrant = 'no_idea';

update public.value_category_rules
   set value_category = 'unsure'
 where value_category = 'no_idea';

update public.transactions
   set value_category = 'unsure'
 where value_category = 'no_idea';

update public.correction_signals
   set value_category = 'unsure'
 where value_category = 'no_idea';

-- Drop the broken VM merchant rules.
delete from public.value_category_rules
 where source = 'value_map'
   and match_type = 'merchant';

-- Drop the redundant 3-col unique constraint (and its backing index).
-- The 4-col COALESCE form (vcr_unique_match) is canonical and what onConflict targets.
alter table public.value_category_rules
  drop constraint if exists value_category_rules_unique_match;

commit;
