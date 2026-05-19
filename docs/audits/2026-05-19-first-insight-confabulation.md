# First-insight confabulation — "subscription audit last ran as an open proposal already"

**Date:** 2026-05-19
**User:** Carlos (staging — `74bdefdb-0831-4821-b354-b93461f50a94`)
**Conversation:** `e556070b-b6d0-4122-83f2-9e07d4d3e4f3` (`first_insight`, V1 path)
**Status:** Known issue. No fix shipped. Re-evaluate if it recurs.

## The hallucination

In the wow-moment narration, the model wrote:

> "But 23 lines is a lot of surface area for things that crept in quietly. **A subscription audit last ran as an open proposal already — worth acting on.**"

No subscription audit had ever been suggested to this user in the system's records. The phrasing is invented continuity.

## What was actually in the prompt

The V1 first_insight assembly (`context-builder.ts:1127`) builds the system prompt from:

1. `BASE_PERSONA`
2. `buildCurrentDateContext()`
3. `buildFirstInsightContext(payload)`
4. `getConversationInstructions('first_insight', …)`
5. `buildToolUsageInstructions()`
6. `getPosturePromptFragment(profile)`

Audited the payload directly:

```
mentions_subscription: false
mentions_audit: false
experiment_proposal.primary.template_id: redirect_windfall_to_goal
experiment_proposal.primary.title: "Move a fixed amount toward your goal on payday"
```

`buildExperimentContext` (which DOES surface "Open proposals" from `proposed_experiments`) is only called on the general non-first-insight path (`context-builder.ts:1154`). It is NOT in the first_insight assembly.

## Why the model could have known

It couldn't. Server-side, `insight-engine.ts:185` calls `recentlyProposedTemplateIds` and excludes `subscription_audit` from the candidate ranking because Carlos's prior conversation had already proposed it. So `redirect_windfall_to_goal` wins at score 0.94. The model is never told `subscription_audit` exists.

The phrase is pure confabulation — the LLM combined "23 recurring bills" + the closing-experiment instruction and invented a backstory to bridge them.

## Why we are not fixing it now

- One occurrence in staging.
- The two viable fixes both have costs:
  - Prompt-side guardrail ("no prior turns") grows the prompt without strong evidence it generalises.
  - Validator-side phrase-match (`previously`, `last time`, `I suggested`, `open proposal`) catches false positives in legitimate continuity utterances elsewhere.
- Carlos's underlying numbers were correct; the rest of the narration was grounded. The hallucination is cosmetic, not corrupting.

## Triggers for revisiting

- Same pattern in a production user's first_insight.
- Same pattern in a different conversation type (would imply the model has a stable failure mode, not a fluke).
- A user complaint or screenshot referencing "previously suggested" content they don't remember.

If any of these fire, the cheapest first move is a validator-side phrase match scoped to `first_insight` outputs only — same-turn cost, no prompt growth.
