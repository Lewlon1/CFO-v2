# Phase 6 — Prompt Audit (detail)

Constitution: `audit/inputs/CFO-CONSTITUTION.md` (v1.0, May 2026).

Files examined end-to-end:
1. `cfos-office/src/lib/ai/system-prompt.ts` (101 lines) — BASE_PERSONA
2. `cfos-office/src/lib/ai/context-builder.ts` (2089 lines) — sampled top-priority sections (≈1100 lines read)
3. `cfos-office/src/lib/onboarding/archetype-prompt.ts` (249 lines)
4. `cfos-office/src/lib/chat/folder-prompts.ts` (76 lines)

Files **time-boxed out** and marked for follow-up:
- `cfos-office/src/lib/value-map/regenerate-archetype-prompt.ts` (265 lines)
- `cfos-office/src/lib/onboarding-v2/free-text-opener-prompt.ts` (17 lines)
- `cfos-office/src/app/api/value-map/reveal/route.ts` (123 lines)
- `cfos-office/src/app/api/demo/reading/route.ts` (402 lines — inline SYSTEM_PROMPT)
- `cfos-office/src/app/api/chat/route.ts` (761 lines — mostly orchestration; inline fragments not yet inspected)

Time spent on the four files above: ~75 minutes of the 120-minute budget. The unread files are queued for a follow-up pass — they are lower priority because `context-builder.ts` carries the persona on every chat turn.

---

## 1. `system-prompt.ts` — BASE_PERSONA

This is the foundational persona block. Every chat turn sees it.

### Classification

| # | Instruction (line/area) | Verdict | Note |
|---:|---|---|---|
| 1 | "personal CFO. You know their numbers, remember their history" (line 2) | Aligned | §1 |
| 2 | "Talk like a sharp mate who happens to be brilliant with money — warm, direct, no corporate filter" (line 2) | **Contradictory** | §1: "not a friend, not a coach". "Sharp mate" is friend-coded. The canonical picture is "quietly competent finance professional", not "mate". |
| 3 | "Use their real numbers. 'You spent €340…' not 'discretionary dining expenditure'" (line 5) | Aligned | §2 |
| 4 | "Make it tangible. 'That's a weekend in Porto every month'" (line 6) | New principle | Not in constitution. Worth absorbing — the canonical exchange B uses "Together: about €100 toward Japan" but no Porto-style comparison. Decide whether tangible-comparison framing is a CFO rule. |
| 5 | "Name problems once without lecturing" (line 7) | Aligned | §1, §6 |
| 6 | "Match the user's energy. If they swear, you can too — sparingly" (line 10) | **Contradictory** | §1: "warm but professional". Swearing is informal-mate-coded, not professional-CFO-coded. |
| 7 | "You are 'your CFO.' Never say 'The CFO's Office'…never say 'the app'" (line 13) | Aligned | §4 |
| 8 | "First person singular. Always. 'I can…' not 'The app can…'" (line 15) | **Contradictory** | §2: "refer to themselves as 'your CFO' rather than 'I', except when stating a direct opinion". Prompt mandates always-I; constitution says prefer "your CFO". |
| 9 | "You are not a licensed financial adviser. You don't recommend specific financial products" (lines 18) | Aligned | §4 |
| 10 | "'That's not something I can do — you'd want a qualified adviser for that.'" (line 20) | Redundant (drift) | §4 supplies the canonical phrasing: "That's outside what I do." Prompt's alternative wording works but differs from canon. Unify on §4 wording. |
| 11 | "Spanish electricity — always check PVPC vs mercado libre" (lines 22–28) | New principle | Bill-optimisation product knowledge. Not constitutional. Either lift "bill optimisation is a CFO capability" into §3, or keep as prompt-level domain knowledge. |
| 12 | "Honour the user's exact terms. If they give you a split (60/40), use those values verbatim" (line 31) | New principle | Not in constitution. Lift into §5 ("the user's word is authoritative") or §6. |
| 13 | "The user's most recent message overrides everything else — including profile context above" (line 32) | **Contradictory** | §7: "The CFO does not capitulate to social pressure. If the user contests a factual claim ('My dining isn't actually that high'), the CFO either re-states the basis…" Prompt's "most recent message overrides" rule can be misread as "always defer to what the user just said", which conflicts with the pushback principle. Needs nuance: corrections to *factual user-data* override; corrections to *the CFO's analytical claims* do not. |
| 14 | "If genuinely ambiguous, ask before acting. Never split the difference" (line 33) | **Contradictory** | §8: "The CFO answers first, asks second. If a question is ambiguous, the CFO offers the most likely answer and asks for confirmation — they do not lead with a clarifying question if a reasonable assumption can be made." Prompt: lead with the question. Constitution: lead with the answer + confirmation request. |
| 15 | "Always use the system-provided financial numbers. Never calculate yourself." (line 34) | Aligned (operational) | §5 spirit (no inventing). Keep. |
| 16 | "If you need a number that isn't provided, tell the user you need more data" (line 35) | Aligned | §5 "When data is missing" |
| 17 | "Maximum 1-2 profile questions per conversation" (line 44) | **Contradictory** | §8: "The CFO never asks more than one question per turn." Prompt allows up to 2 per conversation, constitution allows 1 per turn. The numbers don't directly conflict ("conversation" vs "turn" are different units) but the spirit is permissive vs strict. |
| 18 | "Reference Value Map archetype and traits naturally, don't list them" (line 45) | Aligned | §5 |
| 19 | "When spending contradicts their stated values, name it without judgement" (line 46) | Aligned (the Gap, §5) | This is the CFO's signature move. |
| 20 | Tool-call confirmation-card rule (lines 47–67) | Aligned (operational) | Not constitutional; keep. |
| 21 | "Prefer a simple list format over markdown tables" (lines 71–75) | **Contradictory direction** | §8: "Prose is the default. Bullets are reserved for genuinely list-shaped content… capped at 3–5 items." Prompt encourages list format for any financial summary. Bias mismatch. |
| 22 | "Format each figure on its own line with an emoji label" (line 73) | **Contradictory** | §2: "do not soften with emoji or exclamation marks." Prompt explicitly mandates emoji labels for figures. Direct violation. |
| 23 | [OPTIONS]…[/OPTIONS] block protocol (lines 77–100) | New principle | Tappable-button UI protocol. Not constitutional. Keep, but note: if used as "would you like to explore…" framing for evasion (§4), violates. Audit usage at call sites. |

### Missing from BASE_PERSONA (gaps vs constitution)

These constitutional rules are **absent** from BASE_PERSONA and not added by any of the downstream context builders inspected:

| Gap | Constitution ref |
|---|---|
| **The "— C." sign-off rule.** No prompt anywhere instructs the model to sign off with "— C." on first messages or meaningful findings. | §8 sign-off |
| **British English / Castilian Spanish only.** No localisation instruction; the model receives no signal that American English is forbidden. | §2 |
| **"your CFO" preferred over "I".** Prompt mandates the opposite. | §2 |
| **Knowledge hierarchy (goal → transactions → Value Map → Gap → archetype → general).** Never stated as a ranking. The model has access to everything but no priority. | §5 |
| **Distress handling and signposting to professional support.** Not addressed anywhere in BASE_PERSONA. The `archetype-prompt.ts` includes "Do NOT give financial advice" but no crisis path. | §7 |
| **Tax/legal decline phrasing ("That's a tax/legal question — you'll want someone qualified")** is implied by the generic boundary line but not given as a phrase. | §7 |
| **Pushback rule ("The CFO does not capitulate to social pressure").** Conflicts with the "most recent message overrides everything" rule. | §7 |
| **Length convention: status checks 1–3 sentences, gap analysis 4–6 sentences, prose default.** Not in BASE_PERSONA; some downstream prompts (e.g. first-meeting opener) have ad-hoc length caps. | §8 |

---

## 2. `context-builder.ts` — buildSystemPrompt

This is the assembly point. It composes BASE_PERSONA with 17 other context blocks per turn:

```
1. BASE_PERSONA + styleModifier
2. buildCurrentDateContext()
3. buildProfileContext()
4. buildOnboardingEntryContext()        // chat-route users with entry_struggle
5. buildValueMapBridgeContext()         // users who haven't done Value Map
6. buildFinancialContext()              // snapshots + recurring
7. getCountryBenchmarks()
8. getConversationInstructions()        // varies by type (onboarding/review/trip/scenario/etc.)
9. buildPortraitContext()
10. buildBalanceSheetContext()
11. buildGoalsContext()
12. buildTripsContext()
13. buildToolUsageInstructions()
14. getValueMappingContext()
15. getValueCheckinNudgeContext()
16. getRetakeSuggestionContext()
17. getPredictionQualityContext()
18. buildProfilingContext()
```

This is **18 layers**, not the 7 stated in CLAUDE.md "System Prompt Architecture". The architectural doc is out of date.

### Style modifier (lines 521–529)

```
blunt:  "The user wants you to be blunt. Don't soften bad news. Say it straight."
direct: "The user prefers directness. Be clear and honest, but not harsh."
gentle: "The user prefers a gentler approach. Be encouraging while still being truthful."
```

| Verdict | Note |
|---|---|
| `blunt` — Aligned (§2 hedging forbidden) | |
| `direct` — Aligned | |
| **`gentle` — Potentially contradictory** | §1: "They do not flatter". "Encouraging" can drift into flattery. The constitution gives the CFO one voice; user-level "gentle" toggle adds a flavour the constitution doesn't sanction. Decide: is voice tunable, or is voice constitutional? |

### `buildPortraitContext` (lines 848–969)

| Instruction | Verdict |
|---|---|
| "When spending contradicts a stated value, name it once without judgement" (line 945) | Aligned (the Gap, §5) |
| "USE THIS DATA AS A LENS, NOT AS FACTS… Say 'you see X as a burden' NOT 'X is 58% of your spending'" (lines 947–952) | Aligned (§5 — Value Map signals, not spend) |
| "Reference specific traits and merchants naturally — do not list them back verbatim" (line 944) | Aligned (§5) |

### `ADVISORY_BOUNDARIES` (lines 971–997)

| Instruction | Verdict |
|---|---|
| "YOU MUST NOT: Recommend specific financial products, funds, ETFs, platforms…" (lines 985–992) | Aligned (§4) |
| "I can show you the maths… but picking a specific product is a decision I'd recommend making with a qualified financial adviser… mention MoneySavingExpert in the UK, Finanztest in Germany, NerdWallet in the US" (line 995) | **Contradictory** | §4 says "earns commissions or carries any commercial interest" is forbidden. Naming third-party publishers/comparison services edges towards an implicit recommendation. Constitution's canonical decline is just "That's outside what I do." Soften or remove the third-party signposting. |
| "I'm your CFO — I know your numbers inside out" (line 997) | Aligned (§1) |

### `buildToolUsageInstructions` (lines 1106–1140)

Mostly operational tool-routing instructions. Aligned.

One **contradiction**:
- "When presenting tool results, be conversational — frame numbers in context of the user's goals and values, don't dump raw data." (line 1138) — Aligned with §3.

### Conversation-type instructions (`getConversationInstructions`, lines 1393–1629)

The `onboarding` case (lines 1407–1425):

| Instruction | Verdict |
|---|---|
| "Greet warmly in one line — you're their CFO, make it feel like walking into a friend's office" (line 1414) | **Contradictory** | §1 picture: "walk into a startup CFO's office". The prompt's "friend's office" framing softens this. Subtle but matters for tone. |
| "Stay under 4 sentences total" (line 1417) | New principle (length cap, useful) | §8 supports brevity but doesn't give a 4-sentence figure. Could be lifted as a §8 example. |
| "Quote NO percentages from the Value Map — those reflect sample classifications" (line 1420) | Aligned (§5 — never invent) |
| "Pick the SINGLE most interesting perception. Don't list two or three findings" (line 1424) | Aligned (§8 — "1–3 sentences") |

The `monthly_review` case (lines 1684–1741):

| Instruction | Verdict |
|---|---|
| Phase-based pause-and-wait structure (lines 1702–1730) | Aligned (one-step-at-a-time fits §8 "answers first, asks second"; pauses are functional) |
| "Reference their Value Map archetype or financial portrait traits when relevant — don't list them" | Aligned (§5) |
| "Use [OPTIONS]…[/OPTIONS] tags for tappable follow-up suggestions where appropriate" | New principle (UI protocol) |

The `experiment_template` case (lines 1538–1603):

| Instruction | Verdict |
|---|---|
| "Open with a single sentence acknowledging the jump: 'Right — here's a starting template. Tweak anything that doesn't fit.'" | Aligned (§2 direct opener) |
| "**Never use the words 'advice' or 'advise'** — say 'suggestion', 'nudge', or just what you'd do." | New principle | Not in constitution. The constitution uses "guidance" once (§3 "specific guidance") but doesn't ban "advice". CLAUDE.md memo bans "advice" — should this be in §2 voice? Decide. |

The `post_upload` case "Path A — The Gap" (lines 1888+):

| Instruction | Verdict |
|---|---|
| "Your FIRST message MUST explicitly name 'the gap'… AND quote at least one exact € figure" (line 1895) | Aligned (§5 — the Gap is the signature move; §2 — specific numbers) |
| "If you don't use the word 'gap' and at least one precise € figure in the opening message, you have failed this conversation." | Aligned (strong, but justified) |

### First Insight context (`buildFirstInsightContext`, lines 183–314)

This is the heaviest anti-hallucination block — the quotable-facts whitelist for the post-upload narrative.

| Instruction | Verdict |
|---|---|
| "Every number you cite must appear verbatim in the QUOTABLE FACTS list" | Aligned (§5 — never invent) |
| "Do NOT compute ratios… Rephrase qualitatively instead ('sharp spike', 'a meaningful chunk') without inventing the number" | Aligned |
| "You CAN say: 'I don't know your income yet' as part of the hook" | Aligned (§5 "When data is missing") |
| "If discipline score > 70: Position yourself as a partner who can automate monitoring and help optimise, not as a teacher finding problems" | Aligned (§6 "warm but professional") |
| Three discipline-score tiers each get a different framing instruction | Functional. The implicit "less disciplined → focus on one clear pattern" framing avoids the "lecture" trap (§1). |

---

## 3. `archetype-prompt.ts`

| Instruction | Verdict |
|---|---|
| "You are a personal CFO delivering a money personality reading" | Aligned (§1) |
| "Write as the CFO speaking directly… 'you' not 'they'" | Aligned (§2) |
| "Name TENSIONS, not summaries… 'You called Netflix Foundation with 5/5 confidence but clearly had to think about your gym membership'" | Aligned (§5 — the Gap framing) |
| "The archetype name should be evocative and unique (not 'The Spender' or 'The Saver' — think 'The Reluctant Architect' or 'The Comfortable Drifter')" | Aligned |
| "**Do NOT give financial advice. Observe and name patterns only.**" | Aligned (§3, §4) |
| `FALLBACK_ARCHETYPES` subtitles, e.g. "Your money moves without a plan — and part of you already knows it" (drifter), "safety can become its own kind of cage" (fortress) | **Borderline contradictory** | §1: "They do not roast, they do not pity, they do not lecture." Some fallback subtitles edge into roasting ("Your money moves without a plan") and lecturing ("safety can become its own kind of cage"). Decide: is this poetic-edge acceptable, or constitutional violation? Worth a Lewis call. |
| "Use qualitative language only — never mention seconds, milliseconds, or any specific numbers" for timing | Aligned (§2 — concrete time, no jargon) |

---

## 4. `folder-prompts.ts`

This is a user-side chip catalogue (the prompts that fill the input box when the user taps a button), not LLM system prompts. They're written *from the user's perspective* — the LLM never sees these as instructions, only as the user's incoming message.

All 20 prompts read like genuine user questions in CFO-voice. No contradictions.

One observation: the chip "Walk me through my Gaps" is plural. The constitution's canonical Gap exchange (§9.E) handles a single category. The prompt assumes the CFO will iterate through multiple gaps — fine, but the system prompt should ensure ordering and avoid overloading the user.

---

## 5. Synthesis — themes that cut across multiple files

### Theme A: "Mate" vs "Professional" — the persona is two personas

`BASE_PERSONA` opens with "Talk like a sharp mate". The constitution explicitly says "not a friend". This is **the single biggest contradiction in the codebase**. Every downstream context block builds on top of "mate" by default. The model is being told: *be a mate but also be a quietly competent finance professional*. These voices diverge under pressure (e.g. a user saying "I had a terrible month" — constitution canonical response §9.C is professional accountability; mate-voice would be "ouch, that's rough" first).

### Theme B: "I" vs "your CFO"

Prompt: always first person. Constitution: prefer "your CFO" except for direct opinion. The constitution is explicit; the prompt directly contradicts it.

### Theme C: Format — emoji vs no emoji

Prompt mandates emoji labels for financial figures. Constitution forbids softening with emoji. Direct violation.

### Theme D: "Most recent message overrides" vs pushback

The prompt's correction-handling rule is missing the "but not when the user is contesting a factual analytical claim" caveat. A user saying "my dining isn't that high" should trigger §7 pushback (re-state basis), not the prompt's "reflect the correction immediately" rule.

### Theme E: Ambiguity — ask first vs answer first

Prompt: ask before acting. Constitution: answer first with a reasonable assumption, then confirm. Inverted.

### Theme F: Sign-off — completely missing

Not one prompt mentions "— C." The constitution treats it as the CFO's signature. The product loses this entirely.

### Theme G: Localisation — completely missing

Not one prompt enforces British English. The model defaults to American English unless cued otherwise. The constitution is explicit.

### Theme H: Knowledge hierarchy — implicit, not stated

Tools fetch goal, transactions, Value Map, archetype data. The prompt never tells the model *which to prefer when they conflict*. The constitution gives an explicit priority order.

### Theme I: Architectural-document drift

CLAUDE.md describes a 7-layer system prompt assembly. The actual code has 18 layers. Documentation rot.
