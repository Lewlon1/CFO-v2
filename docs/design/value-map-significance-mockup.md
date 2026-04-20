# Value Map Significance — Mock-up

**Status:** Revision 2 (2026-04-20) — copy-only mock-up, no code changes yet. Implementation is gated on Lewis's approval.

**Changes in this revision (from Lewis's feedback):**

- Surface A — replaced the split demo/onboarding intros with a **single unified intro**, plus **three rotating hero subheads** (one per promise) instead of a fixed subhead.
- Surface E — the pre-signup payoff panel now includes a **sketched Gap insight placeholder** (illustrative, dashed-border card) under the first bullet, so users literally *see* what The Gap looks like before they sign up.
- Updated the open-questions table to mark A.Q1, D.Q1 (currency stays neutral), and the rotating-hero / sketched-insight questions as resolved.

**Goal:** Rewrite the messaging around the Value Map so users understand it is the mechanism that personalises every piece of guidance they'll get from their CFO — not just a fun psychometric test.

## The core promise, in order

Every line of copy below ladders up to one of these three:

1. **Primary — Save without sacrifice.** You hit your goals without losing the things that make life feel like yours.
2. **Secondary A — Guidance that evolves with you.** Not a static budget. As your values shift, your CFO adjusts.
3. **Secondary B — Your CFO actually knows you.** Other apps treat £50 on a gym the same as £50 on a takeaway. Yours doesn't.

## Voice check (from `cfos-office/CLAUDE.md`)

All CFO-voice copy below follows the persona rules:

- Warm, sharp, conversational — "a smart mate who happens to be brilliant with money."
- Never the product name "The CFO's Office" — always *"your CFO"*.
- Never "advice" or "advise" — use *"guidance"*, *"suggestion"*, or just say what the CFO would do.
- No lecturing. Use tangible comparisons, not jargon.
- British spelling throughout (personalise, prioritise, etc.).

---

## Surface A — Pre-Value-Map intro (unified demo + onboarding)

**Decision:** One set of copy used in both places. The only surface-specific difference is a demo-only footnote under the CTA (the "no account needed" reassurance makes sense for demo, not onboarding). Everything above the CTA is identical.

**Locations:**

- Demo: `cfos-office/src/components/demo/demo-flow.tsx:147-201`
- Onboarding: `cfos-office/src/components/value-map/value-map-flow.tsx:454-476` (`step === 'intro'` branch)

**Current copy (quoted):**

> Demo — *"The Value Map. 10 transactions. 2 minutes. A personality reading your bank app could never give you."*
> Onboarding — *"Your Value Map. In 90 seconds, you'll see what your money is actually doing for you. No other app does this."*

### Proposed copy

- **Hero (fixed):** **Your Value Map**
- **Subhead (rotating — one of three, see below):** pick one at component mount, stable for the session.
- **3-bullet "What this unlocks" block (fixed — all three promises always shown):**
  - **Personalised guidance from minute one.** Your answers shape every suggestion I make from here.
  - **Save without sacrifice.** I'll find money by cutting what you resent, not what you love.
  - **A CFO that learns you.** This is a starting point. The picture gets sharper every time we talk.
- **CTA:** *Start your Value Map →* (demo) / *Let's start →* (onboarding) — the only difference between surfaces.
- **Demo-only footnote under CTA:** *Takes about 2 minutes. No account needed to see your reading.*

### Rotating subheads

Three variants, each leading with one promise. One is chosen at random on component mount and remains stable while the user is on the intro screen (no in-screen animation — users are entering their name, movement would distract). Returning visitors see a different angle; the 3-bullet block always shows all three promises so nothing gets lost regardless of which subhead they saw.

| # | Promise | Subhead copy |
|---|---------|--------------|
| 1 | Primary — save without sacrifice | *"Tell me what your money is really for, and I'll spend the rest of our time helping you protect it."* |
| 2 | Secondary A — evolves with you | *"A quick sketch of what matters to you. Every conversation we have sharpens it."* |
| 3 | Secondary B — a CFO that knows you | *"Other apps treat all your spending the same. I won't. Show me what's foundation and what's a leak, and I'll work from there."* |

**Implementation note:** Keep the subhead copy as an exported array in `cfos-office/src/lib/value-map/copy.ts` (e.g. `VALUE_MAP_INTRO_SUBHEADS: readonly string[]`) and use a small client-only `useMemo(() => pickRandom(...), [])` so SSR hydration mismatches are avoided. A single source of truth means adding a fourth variant later is one-line.

### Layout sketch (mobile ≈ 375px)

```
┌─────────────────────────────────────┐
│                                     │
│           [CFO avatar lg]           │
│                                     │
│        Your Value Map               │  ← hero (H1, fixed)
│                                     │
│  A quick sketch of what matters     │  ← subhead (one of 3,
│  to you. Every conversation we      │     chosen at mount)
│  have sharpens it.                  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ ● Personalised guidance …     │  │
│  │ ● Save without sacrifice …    │  │  ← 3 bullet card
│  │ ● A CFO that learns you …     │  │     (bordered, bg-card)
│  └───────────────────────────────┘  │
│                                     │
│  [ Your first name (optional) ]     │  ← demo only
│  Where are you based? [UK][ES]…     │  ← demo only
│                                     │
│  ┌───────────────────────────────┐  │
│  │    Start your Value Map  →    │  │  ← CTA
│  └───────────────────────────────┘  │
│  Takes about 2 minutes. No account  │  ← demo-only footnote
│  needed to see your reading.        │
│                                     │
└─────────────────────────────────────┘
```

### Rationale

- **Rotating subheads** let us test all three angles without picking a winner upfront. Because one is shown at random and the fixed 3-bullet block always carries all three, the user never misses a promise — the subhead just decides which one they encounter first.
- **Unified copy across demo + onboarding** means one file to edit, one review gate, no drift over time. The surface-specific difference (CTA label + demo footnote) is exactly what has to differ by context.
- **Random-per-mount (not a carousel)** respects the fact that the user is about to enter their name — moving text during data entry is a known friction pattern.

---

## Surface B — Quadrant explainer (light edit)

**Location:** `cfos-office/src/components/demo/demo-flow.tsx:204-229` (and the onboarding mirror).

**Current copy (quoted):**

> **How it works**
> For each transaction, decide which quadrant it belongs to. Trust your gut.

Then four quadrant cards: Foundation, Investment, Burden, Leak — each showing emoji + name + one-line description.

**Proposed copy:**

- **Heading:** *How this shapes what I do*
- **Subhead:** *Four buckets. Trust your gut — we can refine later.*
- **Existing quadrant cards — add a second line (one clause) to each:**
  - **Foundation** — *Essential to how you live.* → **Tagline:** *I'll protect these.*
  - **Investment** — *Builds your future self.* → **Tagline:** *I'll help you grow these.*
  - **Burden** — *Necessary but you resent it.* → **Tagline:** *I'll look for cheaper ways.*
  - **Leak** — *Wasteful or regretted.* → **Tagline:** *This is where we find money.*

**Layout sketch (mobile):**

```
┌─────────────────────────────────────┐
│   How this shapes what I do         │  ← heading (was "How it works")
│   Four buckets. Trust your gut…     │  ← subhead
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 🏠  Foundation                │  │
│  │     Essential to how you live.│  │
│  │     I'll protect these.       │  │  ← NEW tagline, coloured
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 🌱  Investment                │  │
│  │     Builds your future self.  │  │
│  │     I'll help you grow these. │  │  ← NEW
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ⚖️  Burden                    │  │
│  │     Necessary but resented.   │  │
│  │     I'll look for cheaper ways│  │  ← NEW
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 💧  Leak                      │  │
│  │     Wasteful or regretted.    │  │
│  │     This is where we find     │  │  ← NEW
│  │     money.                    │  │
│  └───────────────────────────────┘  │
│                                     │
│         [ Got it → ]                │
└─────────────────────────────────────┘
```

**Rationale:** The quadrants currently read like a taxonomy. Adding the CFO's one-clause commitment per quadrant ("I'll protect these", "this is where we find money") turns the exercise from *sorting* into *priming expectations* — every tap becomes a small contract between the user and their CFO. This is where "save without sacrifice" becomes concrete: the user literally sees *protect* next to Foundation and *find money* next to Leak before they've made a single choice.

**Open question B.Q1:** Are the tagline colours the same as the existing quadrant accent colours (from `QUADRANTS[qId].colour`), or muted? Suggest: same colour, one size smaller than the description, for instant visual association.

---

## Surface C — Demo results reveal / hook message

**Location:** `cfos-office/src/components/demo/demo-reveal.tsx:145` (the typed-in hook message from the CFO that animates after the shareable card renders).

**Current copy (quoted):**

> {name}, have you ever thought about your spending like this before? These were sample transactions — imagine what your CFO could tell you from your real ones. The patterns in how fast you decide, where you hesitate, what you call a "leak" versus a "foundation" — that's your actual relationship with money. And this is just the surface.

**Proposed copy:**

> {name}, that's the sketch. You've told me what matters and what doesn't — which means I now know what to protect and where to look for money. Bring me your real spending and I'll show you exactly where your numbers match what you just said, and where they don't. That gap is where most of the wins live — money you can free up without touching the things you actually care about. This reading gets sharper every month we talk.

**Layout:** No structural change — keeps the existing typed animation, CfoAvatar, tap-to-skip behaviour. Just new copy.

**Rationale:** The current message is genuinely good but it stops at "imagine what your CFO could tell you." It doesn't complete the contract. The rewrite does three things:

1. *Names* what was just earned ("I now know what to protect and where to look for money") — which makes their 2 minutes feel load-bearing, not exploratory.
2. *Lands the primary promise* explicitly ("money you can free up without touching the things you actually care about") — this is "save without sacrifice" in one line.
3. *Hints at evolution* in the last sentence ("this reading gets sharper every month we talk").

All three promises in ~80 words.

**Open question C.Q1:** Should we keep the "{name}, that's the sketch." opener or rework it? "That's the sketch" is a CFO-ish phrase (casual, British, shows we're treating the Value Map as rough-draft). Could alternatively be "Ok, {name} — " or "{name}, one look at that and I can already see…". Suggest: keep "that's the sketch" unless Lewis prefers softer.

---

## Surface D — Onboarding welcome paragraph (⚠️ marked-final copy)

**Location:** `cfos-office/src/lib/onboarding/welcome-copy.ts:30-36` — the `opening` and `transition` paragraphs built by `buildWelcomeCopy()`.

> ⚠️ **The file header says: `Copy is final — do not reword without explicit approval.`** This mock-up treats Lewis's approval of this document as the explicit approval for the edits below. Flagging so there's no ambiguity.

**Current copy (quoted):**

> `opening` (when we have statement data):
> *"Your Value Map said you're **{archetype}** — {subtitle}. That's a starting point, not a label. With {monthsPhrase} of your spending in front of me, I've already got a foundation to work from."*
>
> `opening` (when we don't):
> *"Your Value Map said you're **{archetype}** — {subtitle}. That's a starting point, not a label."*
>
> `transition` (with data):
> *"But a foundation isn't the full picture. The more I can see, the sharper my advice gets."*  ⚠️ uses "advice"
>
> `transition` (without):
> *"The more I can see, the sharper my advice gets — and right now I'm working blind on your actual spending."*  ⚠️ uses "advice"

**Proposed copy:**

> `opening` (with data):
> *"Your Value Map said you're **{archetype}** — {subtitle}. That's not a label, it's the lens I'll use from here. With {monthsPhrase} of your spending in front of me, I already know what to protect and where to look for money you can free up."*
>
> `opening` (without):
> *"Your Value Map said you're **{archetype}** — {subtitle}. That's not a label, it's the lens I'll use from here. Every suggestion I make will pass through it."*
>
> `transition` (with data):
> *"That's the starting line, not the finish. The more of your life I can see, the sharper I get."*
>
> `transition` (without):
> *"Right now I'm working from what you told me, not what your bank shows. The more I can see, the sharper I get — and the sooner I can turn this into real pounds saved without compromise."*

**Rationale:**

- *"the lens I'll use from here"* is the single most important phrase change in the whole doc — it tells the user the Value Map isn't a completed step they've moved past, it's the frame on every future conversation.
- Replaces both instances of "advice" with "suggestion" / "sharper I get" to comply with the persona rule.
- The no-data `opening` adds *"Every suggestion I make will pass through it"* to land the same promise even when we don't have a CSV yet.
- *"real pounds saved without compromise"* — lands the primary promise in the data-less path where the user most needs encouragement to upload.

**Open question D.Q1:** Currency — "pounds" is UK-specific. For Spain users the equivalent would be "euros." Options:
- Dynamic: swap "pounds" → currency symbol from profile. Requires passing `currency` into `buildWelcomeCopy`.
- Neutral: *"turn this into real money saved without compromise"* — loses some specificity but works everywhere.
- Status-quo: leave currency out of this paragraph entirely.

Suggest: **neutral ("real money saved")**, keeps one string, avoids i18n fork.

---

## Surface E — Pre-signup payoff panel (new UI block)

**Location:** `cfos-office/src/components/demo/demo-reveal.tsx` — new block inserted between the hook message (currently lines ~237-252) and the existing `DemoEmailCapture` (lines ~269-282).

**Purpose:** The demo user has just seen their archetype. Right now the next thing they're asked is their email. This moment is when they're deciding whether to sign up — and currently nothing on the page explains *what they get* by doing so. The panel answers: *"Here's what changes when you bring your real numbers."*

**Proposed copy:**

- **Heading:** *What changes when you sign up*
- **Three rows (icon + title + one-line body), with a sketched insight placeholder under row 1:**
  1. **The Gap.** *Upload a statement and I'll show you, line by line, where your actual spending matches what you just told me — and where it doesn't.*
     — *followed by a sketched example card (see below)*
  2. **Cuts without sacrifice.** *I find the money in your Burdens and Leaks first. Your Foundations and Investments are off-limits unless you say otherwise.*
  3. **A reading that sharpens.** *Every conversation, every statement, every correction makes me better at helping you. This isn't a static profile.*
- **Closing line (small, above email capture):** *Your reading stays yours whether you sign up or not. But this is where it starts earning its keep.*

### The sketched Gap insight placeholder

A small illustrative card tucked under the first bullet. Visually it should look *sketched* — dashed border, muted tones, a small "Example" tag — so it reads instantly as a mock-up of what users will get, not real data.

**Card copy (the illustrative example):**

- **"Example" tag** (top-left, muted, uppercase tracking)
- **Line 1 — "You said":** *Gym → Investment*   (with the Investment accent colour dot, `●●●●○` for confidence)
- **Line 2 — "Reality":** *£50/mo · last visit 47 days ago*
- **Line 3 — CFO caption:** *"That's £600/year for a Leak in disguise. Cancel, and we've freed a flight to Lisbon."*
- **Small footnote under card (muted, xs):** *Your version uses your real numbers.*

**Card layout sketch (mobile, dashed border ≈ full width of panel):**

```
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
╎  EXAMPLE                           ╎
╎                                    ╎
╎  You said                          ╎
╎    🌱  Gym  →  Investment   ●●●●○  ╎
╎                                    ╎
╎  Reality                           ╎
╎    £50 / month   ·   last visit    ╎
╎    47 days ago                     ╎
╎                                    ╎
╎  ──────────────────────────────    ╎
╎  "That's £600/year for a Leak in   ╎
╎  disguise. Cancel, and we've       ╎
╎  freed a flight to Lisbon."        ╎
╎                                    ╎
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
   Your version uses your real numbers.
```

**Why this example, specifically:**

- **Gym / Investment mismatch** is the archetypal Gap insight — it's the example used in [`cfos-office/src/lib/ai/tools/analyse-gap.ts`](cfos-office/src/lib/ai/tools/analyse-gap.ts) descriptions and in the top-level `CLAUDE.md` — so the placeholder is truthful about what The Gap actually surfaces.
- **The tangible comparison** ("a flight to Lisbon") follows the CFO persona rule: tangible over jargon.
- **"Leak in disguise"** ties straight back to the four quadrants the user just worked through — the language is consistent end-to-end.
- **British pound** — will need to follow the same currency logic as the rest of the app. For a pre-signup demo we have the user's country (UK/Spain) from the welcome screen — suggest: if `country === 'ES'` swap to *"€50 / month"* + *"we've freed a weekend in Porto"*. One-line switch. Worth it because the example loses force if the currency is wrong.

### Full panel layout sketch (mobile, positioned between hook and email capture)

```
┌─────────────────────────────────────┐
│  [shareable card]                   │  ← existing
│  [ Save card ]                      │
│                                     │
│  [CFO avatar] {name}, that's the    │  ← existing (Surface C)
│  sketch. You've told me what        │     new copy
│  matters…                           │
│                                     │
│  ⭐⭐⭐☆☆  How well did this land?    │  ← existing resonance
│                                     │
│ ─────────────────────────────────── │
│                                     │
│   What changes when you sign up     │  ← NEW payoff panel
│                                     │
│   📊 The Gap                        │
│      Upload a statement and I'll    │
│      show you, line by line…        │
│                                     │
│      ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐     │
│      ╎  EXAMPLE                ╎     │  ← sketched insight
│      ╎  You said               ╎     │     placeholder
│      ╎    🌱 Gym → Investment  ╎     │     (dashed, muted)
│      ╎  Reality                ╎     │
│      ╎    £50/mo · last 47d    ╎     │
│      ╎  "That's £600/year for  ╎     │
│      ╎  a Leak in disguise…"   ╎     │
│      └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘     │
│      Your version uses your real    │
│      numbers.                       │
│                                     │
│   ✂️ Cuts without sacrifice         │
│      I find the money in your       │
│      Burdens and Leaks first…       │
│                                     │
│   🔄 A reading that sharpens        │
│      Every conversation, every      │
│      statement…                     │
│                                     │
│   Your reading stays yours whether  │  ← closing line (xs muted)
│   you sign up or not…               │
│                                     │
│ ─────────────────────────────────── │
│                                     │
│  [ Email capture — existing ]       │
└─────────────────────────────────────┘
```

### Rationale

This is the highest-leverage moment in the entire flow — a user who's just had a reading that resonated is staring at an email field with no proof of what happens next. The three-bullet list alone is persuasive copy; adding the sketched example *shows* the promise. It converts "I'll show you, line by line, where your spending matches what you said" from claim to preview. The dashed-border / muted styling makes it unambiguous that this is illustrative, not their own data — users won't feel tricked when they sign up and see a different first insight.

### Implementation notes

- **New component:** `cfos-office/src/components/demo/payoff-panel.tsx` — pure copy + icons, no data fetching.
- **Sub-component (or inline block):** `<GapInsightSketch country={country} />` — single `country` prop so we can swap currency and the tangible comparison (Lisbon / Porto) per region. Hard-coded otherwise — this is an illustration, not a real data view.
- **Icons:** lucide (`BarChart3`, `Scissors`, `RefreshCw`) for the three rows — matches the rest of the app. Emoji only inside the sketched card (🌱) since that's the same emoji set used in `QUADRANTS` and it reinforces the quadrant they just used.
- **Visibility:** gated on the existing `done` state (after the typed hook finishes), matching the existing resonance + email-capture reveal sequence.

---

## Summary of open questions

### Resolved in this revision (per Lewis, 2026-04-20)

| # | Question | Decision |
|---|----------|----------|
| — | Single hero or rotating? | **Rotating — 3 subheads, random per mount, stable in session.** |
| — | Payoff panel: pure copy or sketched visual? | **Sketched Gap insight placeholder under bullet 1.** |
| A.Q1 | Diverge demo + onboarding intro? | **No — unified copy, only CTA + footnote differ.** |
| E.Q1 | Payoff panel visibility | **Gated on `done`.** |
| E.Q2 | Payoff panel icons | **Lucide for bullets, emoji inside sketched card.** |

### Still open (for Lewis to decide on this pass)

| # | Question | Suggested answer |
|---|----------|------------------|
| B.Q1 | Quadrant tagline colour? | Same as quadrant accent, one size smaller. |
| C.Q1 | Keep "{name}, that's the sketch." opener on the demo reveal hook? | Yes — matches CFO persona. |
| D.Q1 | Currency in the onboarding welcome paragraph (`welcome-copy.ts`) — neutral, dynamic, or status-quo? | Neutral: *"real money saved."* |
| E.Q3 | Sketched-card currency — hard-code £ or swap to € for `country === 'ES'`? | **Swap** — one-line switch, preserves the tangible comparison. |

## What happens next

If Lewis approves this mock-up (with or without edits):

1. Create `cfos-office/src/lib/value-map/copy.ts` — single source of truth for every string above, exported as typed constants, including `VALUE_MAP_INTRO_SUBHEADS` (readonly 3-tuple) for the rotating hero.
2. Apply copy to the four existing files (`demo-flow.tsx`, `value-map-flow.tsx`, `demo-reveal.tsx`, `welcome-copy.ts`) by importing from the new module. The rotating subhead needs a tiny client-only helper (`useMemo(() => pickRandom(SUBHEADS), [])`) to avoid SSR hydration mismatches.
3. Build `cfos-office/src/components/demo/payoff-panel.tsx` with an inline `<GapInsightSketch country={country} />` block — one new presentational file. Accepts `country` so the sketched card can switch currency + tangible comparison (£ / Lisbon ↔ € / Porto).
4. Verify per the plan: walk the demo flow (both countries), walk the onboarding flow on a fresh Supabase staging user, screenshot each surface at mobile + desktop, smoke-check the CFO chat after onboarding to confirm the archetype still feeds the system prompt correctly.

If Lewis wants another pass on copy, edit this file directly — any edits are automatically the source copy the implementation will use.
