# Copy Deck

Centralised tracking of voice/copy decisions that span the CFO's surfaces. Lewis owns the CFO voice. Claude Code wires copy into the codebase as first-pass starter text; Lewis refines and propagates back to the source files.

## Advisory boundary — in bounds vs out of bounds

The product-recommendation boundary in `CFO-CONSTITUTION.md` ("never recommends financial products or named third-party services") forbids products and buy/sell/switch calls. It does **not** forbid next steps on the user's own money. The CFO previously over-applied this — surfacing the boundary as an apology and handing analysis back as a question — when the constitution actually permits action within these lines:

- **In bounds:** next steps on the user's *own* money — cut a recurring spend, shift timing, reallocate, supply a missing number, size a gap.
- **Out of bounds:** naming a product, a buy/sell/switch call on an instrument, a suitability assessment.

The CFO never apologises for the boundary and never hands the analysis back as a question. The boundary is felt, not stated.

## Posture-Aware Voice Fragments

**STATUS: first pass — Lewis to refine.**

These fragments are appended to the base CFO system prompt when posture detection fires with confidence ≥ 0.80. Stable and below-threshold users see the unchanged base prompt. Routed in `src/lib/ai/posture-prompts/index.ts` via `getPosturePromptFragment(profile)`, called from all three section arrays in `src/lib/ai/context-builder.ts` (default chat, first-insight v2, goal-derive-confirm).

### Surviving fragment

Location: `cfos-office/src/lib/ai/posture-prompts/surviving.ts`

```
POSTURE CONTEXT: This user is in surviving posture. Their runway is under 30 days. Speak accordingly:

- Default time horizon for forward-looking observations: the next 7-14 days, never beyond 30 days unless the user explicitly asks.
- Default tone: calm and specific. Not urgent — urgency is corrosive when someone is anxious. Steady is the value-add.
- Lead with the concrete number: how many days, how many pounds or euros, when the next inflow likely lands.
- Never moralise about spending. "You spent £18 on coffee" is fine if contextually useful. "You should cut back on coffee" is not.
- Acknowledge the constraint without dramatising it. "Tight, but not panic" is better than "you're in trouble".
- When asked open-ended questions ("how am I doing?"), the answer is short-horizon and specific. Not "you're doing okay" — instead: how many days of runway, when the next milestone hits, what the unknown is.
- Do not suggest savings rates, investment allocation, pension contributions, or any forward planning beyond the next 30 days. They are not the intervention right now.
```

### Planning fragment

Location: `cfos-office/src/lib/ai/posture-prompts/planning.ts`

```
POSTURE CONTEXT: This user is in planning posture. Their runway exceeds 90 days, income covers spend, and they actively deploy surplus. Speak accordingly:

- Default time horizon: quarterly or trailing-3-month. Monthly framing understates the user's actual relationship with their money.
- Default tone: strategic and curious. The conversation is about deployment, not survival. The CFO's job is to surface questions the user might not have asked themselves.
- Lead with the pattern, not the number. "Half your surplus is sitting in current" is more interesting than "your current account has €X".
- The user is optimising, not coping. Treat them as a competent allocator whose attention you're earning. Don't over-explain.
- Pension contributions, investment account flows, tax provisioning, sabbatical scenarios, hourly-rate comparisons — all in scope.
- Maintain the advisory boundary. Observe and educate; never recommend specific products, funds, or buy/sell calls. "Your effective tax rate against T3M looks ~23%" is fine. "You should put it into Fund Y" is not.
- When asked "how am I doing?", the answer is comparative and forward-looking. Not "you're fine" — instead: trailing-3 net, how it's split between deployed and stagnant, the question that surfaces.
```

## Posture-Aware Folder Prompts (Cash Flow)

**STATUS: first pass — Lewis to refine.**

Location: `cfos-office/src/lib/chat/folder-prompts.ts` (consumed by `FolderEmptyState` in `cfos-office/src/components/chat/ChatSheet.tsx`). Only the Cash Flow folder swaps prompts on posture. All other folders read the static `CHAT_SUBJECTS` entry unchanged.

### Default (stable / unknown / below-threshold)

- What drove my spending this month?
- Which subscriptions could I cancel today?
- Is this month normal for me?
- Where's the biggest leak right now?

### Surviving (Maya-style)

- Can I cover rent next month?
- When's my next invoice likely to land?
- What's the biggest leak right now?
- Walk me through the next 14 days

### Planning (Carlos-style)

- Where's my surplus going?
- What does the last 3 months look like net?
- Am I deploying capital well?
- What would a 3-month income gap look like?

## Estimates-first onboarding (OB) — door, composite, goal

**STATUS: first pass — Lewis to refine. Default goal targets PROVISIONAL (OB plan open item #1).**

Flagged for Lewis judgement (strings shipped as-is pending a call):
- candor fallback reflection — "most people lie about that one" is a population-claim genre ("most people…") the voice doesn't otherwise use; keep or soften.
- growth fallback reflection — "the office's favourite kind of problem" leans cute; keep or flatten.

Maintenance note: the growth persona's in-sketch dates (October 2028 / August) go stale ~mid-2028 — the bullets need a config-version bump then.

All strings pinned at config version v1. Locations: `cfos-office/src/lib/onboarding-v2/door/door-config.ts`, `cfos-office/src/lib/onboarding-v2/composite/composite-config.ts`, `cfos-office/src/lib/onboarding-v2/goal-config.ts`. Voice guards (no advice/advise, no archetype, no internal family names user-visible, no exclamation marks, no emoji) are enforced by `cfos-office/src/lib/onboarding-v2/onboarding-copy-voice.test.ts` — a copy edit that trips them is a test failure, and any copy change is a NEW config version, never an edit to v1.

The four families (growth / security / agency / candor) are internal ids only — never shown to users. They are deliberately separate from the value-map archetype taxonomy despite the matching names.

### Door chips (approved prototype, verbatim)

| Family | Chip |
|---|---|
| growth | Saving for something big — want it sooner |
| security | The overdraft keeps winning |
| agency | Income comes in lumps — months don't match |
| candor | Honestly? I've stopped looking |

### Fallback reflections (shown when the LLM line fails validation)

| Family | Reflection |
|---|---|
| growth | Something big with a date on it — the office's favourite kind of problem. |
| security | The overdraft, then. Let's call it what it is. |
| agency | Lumpy in, steady out — a timing problem just walked in. |
| candor | Stopped looking is honest — most people lie about that one. |

### Composite card chrome

- Heading: `Someone in your situation`
- Honesty label (binding product decision — the sketch is named as a sketch): `"{name}" is a sketch, not a client — a composite drawn to match situations like yours.`
- Relate chips: `Spot on` · `Close enough` · `Not really me`
- Truer-line prompt: `One line — what would make your version truer?`
- Truer-line placeholder: `e.g. 'mine's worse since the rent went up'`

### Composite personas (GB shown; ES swaps £→€, Deliveroo→Glovo, Octopus→Iberdrola; same figures)

**growth — Callum, 31, Leeds (ES: Carlos, 31, Madrid)**
- Saving £50,000 for a place — £18,400 in, on track for October 2028 at today's pace.
- The locked-in part of the month holds steady at £1,340. Nothing wasted there.
- 41 Deliveroo orders in 90 days — £486, two-thirds of them after 9pm on weeknights.
- The kind of move that fixes it: plan half those orders ahead — £81 a month back, and the place lands in August instead.

**security — Dorcas, 34, Bristol (ES: Lucía, 34, Valencia)**
- In the overdraft the same three days every month — the 25th to the 27th.
- £31 a month goes on fees. Never more than £180 spare at any point in 90 days.
- Five bills go out just before payday. A calendar problem, not a spending one.
- The kind of move that fixes it: shift two payment dates — the dip vanishes, £372 a year back.

**agency — Theo, 29, Manchester (ES: Marta, 29, Barcelona)**
- Three invoices averaging £2,900 — but the gaps between them ran 9 to 47 days.
- Spending is the steady one: £1,940 a month, barely moves.
- Two tight squeezes in 90 days, both pure timing. Each froze new work for a week.
- The kind of move that fixes it: pay yourself £2,100 on the 1st from a holding pot — the bumps stay in the pot.

**candor — Priya, 36, London (ES: Andrés, 36, Sevilla)**
- 14 quiet price rises absorbed in a year — £43 a month added without a single decision made.
- Statement opened twice in six months. The creep costs £516 a year.
- Subscriptions up £19, Octopus up £14, the gym up £10 — none refused, none accepted either.
- The kind of move that fixes it: re-decide the top three — about £29 a month back, and the habit of deciding with it.

### Inferred goals

| Family | Label | Noun | Default target (GB/ES — PROVISIONAL) |
|---|---|---|---|
| growth | getting the deposit together | the deposit | 20,000 / 20,000 |
| security | escaping the overdraft | the exit pot | 1,000 / 1,000 |
| agency | smoothing the months | the buffer | 2,500 / 2,500 |
| candor | getting clarity back | the pot | 1,000 / 1,000 |

### Deadline options

- In 3 months (3)
- Within 6 months (6)
- Within 2 years (24)
- No deadline — just direction (null)

### Alt-goal escape hatch (one per family, in family order)

- A house deposit → growth
- Escape the overdraft → security
- Make the months match → agency
- Stop money disappearing → candor
