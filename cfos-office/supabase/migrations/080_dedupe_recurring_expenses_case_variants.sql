-- Remediation plan (beta-blockers review), Issue 4.
--
-- 057_dedupe_recurring_expenses_by_lower_name.sql already collapsed
-- case-variant duplicates once. New ones kept accumulating after that
-- migration ran: `src/app/api/dashboard/summary/route.ts`'s ad-hoc recurring
-- detector grouped by the RAW transaction description (case-sensitive) and
-- upserted `name` verbatim — every bank statement that spelled a merchant
-- differently across import batches (`claude.ai` vs `Claude.ai`, `vercel`
-- vs `Vercel`, `supabase` vs `Supabase`) produced a second row under the
-- case-sensitive (user_id, name) unique constraint, phantom-inflating fixed
-- costs (~€178/mo in the lewis case). That route now normalises through the
-- same `normaliseMerchant` the main detector uses before grouping/upserting
-- (code fix, this session) — this migration is the one-time cleanup of rows
-- the bug already wrote before the code fix landed.
--
-- Identical collapse rule to 057: for each (user_id, lower(name)) cluster,
-- keep the row with highest status priority (tracked > detected >
-- dismissed), tiebreak by most recent updated_at, then lowercase the
-- survivor's name. Safe to re-run — a no-op once no case-variant
-- duplicates remain.

BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY
        CASE status
          WHEN 'tracked' THEN 1
          WHEN 'detected' THEN 2
          WHEN 'dismissed' THEN 3
          ELSE 4
        END,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM public.recurring_expenses
)
DELETE FROM public.recurring_expenses
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE public.recurring_expenses
   SET name = lower(name)
 WHERE name <> lower(name);

COMMIT;
