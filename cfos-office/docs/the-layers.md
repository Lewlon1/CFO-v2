# The Layers — The CFO's Office Architecture

**Status:** v1, replaces prior concepts (Gap, Joy Signal verdicts, Read-as-separate-vocabulary)
**Date:** 2026-05-26
**Owner:** Lewis

## What this document replaces

Three concepts that existed informally across previous sessions but were never coherently specified:

- **"The wow moment"** — now: the first time the user encounters CFO writing produced from all five layers. No separate name.
- **"The Gap"** — now: a *capability* the CFO can invoke when Layer 2 (stated intent) and Layer 3 (behavioural patterns) diverge. No longer the signature feature.
- **"Joy Signal" / verdict taxonomy** — now: the engine inside Layer 3 and Layer 4. Never user-facing language. No verdict labels exposed to users.

The Read is not a separate output type. The CFO produces natural-language insights by combining inputs from five layers.

## The five layers

### Layer 1 — Transactions
What happened. Amount, merchant, date, category.
- **Storage:** `transactions` table (existing)
- **Differentiation:** None — every tool has this

### Layer 2 — Stated Intent (Value Map)
What the user says categories mean to them.
- **Collected:** During onboarding via the Value Map sort (Foundation / Investment / Burden / Leak / Unsure)
- **Storage:** `value_category_rules` (weight 2×, user-confirmed/learned) + `value_map_sessions` + user-confirmed `transactions.value_category` (weight 1×)
- **Accessed by:** `buildUserValueProfile(supabase, userId)` in [src/lib/value-map/value-profile.ts](../src/lib/value-map/value-profile.ts) — returns per-category quadrant share map (3-signal confidence gate)
- **Differentiation:** Most tools don't ask. We do.

### Layer 3 — Behavioural Features
Derived from transactions per merchant or category cluster.
- **Computed by:** `cluster-behaviour/` library (new, Session 32 A), against the `merchant_aggregates` materialized view
- **Five features per cluster:**
  - `recurrence` — median interval, variance, regularity score, pattern label
  - `trend` — 3-month slope, direction (climbing / declining / stable / volatile)
  - `time_pattern` — weekday share, day-of-week distribution, dominant day
  - `amount_profile` — mean, stddev, coefficient of variation, consistency label
  - `lifecycle` — first seen, last seen, dormancy status (active / dormant / new / returning)
- **Accessed by:** `get_cluster_behaviour` tool
- **Coexists with:** [pattern-detectors.ts](../src/lib/analytics/pattern-detectors.ts) — the existing detector library remains for its current use cases; Session D decides what to retire.
- **Differentiation:** Most tools collect the raw data but don't engineer features. **Primary moat.**

### Layer 4 — Conversational Signals
Extracted from chat. What the user said about their own spending.
- **Extracted by:** `chat-signals/` library (new, Session 32 A), hooked into chat post-processing
- **Method:** Pattern matching (regex on regret/enjoyment/context markers) first pass, Haiku LLM fallback for ambiguous cases
- **Storage:** `chat_signals` table (new, Session 32 A)
- **Accessed by:** `get_conversation_signals` tool
- **Differentiation:** Most tools don't have rich chat, or don't mine it. **Second moat.**

### Layer 5 — Goals & Life Context
What the user is trying to do, where they live, age, financial situation.
- **Storage:** `user_profiles` and `goals` tables (existing)
- **Differentiation:** Most tools collect this but treat it as static. We use it as a lens.

## How the CFO uses the layers

The CFO does not pick a layer. It composes from all five available.

A typical CFO response combines:
- Layer 1 → the facts (counts, totals)
- Layer 2 → the user's stated intent for the relevant categories
- Layer 3 → the behavioural shape (trend, recurrence, lifecycle)
- Layer 4 → any prior conversation about the topic
- Layer 5 → the user's goals as the relevance filter

The CFO speaks in natural language. It never names the layers. It never uses internal vocabulary ("verdict", "joy signal", "gap"). It cites specific facts ("climbed 18% over three months", "first appeared in April", "you said dining was a Leak") and asks sharp questions.

## What's deprecated

- [`src/lib/analytics/gap-analyser.ts`](../src/lib/analytics/gap-analyser.ts) — removed in Session D
- The archetype generation pipeline (entire `/onboarding-v2/archetype/` route, `/api/onboarding/generate-archetype`, `regenerate-archetype`, `archetype-prompt`) — removed in Session D after panel testing
- The "Joy Signal" backlog item — closed; mechanics live inside Layer 3 and Layer 4
- The "Read taxonomy" — closed; the Read is never a separate output type
- `analyse_gap` tool, `find_value_gaps` tool — removed in Session D
- `/office/values/the-gap/` route + its 5 components — removed in Session D

## How to add a new layer

Provide:
1. A library exposing one function: `getLayerXForCluster(userId, clusterRef, window) → LayerXShape`
2. A typed schema in `types.ts`
3. A tool registration in `src/lib/ai/tools/get-layer-X.ts`
4. Update this document.

The CFO gains access automatically via the registered tool.
