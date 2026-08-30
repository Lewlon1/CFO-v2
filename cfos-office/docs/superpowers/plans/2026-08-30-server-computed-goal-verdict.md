# Compute the goal verdict server-side (Rule 2, applied to the one place it isn't)

**Status:** ready to execute · **Written:** 2026-08-30 · **Branch to cut from:** `claude/filing-cabinet-system-testing-0d0cy2` (or `main` once PR #76 lands)

> This plan is written to run cold. It assumes no knowledge of the session that
> produced it. Read the Context, then execute Steps 1–6 in order.

---

## Context — what's broken and how we know

Every number in a First Read is computed server-side and handed to the model
verbatim (CLAUDE.md Rule 2: *the system computes, the LLM interprets*). With one
exception: **the verdict** — "are you on track or not, and by how much". That
one, the model works out itself. It is also the single most consequential
sentence in the Read.

The prompt hands the model free cash flow plus three monthly requirement figures
(4% / 7% / 10% return scenarios) and then instructs it, in
`buildGoalSummary()`, to *"Give a clear verdict on whether the target is
realistic … given their free cash flow."* That is an arithmetic task, and models
fail it:

| Model | Cash flow | Needs (4%) | Truth | What it wrote |
|---|---|---|---|---|
| Nova Pro | £1,470 | £1,249 | **+£221 surplus** | "you're £62 short" |
| Nova Pro | £3,798 | £2,732 | **+£1,066 surplus** | "you're £33 short" |
| Nova Pro | €820 | €800 | **+€20 surplus** | "you're €300 short" |
| Nova Pro | £1,422 | £857 | **+£565 clear** | "£578 short each month" |
| **Claude Sonnet** | £1,470 | £1,249 | **+£221 surplus** | "the 4% stress case, where you're £221/mo short" |

Two failure shapes: subtracting the two *requirements* from each other and
calling the difference a shortfall (Nova, three times), and picking the right
pair but flipping the sign (Claude). **This is not a Nova-only problem** — the
last row is Claude, and it is why a model swap does not fix it.

Aggravating factor: the Read's template has a "here's the gap → here's the move
that closes it" shape. When a user is funded there is no gap, but the slot still
demands filling, so the model invents one. Someone already tried to patch this
with prompt wording — `buildGoalSummary` literally says *"never as closing a gap
that does not exist at plan"*. The models ignore it. **Wording does not fix
arithmetic.**

### The precedent — half this codebase already does it right

The **declared / skip-upload path already computes the verdict server-side.**
See `DeclaredReadFacts` in `src/lib/ai/compose-first-read.ts` (~line 830):

```ts
/** Free cash left after the goal contribution … Computed server-side so the
 *  model cites it verbatim instead of doing the arithmetic itself (Rule 2). */
unallocated: number | null
/** Investment goal whose existing pot reaches the target at the plan rate → £0/mo
 *  needed. Frame as ON TRACK, not "no contribution attached". */
fundedAtPlan: boolean
planRatePct / stressRatePct / stressMonthly / stressCovered
```

and how it is rendered, in `src/lib/ai/prompts/first-read.ts` (~line 556):

> `- Conservative stress test: at a cautious ${stressRatePct}% return, about
> ${stressMonthly}/mo would be needed — … their free cash ${stressCovered ?
> 'comfortably covers that' : 'falls short of that by …'}. **Cite these figures
> verbatim; never recompute them.**`

**So this plan is not a new pattern. It is applying the existing declared-path
pattern to the main upload path, which never got it.** That also satisfies Rule 8
(one source of truth per fact) — right now the two paths answer "are you funded?"
by two different mechanisms.

### What is already in place (do not rebuild)

Shipped in commits `ac04c5e` + `4fad4de` on this branch:

- `validateSurplusClaims()` / `extractSurplusClaims()` in
  `src/lib/ai/insight-validator.ts` — a deterministic compose-time check that
  catches these inversions. It stays: it becomes the *regression alarm* for this
  work. **After this plan lands it should go permanently quiet.**
- `deriveSurplusGroundTruth()` in `src/lib/ai/compose-first-read.ts` — already
  computes `{ freeCashFlow, requirements[] }` from `requiredMonthlyBand` /
  `monthly_required_saving`. **Step 3 refactors this to consume the new verdict
  rather than duplicating the derivation.**
- `first_read_metadata.reconciliation` persisted per Read, asserted by
  `assertReadArithmeticReconciles()` in `tests/onboarding/runner/db-assertions.ts`.

---

## Goal

The model never computes the verdict. It receives, as verbatim-citable facts:
*funded at plan / not funded*, the exact surplus or shortfall, and whether the
conservative stress case is covered. `validateSurplusClaims` then finds nothing
to flag, because there is nothing left for the model to get wrong.

**Non-goal / out of scope** (adjacent, deliberately separate):
- Fixing the noisy citation allowlist (it flags every goal-derived number because
  `factBundles` omits the goal data — see "Adjacent findings" at the end).
- Making any validator blocking / regenerate-on-violation.
- Reshaping the Read template so "you're fine" needs no gap slot.

---

## Step 1 — `computeGoalVerdict()`, pure and tested

**New file:** `src/lib/finance/goal-verdict.ts`

Pure, no DB, no I/O. Single source of truth for "is this goal funded, and by how
much". Mirrors the maths already in `deriveAccelerateLever`
(`src/lib/analytics/levers.ts` ~line 298) and the declared path.

```ts
import {
  requiredMonthlyBand,
  INVESTMENT_DEFAULT_RATE_PCT,
} from '@/lib/finance/compound-growth';
import { monthsBetween } from '@/lib/goals/pace';

export interface GoalVerdictInput {
  goal: {
    type: string | null;
    target_amount: number | null;
    current_amount: number | null;
    target_date: string | null;
    monthly_required_saving: number | null;
  } | null;
  freeCashFlow: number | null;
  /** now — injected so tests are deterministic. */
  asOf: Date;
}

export interface GoalVerdict {
  /** false when pace inputs are missing — nothing numeric may be asserted. */
  computable: boolean;
  /** Every monthly requirement figure offered (band values, or straight-line). */
  requirements: Array<{ ratePct: number | null; monthly: number }>;
  /** The requirement the Read plans around (the 7% case, or the straight-line figure). */
  planMonthly: number | null;
  planRatePct: number | null;
  /** The conservative stress case (lowest rate). Null for non-investment goals. */
  stressMonthly: number | null;
  stressRatePct: number | null;

  // ── The verdict itself — the numbers the model must quote, never derive ──
  /** freeCashFlow >= planMonthly */
  fundedAtPlan: boolean;
  /** freeCashFlow − planMonthly when funded; else null. */
  surplusAtPlan: number | null;
  /** planMonthly − freeCashFlow when NOT funded; else null. */
  shortfallAtPlan: number | null;
  /** freeCashFlow >= stressMonthly. Null when no stress case. */
  stressCovered: boolean | null;
  /** stressMonthly − freeCashFlow when the stress case is NOT covered; else null. */
  stressShortfall: number | null;
}

export function computeGoalVerdict(input: GoalVerdictInput): GoalVerdict
```

Rules the implementation must honour:

- Round every emitted money figure with `Math.round` — the Read never shows cents.
- `computable: false` whenever `goal` is null, `freeCashFlow` is null, or
  `monthsLeft <= 0`. In that case every numeric field is null / false and callers
  must not assert anything about pace.
- Investment goals (`type === 'investment'`, target + date present): build the
  band via `requiredMonthlyBand`; `planMonthly` = the `INVESTMENT_DEFAULT_RATE_PCT`
  (7%) entry, `stressMonthly` = the lowest-rate entry.
- Otherwise, if `monthly_required_saving` is set: single requirement,
  `planMonthly` = that figure, `ratePct: null`, no stress case.
- **Exactly one of `surplusAtPlan` / `shortfallAtPlan` is non-null.** This is the
  invariant that makes the inversion structurally impossible to express.

**Tests:** `src/lib/finance/goal-verdict.test.ts`. Use the five real regression
rows from the Context table as fixtures — assert `fundedAtPlan === true` and
`shortfallAtPlan === null` for all of them. Plus: not-funded case, stress-not-
covered case, non-investment straight-line goal, `computable: false` paths,
`monthsLeft <= 0`, and £0/mo funded-at-plan (mirrors declared-path `fundedAtPlan`).

---

## Step 2 — hand the verdict to the model instead of asking for it

**File:** `src/lib/ai/compose-first-read.ts`, `buildGoalSummary()` (~line 755).

Change the signature to accept the verdict:

```ts
export function buildGoalSummary(
  goal: { … },              // unchanged
  currency: string,
  verdict: GoalVerdict,     // NEW
): string
```

and update the single call site (~line 264):

```ts
const goalVerdict = computeGoalVerdict({
  goal: goalRow,
  freeCashFlow: financialFacts.free_cash_flow,
  asOf: new Date(),
});
const goalSummary = goalRow
  ? buildGoalSummary(goalRow, financialFacts.currency, goalVerdict)
  : null;
```

**Delete the instruction that asks the model to do the maths.** In the investment
branch, this text goes:

> `Give a clear verdict on whether the target is realistic at the 7% plan given
> their free cash flow. If free cash flow already covers the 7% number, say so
> plainly … never as closing a gap that does not exist at plan.`

Replace it with server-computed, verbatim-citable lines, modelled word-for-word
on the declared path's rendering in `prompts/first-read.ts:556-566`:

```ts
if (verdict.fundedAtPlan) {
  lines.push(
    `VERDICT (server-computed — cite verbatim, NEVER recompute): FUNDED AT PLAN. ` +
    `Free cash flow of ${m(fcf)} covers the ${verdict.planRatePct}% plan figure of ` +
    `${m(verdict.planMonthly!)}/mo, leaving ${m(verdict.surplusAtPlan!)}/mo spare. ` +
    `There is NO gap at plan. Do not describe any figure as a shortfall, gap or ` +
    `gap-to-close. Frame the next move as getting there sooner or protecting the buffer.`,
  );
} else {
  lines.push(
    `VERDICT (server-computed — cite verbatim, NEVER recompute): NOT FUNDED AT PLAN. ` +
    `The ${verdict.planRatePct}% plan needs ${m(verdict.planMonthly!)}/mo and free cash ` +
    `flow is ${m(fcf)} — a shortfall of exactly ${m(verdict.shortfallAtPlan!)}/mo. ` +
    `${m(verdict.shortfallAtPlan!)} is the ONLY shortfall figure that may appear.`,
  );
}
if (verdict.stressMonthly != null) {
  lines.push(
    verdict.stressCovered
      ? `STRESS TEST (server-computed — cite verbatim): at the conservative ` +
        `${verdict.stressRatePct}% rate, ${m(verdict.stressMonthly)}/mo is needed and free ` +
        `cash flow COVERS it. The stress case is covered — it is not a gap.`
      : `STRESS TEST (server-computed — cite verbatim): at the conservative ` +
        `${verdict.stressRatePct}% rate, ${m(verdict.stressMonthly)}/mo is needed — ` +
        `${m(verdict.stressShortfall!)}/mo more than free cash flow covers.`,
  );
}
```

Keep the existing band line (users should still see the range once) and the
compound-growth explanation. Only the *verdict* moves server-side.

Do the same for the straight-line branch (~line 816), which today emits the
requirement and no verdict at all.

**Why the explicit "NO gap" / "ONLY shortfall figure" wording:** the observed
failures were not the model missing a fact — they were the model inventing one
to fill the template's gap slot. The line has to close that slot explicitly.

---

## Step 3 — one source of truth (Rule 8)

**File:** `src/lib/ai/compose-first-read.ts`, `deriveSurplusGroundTruth()` (~line 470).

It currently re-derives `requirements[]` from `requiredMonthlyBand` /
`monthly_required_saving` — the same maths `computeGoalVerdict` now does. Two
copies of one fact is exactly what Rule 8 forbids, and if they drift the
validator will start lying.

Refactor it to take the verdict:

```ts
export function deriveSurplusGroundTruth(
  pkg: LeverPackage,
  verdict: GoalVerdict,
): SurplusGroundTruth {
  const accelerate = pkg.levers.find((l) => l.type === 'accelerate');
  return {
    freeCashFlow: verdict.freeCashFlow ?? null,   // add to GoalVerdict, or thread separately
    requirements: verdict.requirements.map((r) => r.monthly),
    surplusOverRequired: accelerate ? accelerate.surplusOverRequired : null,
    stressTestGap: accelerate ? accelerate.stressTestGap : null,
    paceComputable: verdict.computable && pkg.blocker === null,
  };
}
```

Update the call site (~line 404) and its tests. **Do not weaken
`validateSurplusClaims` itself** — it must keep failing loudly if a future change
reintroduces model-side arithmetic.

---

## Step 4 — files touched (complete list)

| File | Change |
|---|---|
| `src/lib/finance/goal-verdict.ts` | **new** — `computeGoalVerdict`, `GoalVerdict` |
| `src/lib/finance/goal-verdict.test.ts` | **new** — regression fixtures from the Context table |
| `src/lib/ai/compose-first-read.ts` | call `computeGoalVerdict`; `buildGoalSummary` takes + renders the verdict; `deriveSurplusGroundTruth` consumes it |
| `src/lib/ai/__tests__/compose-first-read.test.ts` | update `buildGoalSummary` call sites for the new arg |
| `src/lib/ai/insight-validator-v2.test.ts` | unchanged unless `SurplusGroundTruth` shape moves |

Consider also emitting the verdict into `first_read_metadata` (next to
`citation_set` / `reconciliation`) so `/admin/wow/[insightId]` can show what the
model was actually told. Cheap, no migration — that blob is already persisted
wholesale.

---

## Step 5 — verification

```bash
npm run typecheck && npm test && npm run lint && npm run knip && npm run build
```

All five must pass. `npm test` must be the **full** run — a scoped vitest
invocation misses the `tests/` tree. Check real exit codes; do not pipe through
`tail`.

Then the live eval — this is the part that actually proves it:

```bash
# 1. Dev server MUST be started fresh (see Gotchas — stale code is a trap here)
lsof -ti:3000 | xargs -r kill -9
export BEDROCK_CLAUDE_MODEL=eu.amazon.nova-pro-v1:0
export BEDROCK_CLAUDE_UTILITY_MODEL=eu.anthropic.claude-haiku-4-5-20251001-v1:0
npx next dev            # wait for HTTP 200 on localhost:3000

# 2. Nova is the harshest test — it produced 3 of the 5 regressions
npm run test:onboarding -- --run-id verdict-nova --no-unit --concurrency 1 \
  --personas builder-classic,time-saver-expert,zane-spain,truth-teller-balanced
```

**Pass criteria:**
1. No `[compose-first-read] surplus/shortfall claim does not reconcile` in the
   dev-server log.
2. No persona fails with `first Read states a surplus/shortfall that does not
   reconcile`.
3. Read the four Reads by hand
   (`tests/onboarding/test-output/verdict-nova/<persona>/captured/insight.json`)
   and confirm each states the verdict correctly, quoting the server figure.
4. Repeat with `BEDROCK_CLAUDE_MODEL=eu.anthropic.claude-sonnet-4-6` — Claude
   produced the £221 inversion too, so it must also come back clean.

Ship only when Nova — the worse model — cannot produce an inverted verdict. If
Nova is clean, the prompt is genuinely doing the work rather than relying on
model strength.

Append lessons to `cfos-office/SESSION-LOG.md` before closing.

---

## Gotchas (all cost real time in the session that wrote this)

- **The dev server serves stale code.** Next.js did *not* hot-reload changes to
  `compose-first-read.ts`; three eval runs "passed" against the previous binary
  and produced a completely wrong conclusion. **Kill and restart the dev server
  after every server-side edit.** Do not trust an eval run that follows an edit
  without a restart.
- **`--concurrency 1`.** The default of 2 causes Playwright sign-in timeouts that
  look like product failures but are browser contention.
- **Teardown deletes your evidence.** `delete_user_account` deletes
  `llm_usage_log` *and* the conversation. To inspect persisted metadata or
  confirm which model actually ran, pass **`--keep-users`**, then query
  `conversations.metadata->'first_read_metadata'`.
- **Confirm the model that actually ran** via `llm_usage_log` (`call_type =
  'first_read_compose'`), not the `[bedrock] …` banner — that banner is printed
  by the *runner* process and reflects the runner's env, not the dev server's.
- **Rule 5 / EU or nothing.** `.env.local` on this machine holds non-`eu.` model
  ids (`amazon.nova-pro-v1:0`), which `resolveEuModel` throws on. Override with
  `eu.`-prefixed exports in the shell; `_load-env.ts` does not overwrite existing
  env vars, so exports win. Never set `ALLOW_NON_EU_BEDROCK=1`.
- **Staging only.** All writes/migrations go to `qlbhvlssksnrhsleadzn`. Never
  touch prod (`iccelmjenljanqrhhzdv`). This plan needs **no migration**.
- **Judge scores will not tell you if this worked.** The LLM judge scored all
  four inverted Reads **5/5 on accuracy** — its accuracy dimension asks "is this
  figure grounded?", not "is this conclusion right?". Trust
  `validateSurplusClaims` and your own reading of the prose.

---

## Adjacent findings (worth separate work, not in this plan)

1. **The citation allowlist is missing the goal data.** `factBundles` in
   `compose-first-read.ts` is `[financial_facts, levers, spending_breakdown]` —
   it omits the goal/band figures, so every legitimate goal number is reported
   ungrounded. A real observed log flagged
   `['155','2026','28','40000','2028','1249','1187','1126',…,'283','62','62']`
   — the one true error (`62`) buried in a dozen false alarms. That noise is why
   the check is log-only and why nobody reads it. Adding the goal facts to the
   allowlist is small and would make the check usable — and plausibly blocking.
2. **The Read template demands a gap.** "Here's the gap → here's the move that
   closes it" has no good shape for "you're fine". Step 2 patches this with
   explicit wording; the durable fix is a template with a first-class
   funded-and-fine branch.
3. **`onboarding_completed_at` intermittently stays null** (~1 persona per run,
   both models). Unrelated to this work, still undiagnosed.
