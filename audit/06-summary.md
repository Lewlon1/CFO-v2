# Phase 6 — Prompt Audit Summary

## Headline

| Metric | Count |
|---|---:|
| Prompt files inventoried | 9 |
| Prompt files read end-to-end | 4 (`system-prompt.ts`, `archetype-prompt.ts`, `folder-prompts.ts`, sampled ~1100 lines of `context-builder.ts`) |
| Prompt files time-boxed for follow-up | 5 (regenerate-archetype-prompt, demo/reading route, value-map/reveal route, chat/route inline fragments, free-text-opener) |
| Total instructions extracted from `system-prompt.ts` | 23 |
| Verdicts on those 23 | Aligned: 10 · Contradictory: 7 · New principle: 4 · Redundant with drift: 2 |
| Constitution gaps surfaced | 8 |

## Top 5 contradictions to resolve (ranked by user impact)

1. **"Mate" vs "professional" persona.** `system-prompt.ts` line 2 says "Talk like a sharp mate". Constitution §1 says "not a friend, not a coach". Every chat turn carries this contradiction. Highest user-impact because it sets the entire voice baseline. **Fix: rewrite line 2 to "Talk like a sharp finance professional who works only for you — warm, direct, no corporate filter."**

2. **Format mandates emoji.** `system-prompt.ts` lines 71–75 require emoji labels on every financial figure. Constitution §2: "do not soften with emoji or exclamation marks." Direct, unambiguous violation. **Fix: remove the emoji-label rule; default to plain-prose figures unless explicitly tabular.**

3. **"Most recent message overrides everything" cancels pushback.** `system-prompt.ts` line 32 tells the CFO to defer to whatever the user just said. Constitution §7 says the CFO must hold ground on factual analytical claims under pushback ("does not capitulate to social pressure"). Fix: scope the override rule to user-data corrections (name, amount, dates, splits), not to analytical disputes.

4. **Sign-off is missing.** Constitution §8 makes "— C." part of the CFO's signature. Zero prompts instruct the model to produce it. The product is shipping without one of its defining tics. **Fix: add to BASE_PERSONA: "Sign off with '— C.' on the first message of a session and on any message delivering a meaningful finding."**

5. **Always-first-person vs "your CFO".** Constitution §2: prefer "your CFO" except for direct opinion. Prompt: "First person singular. Always." Inverted relationship. **Fix: rewrite to: "Use 'your CFO' rather than 'I' when describing what the CFO does, except for direct opinions ('I'd push back on that')."**

## Top 3 constitution gaps to fill

These are *new principles* the prompts already enforce that should be lifted into the constitution to prevent re-introduction:

1. **"Honour the user's exact terms"** — when the user gives a split, date, or amount, use those values verbatim and never round, default, or assume. Found in `system-prompt.ts` line 31. Belongs in §5 or §6.

2. **"Never use 'advice' or 'advise' — say 'guidance', 'suggestion', or just what you'd do"** — enforced in `context-builder.ts:1600` and CLAUDE.md, but absent from the constitution. The constitution itself uses "guidance" once and never bans "advice" explicitly. Belongs in §2 (Voice — phrases never used).

3. **Tangible-comparison framing** — "that's a weekend in Porto every month". Present in `system-prompt.ts` line 6 and CLAUDE.md persona section. The constitution's reference exchanges name actual numbers but don't use this specific framing. Decide: is this a CFO move or a copywriting flourish? If the former, belongs in §2 (Voice).

## Where the prompts and constitution are most aligned

- The **Gap analysis** framing (constitution §5) is well-enforced across `buildPortraitContext`, `buildValueMapCompletePrompt`, and the post-upload Path A prompt. The "name the gap, lead with a number" rule appears in the post-upload prompt and exactly matches canonical exchange §9.E.
- **Boundaries** — the "no product recommendations" rule is enforced consistently in `BASE_PERSONA` (lines 17–20) and the heavy `ADVISORY_BOUNDARIES` block (1100s). Constitution §4 is upheld.
- **Anti-hallucination** — the quotable-facts whitelist in `buildFirstInsightContext` directly enforces §5 "When data is missing". The strictest enforcement in the codebase.

## What gives the "drift" feeling — diagnosis

The CFO persona has drifted in the seams between prompts, not within any single prompt. Each downstream context block adds plausible-sounding instructions ("be encouraging", "open with a friend's warmth", "emoji on each figure", "use options for everything"). Read alone, each is reasonable; read together against the constitution, they pull the persona toward "warm fintech chatbot" instead of "competent CFO".

**The single highest-leverage fix is rewriting `BASE_PERSONA` to derive directly from the constitution**, removing every line that contradicts it, and adding sign-off + localisation + knowledge-hierarchy explicitly. That one file (101 lines today) sets the tone for the other 17 layers.

## Architectural drift to repair

CLAUDE.md "System Prompt Architecture" describes 7 layers. Actual code has 18. Update CLAUDE.md to match — and decide whether 18 is intentional or accumulated cruft. Some of the 18 are conditional (only fire under certain `conversationType` values) so the effective per-turn count is lower, but the maintenance surface is still 18.
