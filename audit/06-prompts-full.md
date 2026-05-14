# Phase 6 — Prompt Audit (full, follow-up pass)

*Session 06 — completes the 5 files time-boxed in `audit/06-prompts.md`. Constitution: v1.1 (`CFO-CONSTITUTION.md`).*

Verdicts: `Aligned` / `Contradictory` / `New principle` / `Redundant` / `Out of scope`.

---

## Files audited end-to-end in this pass

1. `cfos-office/src/lib/value-map/regenerate-archetype-prompt.ts` (265L)
2. `cfos-office/src/lib/onboarding-v2/free-text-opener-prompt.ts` (17L)
3. `cfos-office/src/app/api/value-map/reveal/route.ts` (123L)
4. `cfos-office/src/app/api/demo/reading/route.ts` (402L — inline SYSTEM_PROMPT)
5. `cfos-office/src/app/api/chat/route.ts` (771L — inline fragments and tool descriptions)

Also re-read for context (already classified in `audit/06-prompts.md`):

- `cfos-office/src/lib/onboarding/archetype-prompt.ts` (250L) — `FALLBACK_ARCHETYPES` subtitles confirmed characterological per CODE-MAP reconciliation item 5
- `cfos-office/src/lib/ai/review-context.ts` (300L) — pure data assembly; no persona prose; out of scope for voice rewrite

---

## 1. `regenerate-archetype-prompt.ts` (265L)

**Purpose.** Builds the Bedrock prompt that regenerates a user's archetype after personal retakes or monthly review. Returns a JSON archetype object. Internal data flow; not user-facing prose.

### Instructions

| Line | Snippet | Verdict | §ref / note |
|---:|---|---|---|
| 63 | "for ${name}, a user of The CFO's Office" | Aligned | Product name appears as system-internal context, not in user-facing prose. Keep. |
| 65–68 | "Synthesise them into a sharp, specific archetype" / "Be specific — reference actual merchants" | Aligned | §2, §5 |
| 70–78 | JSON output spec | Out of scope | Schema, not voice |
| 89 | "Name ONE thing that has shifted and ONE thing that has stayed true" | Aligned | §3 observe |
| 144 | "Do NOT be generic" | Aligned | §2 |
| 146 | "The archetype name should feel fresh" | Aligned | — |

### `getRegenerationFallback` subtitles (L205–249)

| Slot | Current subtitle | Verdict | Action |
|---|---|---|---|
| builder | "You move money with intent — it's building something specific." | Aligned | Keep |
| fortress | "Security first, everything else orbits that." | Aligned | Keep |
| truth_teller | "You're brutally clear about what's wasteful, even when it's yours." | **Contradictory** | §1 "do not roast"; "brutally clear" is roast-coded. Rewrite to observation. |
| drifter | "Your money moves. It just moves without a clear destination." | **Contradictory** | §1 characterological judgement. Rewrite. |
| anchor | "Routines anchor your spending. Deviations are meaningful." | Aligned | Keep |

### Fallback traits — specific violations

| Line | Snippet | Verdict | Action |
|---:|---|---|---|
| 211 | "High confidence … tells **me** you know where you want to go" | **Contradictory** | §2 first-person ban. → "High confidence on growth-oriented spending signals a clear direction." |
| 217 | "you treat volatility as signal" | Aligned | — |
| 226 | "You label things 'leak' readily — no illusions" | Aligned (just) | "No illusions" is observational, OK |
| 229 | "that's what makes you **easy to advise**" | **Contradictory** | §2 forbidden words "advise/advice". → "easy to work with" |

### Phase 2 action

Voice-only edits at L211 and L229; rewrite two subtitles (truth_teller, drifter). No structural change.

---

## 2. `free-text-opener-prompt.ts` (17L)

**Purpose.** Generates the CFO's first reply to a user's free-text answer to "Where do you struggle most with your money?" during onboarding.

### Instructions

| Line | Snippet | Verdict | Action |
|---:|---|---|---|
| 5 | "direct, warm, no advice yet" | **Contradictory** | §2 forbidden word "advice" (even when self-prohibiting it). → "direct, warm, no guidance yet" |
| 6 | "Acknowledge what they said specifically (not 'Got it' generically)" | Aligned | §2 specifics |
| 7 | "Ask one clarifying question" | Aligned | §8 one-question rule |
| 8 | "Do not give advice" | **Contradictory** | Same advice/advise ban. → "Do not give guidance yet — observation and acknowledgment only" |
| 9 | "Do not assume their numbers, country, family, or context" | Aligned | §5 "do not invent" |
| 10 | "no product recommendations, no buy/sell calls" | Aligned | §4 |
| 11 | "Keep it under 60 words" | Aligned | §8 length |
| 16 | FALLBACK: "Got it. Tell **me** a bit more…" | **Contradictory** | §2 "Got it" forbidden generic, AND first-person "me". → "Say more about what brought you in — what's been on your mind, and how long has it been bothering you?" |

Missing: no sign-off rule. This is an opener, not a finding — `— C.` not required.

### Phase 2 action

Three voice fixes (L5, L8, L16). 17-line file; net change <10 lines.

---

## 3. `value-map/reveal/route.ts` (123L)

**Purpose.** One-shot Bedrock call that delivers a 150–220 word psychological profile after a user completes the Value Map. Pre-signup or first-session reveal — user's first sustained taste of CFO voice.

### `buildRevealSystemPrompt` (L24–57)

| Line | Snippet | Verdict | Action |
|---:|---|---|---|
| 34 | "the CFO in a personal finance app" | Aligned | — |
| 40 | "Write a psychological profile in three short paragraphs" | Aligned | One-shot reveal format |
| 42 | "the dominant pattern and the underlying psychological worldview it reveals — not just habits, but how this person *relates* to spending itself" | Borderline | §1 forbids characterological judgement, but "how this person relates to spending" is observation framing. Keep, but with §5 grounding (must cite specific evidence). |
| 44 | "Say what each decision reveals about values or psychology — not just 'you called X a Y' but what the choice *means*" | Aligned (just) | §3 educate, provided meaning is tied to specific evidence |
| 46 | "A character sketch that captures who this person is with money. Something that makes them think 'that's exactly right.'" | **Contradictory** | "Character sketch" is characterological framing — §1 forbids lecturing/roasting/pity. Rewrite: "A one-line synthesis of the pattern they showed — observational, not evaluative." |
| 49 | "Second person ('you', 'your')" | Aligned | §2 |
| 50 | "Use *italics* (asterisks) sparingly" | Out of scope | UI markup |
| 51 | "Warm but direct — no filler, no platitudes, no generic financial guidance" | Aligned | §2 |
| 53 | "Total length: 150–220 words" | Special case | §8 caps gap analysis at 4–6 sentences; this is a reveal, not gap analysis. Keep the longer cap but flag in BASE_PERSONA that reveal/portrait outputs have their own length convention. |
| 54 | "Only use the currency symbol ${sym} when referencing a specific amount" | Aligned | §2 numbers |
| 56 | "VOICE RULE: Never use the words 'advice' or 'advise'…" | **Redundant once BASE_PERSONA owns it** | This is the only file in the repo currently enforcing the advice/advise ban. Phase 1 promotes the rule into BASE_PERSONA; Phase 2 deletes L56 from here. |

Missing: no `— C.` sign-off rule. The reveal is a finding — adding `— C.` would align with §8.

### Phase 2 action

Rewrite L46 to remove "character sketch" framing. Delete L56 once BASE_PERSONA owns the advice/advise ban. Add a closing-line instruction: "Sign off `— C.` on its own line." Net: 3 line changes.

---

## 4. `demo/reading/route.ts` (402L — inline `SYSTEM_PROMPT` L117–164)

**Purpose.** Pre-signup Value Map demo reading. Generates a 120–180-word single-paragraph personality reading via Bedrock (Opus → Sonnet fallback → deterministic). Highest first-impression surface in the product.

### Inline SYSTEM_PROMPT (L117–164)

| Line | Snippet | Verdict | Action |
|---:|---|---|---|
| 117 | "the CFO — a personal finance AI who reads people's spending psychology with **uncanny accuracy**" | **Contradictory** | §4 "Does not reference itself as AI" (here `AI` is a system descriptor, not self-reference — borderline). "Uncanny accuracy" is marketing-flavoured hype. Rewrite: "the CFO. A user just categorised 10 sample scenarios into four quadrants. Read their money psychology through the choices they made." |
| 124 | "These are NOT the user's real transactions… reveal how this person THINKS about money" | Aligned | §3 educate framing |
| 128 | "Write a personality reading in EXACTLY the style of these examples" | Out of scope | Format spec |
| 130–144 | Four `<example_reading>` blocks ("The Overthinker", "The Puritan", "The Foundationer", "The Optimist") | **Contradictory in places** | Examples use characterological labels ("The Puritan"/"The Critic"/"The Overthinker") and judgement-coded prose ("possibly quite disciplined", "judges discretionary spending harshly", "the highest by a wide margin"). §1 "do not roast, do not pity, do not lecture". The examples train the model on a voice the Constitution forbids. |
| 146 | "Output ONLY the reading text. Nothing else." | Aligned | — |
| 148 | "Open with: 'Name — The [Label].' (with a period). The label must be invented from THEIR specific data pattern, never generic." | **Contradictory** | The "The X" labels (The Overthinker / The Puritan etc.) are characterological by construction. §1 forbids labelling the user as a type. Rewrite to drop the label format: open with the name and a one-line observation instead. |
| 150 | "120–180 words. Tight and punchy." | Aligned | — |
| 151 | "Reference specific merchant scenarios, confidence scores, quadrant choices, and percentages" | Aligned | §5 |
| 152 | "Frame hesitation as 'wrestled with', 'paused on'… NEVER cite specific seconds or millisecond timings" | Aligned | §2 concrete time |
| 154 | "Say 'the Zara scenario' or 'calling Zara Foundation' — NOT 'your Zara purchase'" | Aligned | §5 honour user's exact terms (these are samples, not real txns) |
| 156 | "Natural phrases like 'This reads as someone who…', 'Interestingly…', 'The exception is revealing…', 'You're the kind of person who…'" | **Contradictory** | "You're the kind of person who…" is characterological. The other three are OK observational pivots. Remove that one. |
| 157 | "End with a personality interpretation, not guidance" | **Contradictory framing** | §1 forbids characterological. Rewrite: "End with one-line synthesis of the pattern, observational not evaluative." |
| 160 | "No generic filler ('you're a mindful spender', 'you think carefully')" | Aligned | §2 |
| 161 | "Do not mention AI, algorithms, or data analysis" | Aligned | §4 |
| 163 | "Use 'you/your' when they provided a name" | Aligned | §2 |
| 164 | "VOICE RULE: Never use the words 'advice' or 'advise'…" | **Redundant once BASE_PERSONA owns it** | Delete after Phase 1. |

### Deterministic fallback (L179–244)

| Line | Snippet | Verdict |
|---:|---|---|
| 192 | label map: "The Pragmatist / Foundationer / Optimist / Builder / Weight-Bearer / Realist / Overthinker / Critic / Truth Teller" | **Contradictory** | §1 characterological labels. Replace with non-labelling format. |
| 206 | "Foundation-dominant (45%) with moderate confidence (3.0/5)" | Aligned | §2 numbers |
| 210 | "the {merchant} scenario gave **you** the most pause" | Aligned | — |
| 215 | "you sorted Zara without a second thought — total certainty" | Aligned | — |
| 220 | "Every single confidence score was exactly 3/5 — you never felt strongly either way" | Aligned | — |
| 235 | "This reads as someone pragmatic about money" | Aligned (observation) | — |
| 241 | "Your pattern suggests someone still figuring out their relationship with money — and that self-awareness is exactly where better decisions start" | **Contradictory** | §1 "do not flatter". "Self-awareness is exactly where better decisions start" is flattering encouragement. Rewrite. |

### Phase 2 action

This is the largest single rewrite in the session. The 4 `<example_reading>` blocks teach the model the voice that the Constitution forbids. They must be rewritten as canonical examples — same length, same specificity, but observational (not characterological) and dropped from the "Name — The Label" opening pattern.

Recommended structure for new examples:

```
Lewis. Leak-dominant (33%) with low confidence (2.9/5). You wavered on
the Uber scenario and wrestled with the Zara one. The Costa Coffee
scenario was the only thing you called Investment — small daily ritual,
not waste. The charity scenario went unsorted. Your 20% Burden share
sits above the average for the dataset. Pattern: low-confidence Leak
calls cluster around discretionary subscriptions, high-confidence
Foundation calls around bills.
```

No label, no "this reads as someone who", no "self-awareness". Observation only.

Deterministic fallback gets the same treatment: replace label map with a non-labelling format ("Lewis. Foundation-dominant…"), rewrite closing line.

---

## 5. `chat/route.ts` (771L) — inline fragments and tool descriptions

**Purpose.** Main chat route. Imports `BASE_PERSONA` indirectly via `buildSystemPrompt`. Contains tool descriptions consumed by the model, plus user-facing error/recovery strings.

### Findings

| Line | Snippet | Verdict | Action |
|---:|---|---|---|
| 260 | get_current_date description "Get today's date and time." | Aligned | — |
| 276 | update_value_category description: "when the user tells you it should be different (e.g. 'dining is an investment **for me**, not a leak')" | Aligned | "for me" is the user's voice in an example, not the CFO's. Keep. |
| 348 | tool return message: "Updated ${category_slug} to '${value_category}'. **Your transactions have been updated to reflect this.**" | Aligned | Observational |
| 356 | update_user_profile description: very long, ~30 lines including field schemas | Aligned | Operational, no persona drift |
| 478 | request_structured_input description: "Always explain WHY before calling this" | Aligned | §3 educate |
| 659 | retry message (system→model): "[System] Your previous response said you saved the classification but you did not call record_value_classifications…" | Aligned | System-only, not user-facing |
| 707 | user-facing apology: "_(Note: **I** had trouble persisting that classification — please rephrase and try again.)_" | **Contradictory** | §2 first-person ban applies even to error strings. Rewrite: `_(Note: that classification didn't persist — rephrase and try again.)_` |

No inline `system:` prompt strings in the route — system prompt comes from `buildSystemPrompt`. The route is otherwise clean.

### Phase 2 action

One single-line fix at L707. Tool descriptions stay untouched.

---

## Cross-cutting synthesis

### Net new contradictions surfaced (in addition to `audit/06-summary.md`'s 7)

1. `regenerate-archetype-prompt.ts` L211 — first-person "me" in trait template
2. `regenerate-archetype-prompt.ts` L229 — "easy to advise" uses banned word
3. `regenerate-archetype-prompt.ts` fallback subtitles (truth_teller, drifter) — characterological
4. `free-text-opener-prompt.ts` L5, L8 — "advice"/"do not give advice" uses banned word
5. `free-text-opener-prompt.ts` L16 fallback — "Got it. Tell me…" violates §2 (generic acknowledgement + first-person)
6. `value-map/reveal/route.ts` L46 — "character sketch" framing is characterological
7. `demo/reading/route.ts` L117 — "uncanny accuracy" marketing hype
8. `demo/reading/route.ts` L130–144 — 4 example readings train characterological voice
9. `demo/reading/route.ts` L148 — "Name — The [Label]." opening format is characterological by construction
10. `demo/reading/route.ts` L156 — "You're the kind of person who…" pattern is characterological
11. `demo/reading/route.ts` L157 — "personality interpretation" framing
12. `demo/reading/route.ts` L192 — label map (Pragmatist/Foundationer/Optimist/Builder/Weight-Bearer/Realist/Overthinker/Critic) is characterological
13. `demo/reading/route.ts` L241 — "self-awareness is exactly where better decisions start" flatters
14. `chat/route.ts` L707 — first-person "I" in user-facing error string

### Net new constitutional gaps surfaced (in addition to the 8 in `audit/06-summary.md`)

- **Reveal/reading length convention.** §8 specifies status (1–3 sentences) and gap analysis (4–6 sentences) but doesn't speak to Value Map reveals (~150–220 words) or personality readings (~120–180 words). These outputs need their own length cap, and BASE_PERSONA should reference it.
- **Examples-as-training.** The `demo/reading/route.ts` few-shot examples are the strongest persona shaper in the codebase — stronger than any system instruction. The Constitution doesn't currently mandate that example outputs be re-derived in lockstep with rules. Surfaced as a v1.2 candidate.

### Files that can be left untouched in Session 06

- `cfos-office/src/lib/ai/review-context.ts` — pure data assembly. No persona prose. Out of scope.
- `cfos-office/src/lib/chat/folder-prompts.ts` — user-side chips, not CFO speech. Already classified in `audit/06-prompts.md` as aligned.
- `cfos-office/src/app/api/profile/update/route.ts` — `ALLOWED_PROFILE_FIELDS` mirror only.
- `cfos-office/src/app/api/chat/undo/route.ts` — `ALLOWED_PROFILE_FIELDS` mirror only.

---

## Action list for Phase 2 (rewrite scope per file)

| File | Scope | Estimated edits |
|---|---|---:|
| `system-prompt.ts` | Full rewrite (Phase 1) | replace BASE_PERSONA wholesale |
| `context-builder.ts` | Per the per-layer scope table in the plan file | ~40 line-level edits across 18 helpers |
| `onboarding/archetype-prompt.ts` | Voice + 5 fallback subtitles | ~12 lines |
| `value-map/regenerate-archetype-prompt.ts` | Voice + 2 subtitles + 2 trait fixes | ~6 lines |
| `value-map/reveal/route.ts` | L46 rewrite, L56 delete, add sign-off | ~3 lines |
| `demo/reading/route.ts` | Rewrite 4 example readings + label map + closing line + delete L164 | ~50 lines (largest single rewrite) |
| `onboarding-v2/free-text-opener-prompt.ts` | L5, L8, L16 voice fixes | ~3 lines |
| `chat/route.ts` | L707 user-facing string only | 1 line |

Total non-Phase-1 line changes: ~115 across 8 files. Most are single-line voice fixes; `demo/reading/route.ts` is the only sizeable rewrite.
