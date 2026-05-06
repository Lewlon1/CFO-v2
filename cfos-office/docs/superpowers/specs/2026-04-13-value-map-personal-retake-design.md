# Value Map Personal Retake — Design Spec

## Context

The prediction/learning engine (session 29) learns from user corrections and the pill UI (session 28). But the system is passive — it waits for users to correct transactions one at a time. This feature closes the loop: the CFO actively recruits user input where it matters most, and the user's financial personality evolves over time.

**Problem:** Low-confidence predictions accumulate silently. Users don't know the system is uncertain. The CFO can't improve without input.

**Solution:** A CFO-triggered "personal retake" exercise that surfaces the 10 transactions the system is most uncertain about, lets the user classify them, feeds the results into the learning engine with elevated weight, and regenerates the user's financial archetype from accumulated signals.

---

## 1. Candidate Selection

**File:** `lib/prediction/candidate-selector.ts`

### Interface

```typescript
type RetakeCandidate = {
  transaction_id: string
  merchant_clean: string
  description: string       // original, for display
  amount: number
  currency: string
  date: string              // ISO date
  category_name: string     // traditional category display name
  category_id: string
  current_value_category: ValueCategoryType | null
  current_confidence: number
}

async function selectRetakeCandidates(
  userId: string
): Promise<{
  candidates: RetakeCandidate[]  // exactly 10
  impact_estimate: number        // total txns affected
  lowest_avg_confidence: number
} | null>  // null = not enough data
```

### Selection Logic

1. **Query uncertain merchants** (last 60 days, confidence < 0.50, not user-confirmed, grouped by `merchant_clean`, min 2 txns per merchant):
   ```sql
   SELECT merchant_clean,
     COUNT(*) as txn_count,
     AVG(value_confidence) as avg_conf,
     COUNT(*) * (0.50 - AVG(value_confidence)) as impact_score
   FROM transactions
   WHERE user_id = $1
     AND prediction_source != 'user_confirmed'
     AND value_confidence < 0.50
     AND date > now() - interval '60 days'
   GROUP BY merchant_clean
   HAVING COUNT(*) >= 2
   ORDER BY impact_score DESC
   LIMIT 15
   ```

2. **Diversity filter** (from the 15, select 10):
   - Join each merchant to its most common `category_id`, then to `categories.tier` (core/lifestyle/financial)
   - Include at least 1 from each tier if available
   - Cap at 3 per traditional category
   - If fewer than 8 qualifying merchants: return `null`

3. **Representative transaction per merchant** — closest to median amount, tiebreak most recent:
   ```sql
   SELECT * FROM transactions
   WHERE user_id = $1 AND merchant_clean = $2
   ORDER BY ABS(amount - (
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)
     FROM transactions
     WHERE user_id = $1 AND merchant_clean = $2
   )) ASC, date DESC
   LIMIT 1
   ```

4. `impact_estimate` = SUM of `txn_count` across selected merchants.

### Reuse

- `normaliseMerchant()` from `lib/categorisation/normalise-merchant.ts` (already used in correction signal flow)
- `createClient()` / `createServiceClient()` from `lib/supabase/`
- `ValueCategoryType` from `lib/prediction/types.ts`

---

## 2. Personal Mode in ValueMapFlow

**File:** `components/value-map/value-map-flow.tsx` (modify)

### Changes

Add to mode union: `'personal'`

```typescript
mode?: 'onboarding' | 'retake' | 'checkin' | 'personal'
```

Add props:
```typescript
personalTransactions?: RetakeCandidate[]
impactEstimate?: number
```

### Behavior when `mode === 'personal'`

- **Intro step**: CFO-flavored intro. "I'm not confident about how you'd value some of your spending. This quick exercise will sharpen my categorisation." Skip upload step entirely.
- **Exercise step**: Use `personalTransactions` mapped to `ValueMapTransaction[]` format. Same `ValueMapCard` UX — quadrant buttons, confidence slider (1-5), timing tracking, hard-to-decide escape.
- **Summary step**: Replace personality calculation and archetype reveal with `RetakeImpact` component (see section 3). The personality recalculation happens server-side async.
- **No cut-or-keep or one-thing steps** — those are retake-specific.

### Transaction mapping

Map `RetakeCandidate` to `ValueMapTransaction` (the format ValueMapCard expects):
```typescript
{
  id: candidate.transaction_id,
  merchant: candidate.merchant_clean,
  description: candidate.description,
  amount: candidate.amount,
  currency: candidate.currency,
  date: candidate.date,
  category: candidate.category_name,
  // These are real transactions from the DB
}
```

### Results saving

After exercise completes:
1. Create `value_map_sessions` row with `session_type = 'personal'`, personality fields null (populated async by archetype regeneration)
2. Insert individual `value_map_results` rows per card (same as existing modes)
3. POST to `/api/value-map/personal` with results to trigger learning (see section 4)

---

## 3. Post-Retake Impact Summary

**File:** `components/value-map/retake-impact.tsx` (new)

Displayed after personal retake completes and the POST returns.

### Props

```typescript
{
  affectedCount: number       // transactions updated by learning
  prevCategorisedPct: number  // % categorised before
  newCategorisedPct: number   // % categorised after
}
```

### Display

```
Done! That exercise just improved categorisation for {affectedCount} transactions.
Your Values View is now {newCategorisedPct}% categorised, up from {prevCategorisedPct}%.
```

Two buttons:
- "See my Values View" → navigate to `/office/values/value-split`
- "Back to transactions" → navigate to `/office/cash-flow/transactions`

### Data source

The POST response from `/api/value-map/personal` includes the impact metrics after learning engine runs.

---

## 4. API Routes

**File:** `app/api/value-map/personal/route.ts` (new)

### GET — Check eligibility and fetch candidates

```typescript
// 1. Auth check
// 2. Call selectRetakeCandidates(userId)
// 3. If null → { eligible: false }
// 4. Else → { eligible: true, candidates, impact_estimate, lowest_avg_confidence }
```

### POST — Save results and trigger learning

Request body:
```typescript
{
  session_id: string        // the value_map_sessions row created client-side
  results: Array<{
    transaction_id: string
    quadrant: 'foundation' | 'investment' | 'leak' | 'burden'
    confidence: number      // 1-5
    hard_to_decide: boolean
    first_tap_ms: number | null
    card_time_ms: number
    deliberation_ms: number
  }>
}
```

Processing:
1. For each result (synchronous, top 3 merchants):
   a. Update transaction: `value_category`, `value_confidence = 1.0`, `value_confirmed_by_user = true`, `prediction_source = 'user_confirmed'`, `confirmed_at = now()`
   b. Insert `correction_signal` with `weight_multiplier = 2.0`
   c. Call `processSignals(userId, merchantClean)`
   d. Call `backfillForMerchant(userId, merchantClean)`

2. For remaining merchants (async via `after()`):
   Same steps a-d, but non-blocking.

3. After all learning completes:
   - Query impact: count transactions where `prediction_source IN ('merchant_rule', 'merchant_time', 'merchant_amount')` and `updated_at > retake_start_timestamp`
   - Calculate categorised percentage before/after
   - Trigger `regenerateArchetype(userId)` (async, non-blocking)

4. Return: `{ success: true, affected_count, prev_categorised_pct, new_categorised_pct }`

### Reuse

- Correction signal insertion pattern from `app/api/corrections/signal/route.ts`
- `processSignals` from `lib/prediction/process-signals.ts`
- `backfillForMerchant` from `lib/prediction/backfill.ts`
- `normaliseMerchant` from `lib/categorisation/normalise-merchant.ts`
- `getTimeContext` from `lib/utils/time-context.ts`

---

## 5. Retake Trigger + Nudge

### Trigger Logic

**File:** `lib/prediction/retake-trigger.ts` (new)

```typescript
async function shouldTriggerRetake(userId: string): Promise<{
  should_trigger: boolean
  reason: string
  top_merchants: string[]     // top 3 uncertain merchant names
  uncertain_count: number
}>
```

Logic:
1. Last personal retake > 14 days ago (query `value_map_sessions` where `session_type = 'personal'`)
2. Last `value_map_retake` nudge > 14 days ago (query `nudges` table)
3. `selectRetakeCandidates` returns non-null with `impact_estimate > 20`
4. If all pass → `should_trigger: true`

### Nudge Rule

**File:** `lib/nudges/rules.ts` (modify)

Add `'value_map_retake'` to `NudgeType` union.

```typescript
value_map_retake: {
  type: 'value_map_retake',
  title_template: 'Help me understand your spending better',
  body_template: "I'm not confident about how you'd value spending at {{merchant1}}, {{merchant2}}, and {{remaining_count}} others. A quick 2-minute exercise will sharpen my categorisation.",
  action_url: '/office/values/retake',
  priority: 'medium',
  frequency: 'recurring',
  cooldown_hours: 336,        // 14 days
  max_per_month: 2,
  enabled_by_default: true,
  evaluation_schedule: 'weekly',
}
```

### Nudge Evaluator

**File:** `lib/nudges/evaluators/value-map-retake.ts` (new)

Calls `shouldTriggerRetake`. If true, calls `createNudge` with merchant template variables.

### Post-Import Hook

**File:** `lib/upload/pipeline.ts` (modify)

After the 3-pass import completes, add:
```typescript
after(async () => {
  const result = await shouldTriggerRetake(userId)
  if (result.should_trigger) {
    await evaluateRetakeNudge(userId)
  }
})
```

---

## 6. Retake Page

**File:** `app/(office)/office/values/retake/page.tsx` (new)

Server component:
1. Auth check
2. GET `/api/value-map/personal` for eligibility
3. If eligible: render `ValueMapFlow` in `personal` mode with candidates
4. If not eligible: show message "Your categorisation is looking good! I'll let you know when I could use your help."

Also add to the values folder navigation in `app/(office)/office/values/page.tsx`:
```typescript
{
  id: 'retake',
  label: 'Categorisation Check-Up',
  description: 'Help me learn your values better',
  icon: RefreshCw,
  href: '/office/values/retake',
}
```

---

## 7. Archetype Regeneration

**File:** `lib/prediction/archetype-regeneration.ts` (new)

### Interface

```typescript
async function regenerateArchetype(userId: string): Promise<{
  personality_type: string           // deterministic, recalculated
  dominant_quadrant: string
  archetype_name: string             // LLM-generated
  archetype_subtitle: string         // LLM-generated
  archetype_analysis: string         // LLM-generated, 3-4 paragraphs
  shift_from_previous: string | null // LLM-generated, if prior exists
}>
```

### Step 1: Recalculate Deterministic Personality

Query the accumulated correction signal distribution:
```sql
SELECT value_category, SUM(weight_multiplier) as weighted_count
FROM correction_signals
WHERE user_id = $1
GROUP BY value_category
```

Map to the same thresholds as `calculatePersonality()`:
- Leak >= 25% → Drifter
- Burden >= 30% → Anchor
- Investment >= 35% → Builder
- Foundation >= 50% → Fortress
- Else → Truth Teller

This uses real corrections (weighted), not sample exercise results.

### Step 2: Assemble LLM Context (weighted inputs)

1. **Original Value Map** (type='onboarding', weight decays by age):
   ```
   weight = max(0.15, 0.70 - (months_since * 0.10))
   ```

2. **Personal retakes** (type='personal', weight decays slower):
   ```
   weight = max(0.20, 0.80 - (months_since * 0.10))
   ```

3. **Correction signal summary** (weight 0.90, always strong):
   - Overall value distribution from `value_category_rules`
   - Top 5 highest-confidence merchant rules
   - Top 5 lowest-agreement merchant rules
   - Time-sensitive rules (behavioral patterns)
   - Amount-sensitive rules (spending threshold patterns)

4. **Monthly snapshot trends** (last 3 months, weight 0.70):
   `spending_by_value_category` from `monthly_snapshots`

5. **Previous archetype** (if exists, for comparison)

### Step 3: Bedrock Call

System prompt instructs the model to generate:
- `archetype_name`: 2-4 word evocative title
- `archetype_subtitle`: One sentence
- `archetype_analysis`: 3-4 paragraphs referencing specific merchants and patterns
- `shift_from_previous`: 1-2 sentences if previous exists, null otherwise

### Step 4: Store Result

Upsert `user_intelligence`:
- `personality_type` (recalculated deterministic)
- `dominant_quadrant` (recalculated)
- `archetype_name`, `archetype_subtitle`, `archetype_analysis`
- `archetype_generated_at = now()`
- Append to `archetype_history` JSONB array:
  ```json
  {
    "version": N,
    "archetype_name": "...",
    "personality_type": "...",
    "generated_at": "...",
    "shift_from_previous": "...",
    "signal_summary": { ... }
  }
  ```

### Trigger Points

- After personal Value Map retake completes (automatic)
- After monthly review if > 20 new corrections since last regeneration (count `correction_signals` rows where `created_at > archetype_generated_at`)
- Manual: via future chat command (not in this session's scope)

### Reuse

- `calculatePersonality` thresholds from `lib/value-map/personalities.ts`
- Bedrock provider from `lib/ai/provider.ts`
- `createServiceClient` from `lib/supabase/service.ts`

---

## 8. Schema Migration

**File:** `supabase/migrations/033_value_map_personal.sql`

```sql
-- 1. Recreate user_intelligence (dropped in 026, still referenced by code)
CREATE TABLE IF NOT EXISTS public.user_intelligence (
  profile_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  personality_type text,
  dominant_quadrant text,
  archetype_name text,
  archetype_subtitle text,
  archetype_analysis text,
  archetype_generated_at timestamptz,
  archetype_history jsonb DEFAULT '[]'::jsonb,
  value_map_insights jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  last_interaction_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own intelligence"
  ON public.user_intelligence FOR SELECT
  USING (profile_id = auth.uid());
CREATE POLICY "Users can update own intelligence"
  ON public.user_intelligence FOR UPDATE
  USING (profile_id = auth.uid());

-- 2. Add session_type to value_map_sessions
ALTER TABLE public.value_map_sessions
  ADD COLUMN IF NOT EXISTS session_type text DEFAULT 'onboarding';

-- 3. Index for retake trigger queries
CREATE INDEX IF NOT EXISTS idx_vms_profile_type
  ON public.value_map_sessions(profile_id, session_type)
  WHERE deleted_at IS NULL;

-- 4. Index for candidate selection
CREATE INDEX IF NOT EXISTS idx_txn_retake_candidates
  ON public.transactions(user_id, merchant_clean, value_confidence)
  WHERE prediction_source != 'user_confirmed'
    AND value_confidence < 0.50;
```

---

## 9. Context Builder Integration

**File:** `lib/ai/context-builder.ts` (modify)

### Changes to `buildPortraitContext`

Add a parallel query for `user_intelligence` (latest archetype):
```typescript
supabase
  .from('user_intelligence')
  .select('*')
  .eq('profile_id', userId)
  .single()
```

In the portrait context section, after the existing Value Map perception block:

1. **If archetype exists** (from `user_intelligence`):
   ```
   ## Financial archetype
   Archetype: {archetype_name} — {archetype_subtitle}
   Generated: {archetype_generated_at}
   ```

2. **If archetype history has > 1 entry**:
   ```
   Archetype evolution: {previous_name} → {current_name}
   (shifted because: {shift_from_previous})
   ```

3. **Prediction quality summary** (from `getPredictionMetrics`):
   ```
   {high_confidence_pct}% of transactions confidently categorised.
   {uncategorised_count} still need input.
   ```

4. **Retake suggestion** (if `shouldTriggerRetake` returns true):
   Add to profiling context:
   ```
   Consider suggesting the user retake their Value Map —
   {uncertain_count} transactions need their input.
   ```

### Token budget consideration

The archetype section adds ~200 tokens. The prediction summary adds ~50. The retake suggestion adds ~30. Total: ~280 tokens, well within budget given the existing portrait context is ~300 tokens.

---

## Files Summary

### New
- `lib/prediction/candidate-selector.ts`
- `lib/prediction/retake-trigger.ts`
- `lib/prediction/archetype-regeneration.ts`
- `components/value-map/retake-impact.tsx`
- `app/api/value-map/personal/route.ts`
- `app/(office)/office/values/retake/page.tsx`
- `lib/nudges/evaluators/value-map-retake.ts`
- `supabase/migrations/033_value_map_personal.sql`

### Modified
- `components/value-map/value-map-flow.tsx` — add `'personal'` mode
- `lib/nudges/rules.ts` — add `value_map_retake` nudge type
- `lib/ai/context-builder.ts` — archetype evolution + prediction quality
- `lib/upload/pipeline.ts` — post-import retake trigger check
- `app/(office)/office/values/page.tsx` — add retake to folder navigation

### Do Not Touch
- `lib/prediction/learning-engine.ts` (stable)
- `lib/prediction/predictor.ts` (stable)
- `lib/prediction/process-signals.ts` (consumed, not modified)
- `lib/parsers/*` (shipped)

---

## Verification

1. **Candidate selection**: Insert test transactions with varying confidence levels. Verify 10 diverse candidates returned. Verify null when < 8 merchants qualify.
2. **Personal mode**: Complete the flow with real transaction data. Verify timing/confidence tracking works identically to other modes.
3. **Learning engine**: After retake, verify correction signals have `weight_multiplier = 2.0`. Verify rules update faster than with 1.0x signals.
4. **Impact summary**: Verify affected count matches actual backfilled transactions.
5. **Nudge**: Upload CSV with many uncertain merchants. Verify nudge fires. Verify 14-day cooldown prevents duplicate.
6. **Retake page**: Navigate to `/office/values/retake`. Eligible user sees flow. Ineligible user sees helpful message.
7. **Archetype regeneration**: After retake, verify `user_intelligence` has new archetype. Verify `archetype_history` appends correctly.
8. **Context builder**: Start new chat after retake. Verify system prompt includes archetype narrative and evolution.
9. **Mobile**: Test retake flow on iPhone Safari. Verify pill targets are tappable (44x44px minimum).
