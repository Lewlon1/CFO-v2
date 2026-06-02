-- ============================================================================
-- prod-backfill-071-value-flow-dedup.sql
--
--   ⛔ DO NOT APPLY AUTOMATICALLY. ⛔
--   Production project: iccelmjenljanqrhhzdv. Lewis runs this MANUALLY, after
--   review, against production only. No automation, no CI, no agent applies it.
--   (This session touched STAGING `qlbhvlssksnrhsleadzn` only.)
--
-- Companion to: the value-flow dedup fix (branch claude/funny-pasteur-GEpYl).
-- Session: "Value-Flow Dedup + Post-Read Reveal Voice" — see SESSION-LOG D1/D2.
-- ============================================================================
--
-- WHAT THE BUG WAS
--   The value check-in re-served merchants the user had already classified. The
--   check-in confirms ONE card per merchant (value_confirmed_by_user=true on that
--   row), but the candidate selector (fetchAndScoreReviewCandidates) filtered
--   PER-TRANSACTION (value_confirmed_by_user=false AND value_confidence<0.7), so
--   the merchant's still-low-confidence SIBLING transactions re-qualified it on
--   the next check-in. (The siblings were never lifted because the learning
--   engine is not persisting value_category_rules — see D1 / BACKLOG.)
--
-- THE REAL FIX IS CODE, NOT DATA.
--   src/lib/ai/tools/get-value-review-queue.ts now excludes any merchant the user
--   has already classified (fetchClassifiedMerchants — keyed off
--   value_confirmed_by_user, with a value_category_rules fallback). Once that ships,
--   re-serving STOPS AT DEPLOY regardless of sibling confidence, because the WHOLE
--   merchant group is dropped. THEREFORE NO PRODUCTION DATA BACKFILL IS REQUIRED.
--
--   Everything below is OPTIONAL hygiene. Apply only if you want sibling rows
--   settled for value-view display consistency / belt-and-suspenders. Read the
--   assessment first; the destructive parts are commented out by default.
--
-- ============================================================================
-- (A) READ-ONLY BLAST-RADIUS ASSESSMENT — safe to run on prod, changes nothing.
-- ============================================================================

-- A1. Merchants a user has confirmed that STILL have re-qualifying siblings.
--     (Approximation: groups by the first token of the description, since SQL
--      cannot call the app's normaliseMerchant(). Treat as indicative, not exact.)
select
  t.user_id,
  lower(split_part(t.description, ' ', 1))                                  as rough_merchant,
  count(*) filter (where t.value_confirmed_by_user)                         as confirmed_cards,
  count(*) filter (where t.value_confirmed_by_user = false
                     and (t.value_confidence is null or t.value_confidence < 0.7)
                     and t.amount < 0)                                      as requalifying_siblings
from public.transactions t
group by t.user_id, rough_merchant
having count(*) filter (where t.value_confirmed_by_user) > 0
   and count(*) filter (where t.value_confirmed_by_user = false
                          and (t.value_confidence is null or t.value_confidence < 0.7)
                          and t.amount < 0) > 0
order by requalifying_siblings desc
limit 100;

-- A2. Double-weight pollution (D2): merchants re-rated more than once at elevated
--     weight (re-served, then re-classified — biases archetype regeneration).
select
  cs.user_id, cs.merchant_clean,
  count(*) filter (where cs.weight_multiplier >= 2) as elevated_rows,
  array_agg(distinct cs.value_category::text)        as categories_seen
from public.correction_signals cs
group by cs.user_id, cs.merchant_clean
having count(*) filter (where cs.weight_multiplier >= 2) > 1
order by elevated_rows desc;

-- ============================================================================
-- (B) OPTIONAL — settle confirmed merchants' sibling rows (display hygiene).
--     The code fix already prevents re-serving; this only makes the value view
--     internally consistent for users who were affected before the deploy.
--
--     This is the PROD EQUIVALENT of the staging backfill applied this session
--     (which was scoped to one test user's 8 merchants). For prod it must be
--     filled in per (user, merchant, category) from the (A1) results — there is
--     no safe blanket form, because matching a sibling to its confirmed merchant
--     needs the app's normaliseMerchant() that SQL cannot replicate.
--
--     TEMPLATE — copy per merchant from the (A1) output, set the right category,
--     keep value_confirmed_by_user=false (these are rule-propagated, NOT
--     user-confirmed). DO NOT APPLY until reviewed.
-- ============================================================================

-- BEGIN;
-- update public.transactions
-- set value_category   = 'foundation'::value_category_type,  -- <- the user's call for this merchant
--     value_confidence = 0.7,                                -- settled, just above the 0.7 review gate
--     prediction_source = 'merchant_rule',
--     updated_at = now()
-- where user_id = '<USER_UUID>'
--   and value_confirmed_by_user = false
--   and (value_confidence is null or value_confidence < 0.7)
--   and amount < 0
--   and description ilike '%<MERCHANT_KEYWORD>%';
-- COMMIT;

-- ============================================================================
-- (C) OPTIONAL / LIKELY UNNECESSARY — dedupe double-weight signals (D2).
--     D2 verdict: immaterial (on staging, confined to one stale test user). The
--     code fix stops NEW double-weights at source. Only run if (A2) shows real
--     production pollution AND you want the archetype regeneration cleaned.
--     DESTRUCTIVE — keeps the most recent elevated signal per (user, merchant),
--     deletes older duplicates. DO NOT APPLY without review.
-- ============================================================================

-- BEGIN;
-- with ranked as (
--   select id,
--          row_number() over (
--            partition by user_id, merchant_clean
--            order by created_at desc
--          ) as rn
--   from public.correction_signals
--   where weight_multiplier >= 2
-- )
-- delete from public.correction_signals cs
-- using ranked r
-- where cs.id = r.id and r.rn > 1;
-- COMMIT;

-- ============================================================================
-- END prod-backfill-071-value-flow-dedup.sql  —  ⛔ DO NOT APPLY automatically ⛔
-- ============================================================================
