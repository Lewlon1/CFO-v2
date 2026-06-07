# Onboarding Judge Recalibration + Real-Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the value-first onboarding e2e suite green *and trustworthy* — fix the judge's false-fails, fix the two real defects it surfaced (€-for-£ currency; unrealistic persona income), broaden goal coverage to 8/10 personas with variance, and make every deterministic rule offline-testable via a golden corpus.

**Architecture:** Three layers. (1) **Judge** (`tests/onboarding/runner/judge.ts`): extract a pure, LLM-free `evaluateHardRules()` and recalibrate each rule against captured Reads. (2) **Golden corpus** (`tests/onboarding/unit/judge.test.ts` + `fixtures/`): vitest unit tests that pin every rule's verdict on real + synthetic Reads — fast, CI-gated, no Bedrock/browser. (3) **Real fixes**: one product change (`compose-first-read.ts` currency resolution) + harness realism (persona income/rent, driver writes country, goal seeding, race poll, teardown).

**Tech Stack:** TypeScript, Vitest (`npm run test` = `vitest run`, default globs cover `tests/**` and `src/**`; `@`→`./src`), Playwright (driver), Supabase admin client, AWS Bedrock (LLM judge only — not exercised by unit tests).

**Spec:** `cfos-office/docs/superpowers/specs/2026-06-07-onboarding-judge-recalibration-design.md`

**Conventions:** all paths relative to `cfos-office/`. Per-file test runs use the local bin `./node_modules/.bin/vitest run <path>` (NOT `npx vitest` — broken in this repo). Authoritative runs use `npm run test`. Branch: `fix/validator-note-leak`.

---

## File Structure

**Modify:**
- `tests/onboarding/runner/judge.ts` — extract pure `evaluateHardRules()`; add `readContent()` unwrap; new/recalibrated rules (R3b, R4 minimal, R5 currency, R6 goal-denial, R7 system-note, R8 CTA); retire dead value-first detection.
- `tests/onboarding/runner/persona-runner.ts` — pass unwrapped content to the judge.
- `tests/onboarding/runner/playwright-driver.ts` — poll `onboarding_completed_at` after the Read; write `country` to the profile.
- `tests/onboarding/runner/user-factory.ts` — add `llm_usage_log` to teardown.
- `tests/onboarding/runner/db-assertions.ts` — assert goal persisted (present for the 8, absent for the 2).
- `tests/onboarding/personas/types.ts` — narrow `goal.type`; (income/rent fields already exist on `PersonaProfile`).
- `tests/onboarding/personas/*.ts` (all 10) — set realistic `monthlyIncome`/`monthlyRent`; seed `goal` on 8; recalibrate `hardRules.insight`.
- `src/lib/ai/compose-first-read.ts` — `getFinancialFacts` currency via `resolveUserCurrency`.

**Create:**
- `tests/onboarding/fixtures/reads/*.txt` — captured + transformed + synthetic Read fixtures.
- `tests/onboarding/fixtures/index.ts` — fixture loader + per-fixture expectations.
- `tests/onboarding/unit/judge.test.ts` — the golden-corpus rule tests.
- `tests/onboarding/unit/personas.test.ts` — persona-registry invariants (income realism, goal variance).

---

## Task 1: Extract a pure, LLM-free hard-rule evaluator + content unwrap

This unblocks everything: the corpus tests call `evaluateHardRules()` directly (no Bedrock), and `judgeOutput` stops feeding the message *wrapper object* to the rules (the bug that fails H1/H5 on all 10).

**Files:**
- Modify: `tests/onboarding/runner/judge.ts`
- Modify: `tests/onboarding/runner/persona-runner.ts`
- Test: `tests/onboarding/unit/judge.test.ts` (created here, grown in later tasks)

- [ ] **Step 1: Write the failing test**

Create `tests/onboarding/unit/judge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readContent, evaluateHardRules } from '../runner/judge'
import { summariseCsv } from '../runner/csv-summariser'
import { builderClassic } from '../personas/builder-classic'

describe('readContent', () => {
  it('unwraps the message wrapper object to its content string', () => {
    const wrapper = { conversationType: 'first_read', content: 'Body line.\n\n— C.', messageId: 'abc' }
    expect(readContent(wrapper)).toBe('Body line.\n\n— C.')
  })
  it('passes a plain string through unchanged', () => {
    expect(readContent('plain')).toBe('plain')
  })
})

describe('evaluateHardRules: signoff on unwrapped content', () => {
  it('passes H1_signoff_present for a Read ending in "— C." (no JSON wrapper)', () => {
    const read = 'Housing is £1,100 of your spend.\n\n[CTA:set_goal]Set a goal[/CTA]\n\n— C.'
    const rules = evaluateHardRules(builderClassic, 'insight', read, null)
    const h1 = rules.find((r) => r.ruleId === 'H1_signoff_present')
    expect(h1?.passed).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts`
Expected: FAIL — `readContent`/`evaluateHardRules` are not exported from `judge.ts`.

- [ ] **Step 3: Refactor `judge.ts` — add `readContent`, export `evaluateHardRules`, rewire `judgeOutput`**

In `tests/onboarding/runner/judge.ts`, add the unwrap helper near the top (after imports):

```ts
/** Unwrap the captured insight (a message wrapper `{content}`) to its content string. */
export function readContent(cfoOutput: unknown): string {
  if (typeof cfoOutput === 'string') return cfoOutput
  if (cfoOutput && typeof cfoOutput === 'object' && 'content' in cfoOutput) {
    const c = (cfoOutput as { content?: unknown }).content
    if (typeof c === 'string') return c
  }
  return JSON.stringify(cfoOutput)
}
```

Replace the body of `judgeOutput` (the deterministic block, currently lines ~180–211) so it (a) unwraps once and (b) delegates to a new exported pure function. The new `judgeOutput`:

```ts
export async function judgeOutput(
  persona: Persona,
  outputType: 'archetype' | 'insight',
  cfoOutput: unknown,
  csvSummary: CsvSummary | null,
): Promise<JudgeOutput> {
  const content = readContent(cfoOutput)

  const hardRules: HardRuleResult[] = evaluateHardRules(persona, outputType, content, csvSummary)

  let likert: LikertResult[] = []
  let raw: unknown = null
  let modelId = utilityModelId
  try {
    const judged = await callLlmJudge(persona, outputType, content, csvSummary)
    likert = judged.likert
    raw = judged.raw
    modelId = judged.modelId
  } catch (e) {
    hardRules.push({ ruleId: 'R0_judge_call_succeeded', passed: false, detail: String(e) })
  }

  return { outputType, modelId, timestamp: new Date().toISOString(), hardRules, likert, raw }
}
```

Add the new exported pure evaluator (initially a faithful move of the existing rules; later tasks recalibrate it). Place it above `judgeOutput`:

```ts
export function evaluateHardRules(
  persona: Persona,
  outputType: 'archetype' | 'insight',
  content: string,
  csvSummary: CsvSummary | null,
): HardRuleResult[] {
  const rules = persona.expectations.hardRules
  const out: HardRuleResult[] = []
  out.push(checkBannedWords(content, rules?.bannedWords))
  out.push(checkBannedPatterns(content, rules?.bannedPatterns))

  if (outputType === 'archetype') {
    out.push(checkMustMentionOneOf(content, rules?.archetype?.mustMentionOneOf, 'R2_archetype_mentions_one_of'))
    out.push(checkMustMentionOneOf(content, rules?.archetype?.mustAcknowledgeOneOf, 'R2b_archetype_acknowledges_one_of'))
    if (rules?.archetype?.mustReferenceQuadrant) {
      out.push(checkMustMentionOneOf(content, [rules.archetype.mustReferenceQuadrant], 'R2c_archetype_references_quadrant'))
    }
  } else {
    out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceMerchantsFromCsv, 'R3_insight_references_csv_merchants'))
    out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceOneOf, 'R3b_insight_mentions_one_of'))
    if (rules?.insight?.numbersMustMatchCsv) {
      out.push(checkNumbersMatchCsv(content, csvSummary))
    }
    const knownMerchants = csvSummary?.topMerchants.map((m) => m.description.toLowerCase()) ?? []
    for (const r of checkReadHardRules(content, { mode: 'default', knownMerchants })) {
      out.push({ ruleId: r.ruleId, passed: r.passed, detail: r.detail })
    }
  }
  return out
}
```

Update `callLlmJudge`'s signature to take `content: string` and use it for `{cfo_output}` (replace `JSON.stringify(cfoOutput, null, 2)` with `content`). Remove the now-unused `isValueFirst` value-first detection block.

- [ ] **Step 4: Rewire `persona-runner.ts` to keep behavior identical**

`persona-runner.ts` already passes `result.captured.archetype` / `result.captured.insight` (the wrapper) into `judgeOutput`. No change needed there — `judgeOutput` now unwraps internally. Verify the two `judgeOutput(...)` call sites compile.

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tests/onboarding/runner/judge.ts tests/onboarding/runner/persona-runner.ts tests/onboarding/unit/judge.test.ts
git commit -m "refactor(judge): pure evaluateHardRules + unwrap message content (fixes H1/H5)"
```

---

## Task 2: Build the Phase-1 golden corpus (fixtures + loader)

Freeze the 2026-06-06 captured Reads as content-string fixtures, add `€`→`£` "good" variants for GBP personas, and synthetic bad Reads. Source of truth: `tests/onboarding/test-output/2026-06-06T19-35-51-656Z/summary.json` (`personas[].captured.insight.content`).

**Files:**
- Create: `tests/onboarding/fixtures/reads/<persona>.captured.txt` (×10, raw `€` content)
- Create: `tests/onboarding/fixtures/reads/<persona>.gbp.txt` (GBP personas, `€`→`£`)
- Create: `tests/onboarding/fixtures/reads/bad-<case>.txt` (synthetic)
- Create: `tests/onboarding/fixtures/index.ts` (loader + expectations)

- [ ] **Step 1: Extract captured Reads to fixture files**

Run this one-off to write the captured content strings (verbatim) to fixtures:

```bash
mkdir -p tests/onboarding/fixtures/reads
node -e '
const fs=require("fs");
const s=require("./tests/onboarding/test-output/2026-06-06T19-35-51-656Z/summary.json");
for(const p of s.personas){
  const i=p.captured&&p.captured.insight; if(!i) continue;
  const content=typeof i==="string"?i:i.content; if(!content) continue;
  fs.writeFileSync("tests/onboarding/fixtures/reads/"+p.personaId+".captured.txt", content);
}
console.log("wrote", s.personas.length, "captured fixtures");
'
```

- [ ] **Step 2: Create `€`→`£` "good" variants for GBP personas**

GBP personas: `builder-classic, fortress-saver, truth-teller-balanced, anchor-debt, time-saver-expert, aiko-low-transaction, sofia-chaotic, tom-long-history`. (EUR: `drifter-expat, zane-spain` — captured file is already the "good" positive.)

```bash
for p in builder-classic fortress-saver truth-teller-balanced anchor-debt time-saver-expert aiko-low-transaction sofia-chaotic tom-long-history; do
  sed 's/€/£/g' "tests/onboarding/fixtures/reads/$p.captured.txt" > "tests/onboarding/fixtures/reads/$p.gbp.txt"
done
echo "wrote GBP positive variants"
```

> NOTE: the `.gbp.txt` files are *synthetic positives* representing post-fix output. They are placeholders for the real thing — Task 14 replaces them with freshly-captured £, goal-aware Reads. Until then they validate the currency/structure rules.

- [ ] **Step 3: Create synthetic bad Reads**

Create each file with the exact content:

`tests/onboarding/fixtures/reads/bad-missing-signoff.txt`:
```
Housing is £1,100 of your £5,000 spend.

[CTA:set_goal]Set a goal[/CTA]
```

`tests/onboarding/fixtures/reads/bad-hallucinated-money.txt`:
```
Your investment account holds £250,000 across the window.

[CTA:set_goal]Set a goal[/CTA]

— C.
```

`tests/onboarding/fixtures/reads/bad-options-block.txt`:
```
Here is your picture. £1,100 on housing.

[OPTIONS]
- A
- B
[/OPTIONS]

— C.
```

`tests/onboarding/fixtures/reads/bad-question-close.txt`:
```
Housing is £1,100 of your spend. What would you like to do next?

— C.
```

`tests/onboarding/fixtures/reads/bad-system-note.txt`:
```
Housing is £1,100. (System note: validator flagged this.)

[CTA:set_goal]Set a goal[/CTA]

— C.
```

`tests/onboarding/fixtures/reads/bad-goal-denial.txt`:
```
You have no active goal yet, so there's nothing to measure against.

[CTA:set_goal]Set a goal[/CTA]

— C.
```

`tests/onboarding/fixtures/reads/bad-euro-on-gbp.txt`:
```
Housing is €1,100 of your €5,000 tracked spend.

[CTA:set_goal]Set a goal[/CTA]

— C.
```

- [ ] **Step 4: Create the loader `tests/onboarding/fixtures/index.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, 'reads')

export function loadRead(name: string): string {
  return readFileSync(path.join(DIR, `${name}.txt`), 'utf-8')
}

export function listReads(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''))
}
```

- [ ] **Step 5: Smoke-test the loader**

Append to `tests/onboarding/unit/judge.test.ts`:

```ts
import { loadRead, listReads } from '../fixtures'

describe('fixtures', () => {
  it('loads the captured corpus', () => {
    expect(listReads().length).toBeGreaterThanOrEqual(18) // 10 captured + 8 gbp + 7 bad
    expect(loadRead('zane-spain.captured')).toMatch(/— C\.\s*$/)
  })
})
```

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/onboarding/fixtures tests/onboarding/unit/judge.test.ts
git commit -m "test(judge): freeze captured Reads + synthetic bad Reads as golden corpus"
```

---

## Task 3: Minimal R4 (currency-anchored, comma-aware, egregious-only)

Replace the unsound `checkNumbersMatchCsv`. Flag only currency-anchored money tokens that match nothing plausible AND exceed total spend. Excludes years/%/counts (not currency-anchored) and computed facts (≤ spend).

**Files:**
- Modify: `tests/onboarding/runner/judge.ts`
- Test: `tests/onboarding/unit/judge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { summariseCsv } from '../runner/csv-summariser'

const TINY_CSV = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'CARD_PAYMENT,2026-01-01,Rent Landlord,-1100.00,GBP,0',
  'CARD_PAYMENT,2026-01-02,Tesco,-300.00,GBP,0',
  'CARD_PAYMENT,2026-01-03,Farmer J,-100.00,GBP,0',
].join('\n')

describe('R4 minimal numbers', () => {
  const csv = summariseCsv(TINY_CSV, 'GBP') // spendingTotal = 1500
  const run = (read: string) =>
    evaluateHardRules(builderClassic, 'insight', read, csv).find((r) => r.ruleId === 'R4_numbers_match_csv')

  it('passes years, percentages, counts (not currency-anchored)', () => {
    expect(run('In 2026, 70% across 14 transactions. £1,100 rent.\n\n— C.')?.passed).toBe(true)
  })
  it('passes computed facts below total spend (£1,717 fixed costs)', () => {
    expect(run('Fixed costs £1,717/month; free cash flow £1,283.\n\n— C.')?.passed).toBe(true)
  })
  it('passes thousands-comma amounts that match a CSV figure', () => {
    expect(run('You tracked £1,500 in total.\n\n— C.')?.passed).toBe(true) // == spendingTotal
  })
  it('flags an egregious hallucinated amount exceeding total spend', () => {
    const r = run('Your portfolio holds £250,000.\n\n— C.')
    expect(r?.passed).toBe(false)
    expect(r?.detail).toContain('250000')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R4 minimal"`
Expected: FAIL (old `checkNumbersMatchCsv` flags 1717, 1283, etc., and isn't wired the same way).

- [ ] **Step 3: Implement minimal R4 in `judge.ts`**

Add (and remove the old `extractNumbers` + `checkNumbersMatchCsv`):

```ts
/** Currency-anchored money tokens only: £/€/$ then digits with optional thousands commas/decimals. */
function extractMoneyTokens(text: string): number[] {
  const re = /[£€$]\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function checkMinimalNumbers(text: string, csv: CsvSummary | null): HardRuleResult {
  if (!csv) return { ruleId: 'R4_numbers_match_csv', passed: true }
  const round2 = (n: number) => Math.round(n * 100) / 100
  const plausible = [
    ...csv.allNumbersMentioned,
    ...csv.topMerchants.map((m) => round2(m.total)),
    round2(csv.incomeTotal),
    round2(csv.spendingTotal),
  ]
  const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01)
  const violations: number[] = []
  for (const n of extractMoneyTokens(text)) {
    const ok = plausible.some((p) => within(n, p))
    if (!ok && n > csv.spendingTotal) violations.push(n)
  }
  return violations.length
    ? { ruleId: 'R4_numbers_match_csv', passed: false, detail: `Implausible money figure(s) exceeding total spend: ${violations.slice(0, 5).join(', ')}` }
    : { ruleId: 'R4_numbers_match_csv', passed: true }
}
```

In `evaluateHardRules` (insight branch), replace the `if (rules?.insight?.numbersMustMatchCsv) { checkNumbersMatchCsv(...) }` block with an unconditional:

```ts
    out.push(checkMinimalNumbers(content, csvSummary))
```

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R4 minimal"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/onboarding/runner/judge.ts tests/onboarding/unit/judge.test.ts
git commit -m "fix(judge): minimal currency-anchored R4 (no false-positives on years/%/computed facts)"
```

---

## Task 4: R5 — currency symbol matches persona

The deterministic guard for the €-on-GBP bug. Persona-specific, so it lives in `judge.ts`.

**Files:**
- Modify: `tests/onboarding/runner/judge.ts`
- Test: `tests/onboarding/unit/judge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { zaneSpain } from '../personas/zane-spain'

describe('R5 currency symbol', () => {
  const r5 = (persona: typeof builderClassic, read: string) =>
    evaluateHardRules(persona, 'insight', read, null).find((r) => r.ruleId === 'R5_currency_symbol')

  it('fails a GBP persona whose Read uses €', () => {
    expect(r5(builderClassic, loadRead('builder-classic.captured'))?.passed).toBe(false)
  })
  it('passes a GBP persona whose Read uses £', () => {
    expect(r5(builderClassic, loadRead('builder-classic.gbp'))?.passed).toBe(true)
  })
  it('passes a EUR persona whose Read uses €', () => {
    expect(r5(zaneSpain, loadRead('zane-spain.captured'))?.passed).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R5 currency"`
Expected: FAIL — rule `R5_currency_symbol` not produced yet.

- [ ] **Step 3: Implement R5 in `judge.ts`**

```ts
const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' }
const ALL_SYMBOLS = ['£', '€', '$']

function checkCurrencySymbol(text: string, persona: Persona): HardRuleResult {
  const expected = CURRENCY_SYMBOL[(persona.profile.currency ?? '').toUpperCase()]
  if (!expected) return { ruleId: 'R5_currency_symbol', passed: true } // unknown currency — skip
  for (const sym of ALL_SYMBOLS) {
    if (sym !== expected && text.includes(sym)) {
      return { ruleId: 'R5_currency_symbol', passed: false, detail: `foreign symbol "${sym}" present, expected "${expected}"` }
    }
  }
  const quotesMoney = /\d{2,}/.test(text)
  if (quotesMoney && !text.includes(expected)) {
    return { ruleId: 'R5_currency_symbol', passed: false, detail: `expected symbol "${expected}" not found` }
  }
  return { ruleId: 'R5_currency_symbol', passed: true }
}
```

Wire it into the insight branch of `evaluateHardRules`:

```ts
    out.push(checkCurrencySymbol(content, persona))
```

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R5 currency"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/onboarding/runner/judge.ts tests/onboarding/unit/judge.test.ts
git commit -m "feat(judge): R5 currency-symbol-matches-persona (deterministic €/£ guard)"
```

---

## Task 5: R6 goal-denial + R7 system-note bans

R6 fires only for personas that seed a goal (the 2 goal-less personas must stay free to say "set a goal"). R7 always.

**Files:**
- Modify: `tests/onboarding/runner/judge.ts`
- Test: `tests/onboarding/unit/judge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('R6 goal-denial / R7 system-note', () => {
  // builderClassic seeds a goal after Task 9; for this unit we fake it inline:
  const withGoal = { ...builderClassic, expectations: { ...builderClassic.expectations, goal: { name: 'X', targetAmount: 1 } } }
  const noGoal = { ...builderClassic, expectations: { ...builderClassic.expectations, goal: undefined } }
  const r = (p: typeof builderClassic, read: string, id: string) =>
    evaluateHardRules(p, 'insight', read, null).find((x) => x.ruleId === id)

  it('R6 fails when a goal-persona Read denies the goal', () => {
    expect(r(withGoal, loadRead('bad-goal-denial'), 'R6_no_goal_denial')?.passed).toBe(false)
  })
  it('R6 is exempt for goal-less personas (prompting "set a goal" is fine)', () => {
    expect(r(noGoal, loadRead('bad-goal-denial'), 'R6_no_goal_denial')?.passed).toBe(true)
  })
  it('R7 fails on a leaked (System note: …)', () => {
    expect(r(noGoal, loadRead('bad-system-note'), 'R7_no_system_note')?.passed).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R6 goal-denial"`
Expected: FAIL — rules not produced yet.

- [ ] **Step 3: Implement R6 + R7 in `judge.ts`**

```ts
const GOAL_DENIAL_RE: RegExp[] = [
  /\bno (active )?goal\b/i,
  /\bdon'?t have (a|any) goal\b/i,
  /\bwithout a goal\b/i,
  /\bhaven'?t set (a|any) goal\b/i,
  /\bno goal (attached|set|on file)\b/i,
]

function checkGoalDenial(text: string, persona: Persona): HardRuleResult {
  if (!persona.expectations.goal) return { ruleId: 'R6_no_goal_denial', passed: true }
  const hit = GOAL_DENIAL_RE.find((re) => re.test(text))
  return hit
    ? { ruleId: 'R6_no_goal_denial', passed: false, detail: `goal-denial phrase matched ${hit}` }
    : { ruleId: 'R6_no_goal_denial', passed: true }
}

function checkSystemNoteLeak(text: string): HardRuleResult {
  return /\(System note:/i.test(text)
    ? { ruleId: 'R7_no_system_note', passed: false, detail: 'leaked "(System note: …)" QA diagnostic' }
    : { ruleId: 'R7_no_system_note', passed: true }
}
```

Wire both into `evaluateHardRules` (top, before the archetype/insight split so they apply to both):

```ts
  out.push(checkSystemNoteLeak(content))
  out.push(checkGoalDenial(content, persona))
```

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R6 goal-denial"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/onboarding/runner/judge.ts tests/onboarding/unit/judge.test.ts
git commit -m "feat(judge): R6 goal-denial (goal personas only) + R7 system-note bans"
```

---

## Task 6: R8 CTA vocabulary + retire dead value-first detection + merchant-citation threshold

Accept the real onboarding CTA vocabulary; gate merchant citation (R3 + H8) on `transactionCount ≥ 20` so low-transaction personas (aiko) that cite categories aren't false-failed.

**Files:**
- Modify: `tests/onboarding/runner/judge.ts`
- Test: `tests/onboarding/unit/judge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise'

describe('R8 CTA vocabulary + merchant threshold', () => {
  it('R8 passes a known CTA type (set_goal)', () => {
    const read = 'Body.\n\n[CTA:set_goal]Set a goal[/CTA]\n\n— C.'
    expect(evaluateHardRules(builderClassic, 'insight', read, null).find((r) => r.ruleId === 'R8_cta_vocabulary')?.passed).toBe(true)
  })
  it('R8 fails an unknown CTA type', () => {
    const read = 'Body.\n\n[CTA:teleport]Go[/CTA]\n\n— C.'
    expect(evaluateHardRules(builderClassic, 'insight', read, null).find((r) => r.ruleId === 'R8_cta_vocabulary')?.passed).toBe(false)
  })
  it('does not emit H8_cites_known_merchant below the txn threshold', () => {
    // aiko captured Read cites categories, not merchants; with <20 txns H8 must not run
    const aikoCsv = summariseCsv('Type,Started Date,Description,Amount,Currency,Balance\nCARD_PAYMENT,2026-01-01,Tesco,-10,GBP,0', 'GBP')
    const rules = evaluateHardRules(builderClassic, 'insight', loadRead('aiko-low-transaction.gbp'), aikoCsv)
    expect(rules.find((r) => r.ruleId === 'H8_cites_known_merchant')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R8 CTA"`
Expected: FAIL.

- [ ] **Step 3: Implement in `judge.ts`**

Add the import at top: `import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise'`

Add the rule + constant:

```ts
const ALLOWED_CTA_TYPES = ['supply_input', 'set_goal', 'start_value_map_real']

function checkCtaVocabulary(text: string): HardRuleResult {
  const types = [...text.matchAll(/\[CTA:([a-z_]+)\]/gi)].map((m) => m[1].toLowerCase())
  if (types.length === 0) return { ruleId: 'R8_cta_vocabulary', passed: true } // H3 handles "missing CTA"
  const bad = types.filter((t) => !ALLOWED_CTA_TYPES.includes(t))
  return bad.length
    ? { ruleId: 'R8_cta_vocabulary', passed: false, detail: `unknown CTA type(s): ${bad.join(', ')}` }
    : { ruleId: 'R8_cta_vocabulary', passed: true }
}
```

Rewrite the insight branch's merchant handling with the threshold + normalisation:

```ts
    const MERCHANT_CITATION_MIN_TXNS = 20
    const txnCount = csvSummary?.transactionCount ?? 0
    out.push(checkCurrencySymbol(content, persona))
    out.push(checkCtaVocabulary(content))
    if (txnCount >= MERCHANT_CITATION_MIN_TXNS) {
      out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceMerchantsFromCsv, 'R3_insight_references_csv_merchants'))
    }
    out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceOneOf, 'R3b_insight_mentions_one_of'))
    out.push(checkMinimalNumbers(content, csvSummary))
    // Pass BOTH the raw lowercased description and the normalised form: the Read's prose
    // usually quotes the merchant as-it-appears, while clusters_referenced use the normalised
    // key. Matching either avoids H8 false-fails from normalisation drift.
    const knownMerchants =
      txnCount >= MERCHANT_CITATION_MIN_TXNS
        ? (csvSummary?.topMerchants.flatMap((m) => [
            m.description.toLowerCase(),
            normaliseMerchantDescription(m.description).toLowerCase(),
          ]) ?? [])
        : []
    for (const r of checkReadHardRules(content, { mode: 'default', knownMerchants })) {
      out.push({ ruleId: r.ruleId, passed: r.passed, detail: r.detail })
    }
```

(`checkReadHardRules` only emits H8 when `knownMerchants.length > 0`, so an empty array below-threshold suppresses it.)

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "R8 CTA"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/onboarding/runner/judge.ts tests/onboarding/unit/judge.test.ts
git commit -m "feat(judge): R8 CTA vocabulary, retire dead value-first detection, gate merchant citation on txn count"
```

---

## Task 7: Recalibrate persona insight rules + full-corpus assertion

Now make the **good** corpus pass every rule and the **bad** corpus fail the intended rule. Recalibrate each persona's `hardRules.insight.mustReferenceOneOf` (value-first vocabulary) and `mustReferenceMerchantsFromCsv` (normalised top-merchant token), and drop the now-unused `numbersMustMatchCsv` flag.

**Files:**
- Modify: `tests/onboarding/personas/*.ts` (insight hardRules)
- Modify: `tests/onboarding/personas/types.ts` (remove `numbersMustMatchCsv`)
- Test: `tests/onboarding/unit/judge.test.ts`

- [ ] **Step 1: Write the corpus-wide failing test**

```ts
import * as personas from '../personas'

const PERSONA_BY_ID = Object.fromEntries(
  Object.values(personas).filter((p: any) => p && p.id).map((p: any) => [p.id, p]),
)
const CONTRACT_RULES = ['H1_signoff_present','H2_within_word_cap','H3_exactly_one_cta','H4_no_options_block','H5_no_question_close','H6_no_emoji','H7_voice_no_banned','R1_no_banned_words','R1b_no_banned_patterns','R5_currency_symbol','R8_cta_vocabulary','R4_numbers_match_csv','R3b_insight_mentions_one_of','R6_no_goal_denial','R7_no_system_note']

function csvFor(p: any) {
  return p.csv ? summariseCsv(Buffer.from(p.csv.contentBase64, 'base64').toString('utf-8'), p.profile.currency) : null
}

describe('golden corpus — good Reads pass every rule', () => {
  for (const id of Object.keys(PERSONA_BY_ID)) {
    const p = PERSONA_BY_ID[id]
    const fixture = p.profile.currency === 'EUR' ? `${id}.captured` : `${id}.gbp`
    it(`${id}: all hard rules pass on the good Read`, () => {
      const rules = evaluateHardRules(p, 'insight', loadRead(fixture), csvFor(p))
      const failed = rules.filter((r) => !r.passed)
      expect(failed.map((f) => `${f.ruleId}:${f.detail ?? ''}`)).toEqual([])
    })
  }
})

describe('golden corpus — bad Reads fail the intended rule', () => {
  const cases: [string, string][] = [
    ['bad-missing-signoff', 'H1_signoff_present'],
    ['bad-options-block', 'H4_no_options_block'],
    ['bad-question-close', 'H5_no_question_close'],
    ['bad-euro-on-gbp', 'R5_currency_symbol'],
  ]
  for (const [fixture, ruleId] of cases) {
    it(`${fixture} → ${ruleId} fails`, () => {
      const rules = evaluateHardRules(builderClassic, 'insight', loadRead(fixture), null)
      expect(rules.find((r) => r.ruleId === ruleId)?.passed).toBe(false)
    })
  }
})
```

- [ ] **Step 2: Run to see which personas/rules fail**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "golden corpus"`
Expected: FAIL — `R3b` (stale vocab) and possibly `H8`/`R3` for ≥20-txn personas whose `.gbp` fixture doesn't name the normalised top merchant. Read the failure list; it tells you exactly what to recalibrate.

- [ ] **Step 3: Recalibrate each persona's insight rules**

For each persona, set `hardRules.insight` to vocabulary the captured Read actually contains. Reference values (derived from the captured Reads; verify against the failure output and adjust):

| Persona | `mustReferenceOneOf` (value-first vocab present in the Read) | `mustReferenceMerchantsFromCsv` (only used if ≥20 txns; normalised top merchant) |
|---|---|---|
| builder-classic | `['housing','groceries','free cash flow','fixed costs','snapshot']` | `['rent landlord']` |
| fortress-saver | `['housing','free cash flow','fixed costs','goal']` | `['rent']` |
| truth-teller-balanced | `['snapshot','transactions','free cash flow','rent']` | `['sainsbury','rent']` |
| drifter-expat | `['rent','eating out','groceries','free cash flow']` | `['mercadona','rent']` |
| anchor-debt | `['rent','fixed costs','free cash flow','largest merchant']` | `['rent']` |
| time-saver-expert | `['housing','groceries','subscriptions','fixed costs']` | `['rent flat']` |
| aiko-low-transaction | `['housing','shopping','groceries','free cash flow']` | `[]` (always <20 txns) |
| sofia-chaotic | `['housing','free cash flow','snapshot']` | `['sublet']` |
| tom-long-history | `['snapshot','fixed costs','take-home','housing']` | `['rent']` |
| zane-spain | `['health','groceries','rent','fixed cost','free cash flow']` | `['alquiler','mercadona']` |

Remove the `numbersMustMatchCsv: true` line from every persona (R4 is now unconditional).

Example edit (`tests/onboarding/personas/zane-spain.ts`, the `hardRules.insight` block):

```ts
      insight: {
        mustReferenceMerchantsFromCsv: ['alquiler', 'mercadona'],
        mustReferenceOneOf: ['health', 'groceries', 'rent', 'fixed cost', 'free cash flow'],
      },
```

> Iterate Step 2 ↔ Step 3 until the "good Reads pass every rule" block is green. The vocab lists are lowercase substrings; `checkMustMentionOneOf` lowercases the text. Keep each list to terms genuinely present (the test enforces it).

- [ ] **Step 4: Remove `numbersMustMatchCsv` from the type**

In `tests/onboarding/personas/types.ts`, delete the `numbersMustMatchCsv?: boolean` line from the `insight` shape.

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/judge.test.ts -t "golden corpus"`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tests/onboarding/personas tests/onboarding/unit/judge.test.ts
git commit -m "test(judge): recalibrate persona insight rules to value-first vocabulary; corpus green"
```

---

## Task 8: Product currency fix — `getFinancialFacts` uses `resolveUserCurrency`

The real defect (#4). One site fixes every number in the Read.

**Files:**
- Modify: `src/lib/ai/compose-first-read.ts` (`getFinancialFacts`, ~L264–328)
- Test: `src/lib/analytics/__tests__/insight-engine.test.ts` (add cases if `resolveUserCurrency` lacks them) — verify existing first.

- [ ] **Step 1: Confirm `resolveUserCurrency` coverage**

Run: `./node_modules/.bin/vitest run src/lib/analytics -t "resolveUserCurrency"`
Expected: existing tests pass (or none found). If none, add:

```ts
import { resolveUserCurrency } from '../insight-engine'
describe('resolveUserCurrency', () => {
  it('uses country when profile currency is the EUR default and no txn signal', () => {
    expect(resolveUserCurrency('GB', 'EUR', [])).toBe('GBP')
  })
  it('trusts an explicit non-default profile currency', () => {
    expect(resolveUserCurrency(null, 'GBP', [])).toBe('GBP')
  })
  it('falls back to EUR for unknown country with no signal', () => {
    expect(resolveUserCurrency('ES', 'EUR', [])).toBe('EUR')
  })
})
```

Run: `./node_modules/.bin/vitest run src/lib/analytics`
Expected: PASS.

- [ ] **Step 2: Wire `resolveUserCurrency` into `getFinancialFacts`**

In `src/lib/ai/compose-first-read.ts`:
- Add the import: `import { resolveUserCurrency } from '@/lib/analytics/insight-engine'`
- Add `country` to the profile select (L271): `.select('net_monthly_income, monthly_rent, primary_currency, income_shape, t3m_income_monthly, country')`
- Add a transactions-currency query inside `getFinancialFacts` (alongside the existing `Promise.all`):

```ts
  const txnRes = await supabase
    .from('transactions')
    .select('currency')
    .eq('user_id', userId)
    .limit(500)
```

- Replace the `currency:` field (L318–321) with:

```ts
    currency: resolveUserCurrency(
      (profileRes.data?.country as string | null) ?? null,
      (profileRes.data?.primary_currency as string | null) ?? null,
      (txnRes.data as Array<{ currency?: string | null }> | null) ?? [],
    ),
```

> NOTE / FLAG: `transactions.currency` defaults to `'EUR'` in the schema; if the CSV importer doesn't persist the real currency, the dominant-transaction signal is unreliable and `country` carries the resolution. The harness sets `country` (Task 10) so the suite resolves correctly and guards this fix. Whether real production users reliably have `country`/`transactions.currency` set is a separate question — note it in the PR (see Task 14).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (End-to-end verification happens in Task 14.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/compose-first-read.ts src/lib/analytics/__tests__/insight-engine.test.ts
git commit -m "fix(first-read): resolve currency via country/transactions, not primary_currency||EUR"
```

---

## Task 9: Harness realism — persona income/rent + driver writes country

**Files:**
- Modify: `tests/onboarding/personas/*.ts` (add `monthlyIncome`/`monthlyRent`)
- Modify: `tests/onboarding/runner/playwright-driver.ts` (write `country`)
- Create: `tests/onboarding/unit/personas.test.ts`

- [ ] **Step 1: Write the failing realism test**

Create `tests/onboarding/unit/personas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as personas from '../personas'
import { summariseCsv } from '../runner/csv-summariser'

const ALL = Object.values(personas).filter((p: any) => p && p.id) as any[]

describe('persona income/rent realism', () => {
  for (const p of ALL) {
    it(`${p.id}: monthlyIncome and monthlyRent are set`, () => {
      expect(typeof p.profile.monthlyIncome).toBe('number')
      expect(typeof p.profile.monthlyRent).toBe('number')
    })
    if (true) {
      it(`${p.id}: monthlyIncome within 25% of CSV-derived monthly income`, () => {
        if (!p.csv) return
        const csv = summariseCsv(Buffer.from(p.csv.contentBase64, 'base64').toString('utf-8'), p.profile.currency)
        const months = Math.max(1, Math.round(
          (new Date(csv.dateRange.to).getTime() - new Date(csv.dateRange.from).getTime()) / (1000 * 60 * 60 * 24 * 30),
        ))
        const csvMonthly = csv.incomeTotal / months
        if (csvMonthly < 100) return // personas with no income rows in CSV — skip
        expect(Math.abs(p.profile.monthlyIncome - csvMonthly) / csvMonthly).toBeLessThan(0.25)
      })
    }
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/personas.test.ts`
Expected: FAIL — most personas have no `monthlyIncome`/`monthlyRent`.

- [ ] **Step 3: Set income/rent on each persona**

In each `tests/onboarding/personas/<id>.ts`, add to the `profile` object. Compute `monthlyIncome ≈ CSV income total ÷ months`, `monthlyRent ≈ modal rent transaction`. Known values (verify against the test, adjust to pass):

| Persona | monthlyIncome | monthlyRent |
|---|---|---|
| builder-classic | 5000 | 1100 |
| fortress-saver | 3000 | 1950 |
| truth-teller-balanced | 3500 | 900 |
| drifter-expat | 2700 | 950 |
| anchor-debt | 3000 | 780 |
| time-saver-expert | 6200 | 1800 |
| aiko-low-transaction | 3000 | 1150 |
| sofia-chaotic | 3200 | 700 |
| tom-long-history | 4200 | 1420 |
| zane-spain | 2350 | 820 |

Example (`tests/onboarding/personas/time-saver-expert.ts`):

```ts
  profile: {
    displayName: 'Pat',
    country: 'GB',
    currency: 'GBP',
    monthlyIncome: 6200,
    monthlyRent: 1800,
  },
```

- [ ] **Step 4: Driver writes `country` to the profile (idempotent)**

In `tests/onboarding/runner/playwright-driver.ts`, extend `ensureEntryStruggle` (which already runs in the struggle stage where the profile row exists) to also persist `country`:

```ts
async function ensureEntryStruggle(admin: SupabaseClient, user: TestUser, persona: Persona): Promise<void> {
  const { data: prof } = await admin
    .from('user_profiles')
    .select('entry_struggle, country')
    .eq('id', user.id)
    .maybeSingle()
  const patch: Record<string, unknown> = {}
  if (!prof?.entry_struggle) patch.entry_struggle = persona.expectations.entryStruggle
  if (!prof?.country) patch.country = persona.profile.country
  if (Object.keys(patch).length > 0) {
    await admin.from('user_profiles').update(patch).eq('id', user.id)
  }
}
```

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/personas.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tests/onboarding/personas tests/onboarding/runner/playwright-driver.ts tests/onboarding/unit/personas.test.ts
git commit -m "test(onboarding): realistic persona income/rent + driver seeds country for currency resolution"
```

---

## Task 10: Seed goals on 8 personas with variance

**Files:**
- Modify: `tests/onboarding/personas/types.ts` (narrow `goal.type`)
- Modify: 8 persona files (add `goal`)
- Modify: `tests/onboarding/runner/db-assertions.ts` (assert goal presence)
- Modify: `tests/onboarding/runner/types.ts` (add `goalsCount` to `DbStateSnapshot`)
- Modify: `tests/onboarding/runner/db-assertions.ts` `snapshotDbState` (count goals)
- Test: `tests/onboarding/unit/personas.test.ts`

- [ ] **Step 1: Write the failing goal-variance test**

Append to `tests/onboarding/unit/personas.test.ts`:

```ts
const VALID_GOAL_TYPES = ['debt_clearance', 'savings', 'investment', 'general']

describe('goal coverage + variance', () => {
  const withGoals = ALL.filter((p) => p.expectations.goal)
  const without = ALL.filter((p) => !p.expectations.goal).map((p) => p.id).sort()

  it('at least 8 personas seed a goal', () => {
    expect(withGoals.length).toBeGreaterThanOrEqual(8)
  })
  it('the goal-less personas are exactly the prompt-path pair', () => {
    expect(without).toEqual(['aiko-low-transaction', 'fortress-saver'])
  })
  it('every seeded goal.type is a valid enum value', () => {
    for (const p of withGoals) expect(VALID_GOAL_TYPES).toContain(p.expectations.goal.type)
  })
  it('all four goal types appear (real variance)', () => {
    const types = new Set(withGoals.map((p) => p.expectations.goal.type))
    expect([...types].sort()).toEqual(['debt_clearance', 'general', 'investment', 'savings'])
  })
  it('every seeded goal has a positive target amount', () => {
    for (const p of withGoals) expect(p.expectations.goal.targetAmount).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/personas.test.ts -t "goal coverage"`
Expected: FAIL — no personas seed goals.

- [ ] **Step 3: Narrow the goal type**

In `tests/onboarding/personas/types.ts`, change the `goal` shape:

```ts
  goal?: {
    name: string
    type?: 'debt_clearance' | 'savings' | 'investment' | 'general'
    targetAmount: number
    currentAmount?: number
    targetDate?: string
  }
```

- [ ] **Step 4: Add `goal` to 8 personas** (NOT fortress-saver, NOT aiko-low-transaction)

Add to each persona's `expectations` object. Values:

| Persona | type | name | targetAmount | currentAmount | targetDate |
|---|---|---|---|---|---|
| builder-classic | `investment` | `Grow ISA pot` | 40000 | 12000 | `2028-06-01` |
| time-saver-expert | `investment` | `Max the ISA` | 20000 | 8898 | `2026-12-31` |
| tom-long-history | `investment` | `Pension top-up` | 50000 | 9000 | — |
| truth-teller-balanced | `savings` | `6-month safety net` | 15000 | 3000 | `2027-06-01` |
| sofia-chaotic | `savings` | `3-month runway` | 9600 | 2000 | — |
| zane-spain | `savings` | `Entrada para piso` | 30000 | 5000 | `2029-01-01` |
| anchor-debt | `debt_clearance` | `Clear credit card` | 8000 | 1500 | `2027-01-01` |
| drifter-expat | `general` | `Move-home fund` | 6000 | 1200 | — |

Example (`tests/onboarding/personas/anchor-debt.ts`, inside `expectations`):

```ts
    goal: {
      name: 'Clear credit card',
      type: 'debt_clearance',
      targetAmount: 8000,
      currentAmount: 1500,
      targetDate: '2027-01-01',
    },
```

(Omit `targetDate` for the three with `—`.)

- [ ] **Step 5: Assert goal persistence in DB snapshot**

In `tests/onboarding/runner/types.ts`, add to `DbStateSnapshot`:

```ts
  /** Count of goals for the user — checked against persona.expectations.goal presence. */
  goalsCount: number
```

In `tests/onboarding/runner/db-assertions.ts` `snapshotDbState`, add to the `Promise.all` and return:

```ts
    admin.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId),
```
```ts
    goalsCount: goalsRes.count ?? 0,
```
(destructure `goalsRes` in the array.)

In `assertDbState`, add:

```ts
  if (persona.expectations.goal && snapshot.goalsCount < 1) {
    errors.push(`goals: expected a seeded goal for ${persona.id}, found 0`)
  }
  if (!persona.expectations.goal && snapshot.goalsCount > 0) {
    errors.push(`goals: expected no goal for ${persona.id}, found ${snapshot.goalsCount}`)
  }
```

- [ ] **Step 6: Run to verify pass + typecheck**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/personas.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tests/onboarding/personas tests/onboarding/runner/db-assertions.ts tests/onboarding/runner/types.ts tests/onboarding/unit/personas.test.ts
git commit -m "test(onboarding): seed goals on 8 personas with variance + assert goal persistence"
```

---

## Task 11: Functional fix — poll `onboarding_completed_at` after the Read

Fixes the sofia/zane functional race.

**Files:**
- Modify: `tests/onboarding/runner/playwright-driver.ts`

- [ ] **Step 1: Add the poll helper**

In `tests/onboarding/runner/playwright-driver.ts`, add near `pollFirstAssistantMessage`:

```ts
/** Poll until onboarding_completed_at is stamped (advanceStep runs a beat after the message). */
async function pollOnboardingComplete(admin: SupabaseClient, userId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { data } = await admin
      .from('user_profiles')
      .select('onboarding_completed_at, onboarding_step')
      .eq('id', userId)
      .maybeSingle()
    if (data?.onboarding_completed_at || data?.onboarding_step === 'first_read_delivered') return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}
```

- [ ] **Step 2: Call it in the `first_read` stage**

In `runOnboarding`, the `first_read` `driveStage` body (currently L238–242), after capturing the insight:

```ts
  await driveStage(page, 'first_read', persona, opts, result, async () => {
    const insight = await pollFirstReadAssistantMessage(opts.admin, user.id, 150_000)
    if (insight) result.capturedInsight = insight
    else throw new Error('first_read assistant message did not arrive within 150s')
    // Stamp lands a beat later in advanceStep('first_read_delivered'); wait so the DB
    // snapshot in persona-runner sees onboarding_completed_at. Proceed on timeout so a
    // genuine regression still surfaces as the assertion failure (not a driver crash).
    await pollOnboardingComplete(opts.admin, user.id, 30_000)
  })
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Behavioural verification is the Task 14 e2e run.)

- [ ] **Step 4: Commit**

```bash
git add tests/onboarding/runner/playwright-driver.ts
git commit -m "test(onboarding): poll onboarding_completed_at after Read to fix snapshot race (sofia/zane)"
```

---

## Task 12: Teardown — delete `llm_usage_log` orphans

**Files:**
- Modify: `tests/onboarding/runner/user-factory.ts`
- Test: `tests/onboarding/unit/personas.test.ts` (or a tiny new unit)

- [ ] **Step 1: Write the failing test**

Append to `tests/onboarding/unit/personas.test.ts`:

```ts
import { USER_DATA_TABLES_BY_USER_ID } from '../runner/user-factory'

describe('teardown coverage', () => {
  it('includes llm_usage_log (prevents orphan accumulation)', () => {
    expect(USER_DATA_TABLES_BY_USER_ID).toContain('llm_usage_log')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/personas.test.ts -t "teardown"`
Expected: FAIL — `USER_DATA_TABLES_BY_USER_ID` is not exported / lacks the table.

- [ ] **Step 3: Export the list + add the table**

In `tests/onboarding/runner/user-factory.ts`, add `export` to the const and add `'llm_usage_log'` first (delete dependents before the profile/auth row):

```ts
export const USER_DATA_TABLES_BY_USER_ID = [
  'llm_usage_log',
  'value_category_rules',
  'financial_portrait',
  'goals',
  'assets',
  'liabilities',
  'action_items',
  'messages',
  'conversations',
  'transactions',
] as const
```

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run tests/onboarding/unit/personas.test.ts -t "teardown"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/onboarding/runner/user-factory.ts tests/onboarding/unit/personas.test.ts
git commit -m "test(onboarding): tear down llm_usage_log to stop orphan accumulation (Bug #3)"
```

---

## Task 13: Full local gate — all unit tests + CI checks green

**Files:** none (verification task)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: PASS — all suites incl. `tests/onboarding/unit/judge.test.ts`, `personas.test.ts`, and the pre-existing 1108 tests.

- [ ] **Step 2: CI gates**

Run: `npm run typecheck && npm run lint && npm run knip`
Expected: no errors. (If `knip` flags the new fixtures/loader as unused, ensure they are imported by the tests; if it flags `evaluateHardRules`/`readContent` exports, they are used by tests — confirm knip config treats `tests/**` as entry. If not, that's pre-existing config; note it, don't fight it here.)

- [ ] **Step 3: Commit (if any lint autofix applied)**

```bash
git add -A && git commit -m "chore: lint/typecheck/knip green for judge recalibration" || echo "nothing to commit"
```

---

## Task 14: Staging e2e — capture Phase-2 corpus, verify green

This exercises the product currency fix, goal seeding, and the race fix end-to-end, and captures the authoritative £/goal-aware corpus.

**Files:**
- Replace: `tests/onboarding/fixtures/reads/*.gbp.txt` (with fresh captures)

- [ ] **Step 1: Run the judged suite against Staging**

Ensure Staging env vars are loaded (`runner/_load-env.ts`). Run:

Run: `npm run test:onboarding`
Expected: a new `test-output/<timestamp>/` with `summary.json` + `report.html`. Target: functional 10/10, judge hard-rules 10/10.

- [ ] **Step 2: Inspect results**

```bash
node -e 'const s=require("./tests/onboarding/test-output/"+require("fs").readdirSync("tests/onboarding/test-output").filter(d=>d.startsWith("2026")).sort().pop()+"/summary.json");for(const p of s.personas)console.log(p.personaId,p.layers,(p.hardRuleFailures||[]).join("|"))'
```
Expected: every `functional`/`llm`/`visual` = `pass`; empty `hardRuleFailures`. If any rule fails, read the detail — recalibrate the specific persona vocab (Task 7 Step 3) or fix the surfaced product issue, then re-run.

- [ ] **Step 3: Refresh the Phase-2 corpus from this run**

Replace the synthetic `.gbp.txt` positives with the real captured (now £, goal-aware) Reads, and refresh the EUR `.captured.txt`:

```bash
node -e '
const fs=require("fs");
const dir="tests/onboarding/test-output/"+fs.readdirSync("tests/onboarding/test-output").filter(d=>d.startsWith("2026")).sort().pop();
const s=require("./"+dir+"/summary.json");
for(const p of s.personas){
  const i=p.captured&&p.captured.insight; if(!i) continue;
  const content=typeof i==="string"?i:i.content; if(!content) continue;
  const f = p.personaId+(/EUR/i.test(p.label)?".captured":".gbp");
  // write both: keep .captured authoritative, regenerate .gbp for GBP personas
  fs.writeFileSync("tests/onboarding/fixtures/reads/"+p.personaId+".captured.txt", content);
}
console.log("refreshed corpus from", dir);
'
```

Re-run the corpus unit tests to confirm the rules still pass on the real post-fix Reads:

Run: `npm run test`
Expected: PASS. If a goal persona's Read reliably references its goal, **promote goal-reference to a hard rule**: add to `evaluateHardRules` (insight) a check that goal personas' Reads include the goal name or target amount, and add the corresponding corpus assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/onboarding/fixtures
git commit -m "test(judge): refresh golden corpus from green Staging run (£, goal-aware)"
```

---

## Task 15: Docs, flag, and PR

**Files:**
- Modify: `tests/onboarding/FINDINGS.md`
- (Optional) Modify: `CLAUDE.md` (CTA contract note)

- [ ] **Step 1: Update FINDINGS.md**

Replace the "Open items — value-first rewrite" section with the resolved status: functional 10/10, judge 10/10, the H1-wrapper root cause, the currency product fix, goal coverage 8/10, and the **flagged CTA contract drift** (CLAUDE.md says `start_value_map_real`; product emits `supply_input`/`set_goal`) plus the **transaction-undercount observation** (e.g. zane "15 transactions" vs ~60 imported — investigate separately) and the **`transactions.currency` default-EUR / real-user currency resolution** question for the product team.

- [ ] **Step 2: Final full gate**

Run: `npm run typecheck && npm run lint && npm run knip && npm run test`
Expected: all green.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin fix/validator-note-leak
gh pr create --fill --title "Recalibrate onboarding judge + fix €-currency and income realism" --body "$(cat <<'EOF'
## Summary
- Fix the dominant judge bug: deterministic rules were grading the message *wrapper object*, failing H1/H5 on all 10 personas. Judge now evaluates the unwrapped content string.
- Recalibrate every deterministic rule for the value-first Read (minimal currency-anchored R4, R5 currency-symbol, R6 goal-denial, R7 system-note, R8 CTA vocabulary, merchant-citation gated on txn count). Flat gate retained.
- Fix two real defects the judge surfaced: (1) the first Read rendered € for all GBP users (`getFinancialFacts` now resolves currency via country/transactions, not `primary_currency||EUR`); (2) personas fed a default 3000 income contradicting their CSV (realistic per-persona income/rent).
- Goals are now core-tested: 8/10 personas seed goals with full type variance; 2 kept goal-less to test the prompt path. Goal persistence asserted; goal-denial banned for goal personas.
- New offline golden corpus (`tests/onboarding/unit/judge.test.ts`) pins every rule's verdict in CI — no Bedrock/browser needed to calibrate.
- Hygiene: teardown deletes `llm_usage_log` orphans; functional race fixed (poll `onboarding_completed_at`).

## Flags for product (non-blocking)
- CTA contract drift: CLAUDE.md/onboarding docs say the value-first Read closes on `[CTA:start_value_map_real]`; the product emits `supply_input`/`set_goal`. Confirm intended behaviour.
- The Read appears to undercount transactions (e.g. zane "15" vs ~60 imported) — investigate the spending-picture window.
- `transactions.currency` defaults to EUR; confirm real users have `country`/`currency` set so the currency fix helps production, not just the suite.

## Verification
- `npm run typecheck && npm run lint && npm run knip && npm run test` green.
- `npm run test:onboarding` (Staging): functional 10/10, judge 10/10.
EOF
)"
```

---

## Self-Review

**Spec coverage** (spec §5/§6 ↔ tasks):
- A1 unwrap → Task 1 ✓ · A2 minimal R4 → Task 3 ✓ · A3 R3/R3b recalibration → Tasks 6, 7 ✓ · A4 R5 currency → Task 4 ✓ · A5 merchant threshold → Task 6 ✓ · A6 CTA → Task 6 ✓ · A7 bans → Task 5 ✓
- B1 product currency → Task 8 ✓ · B2 harness realism (income/rent + country) → Task 9 ✓
- C1 race → Task 11 ✓ · C2 teardown → Task 12 ✓
- D goals (8/10, variance) → Task 10 ✓
- E corpus + e2e + PR → Tasks 2, 13, 14, 15 ✓
- §4 golden corpus (two-phase) → Task 2 (phase 1) + Task 14 (phase 2) ✓
- §9 CTA flag → Task 15 ✓

**Placeholder scan:** income/rent and goal values given as explicit tables with an enforcing test (income within 25% of CSV-derived); R3b vocab given as a table with iterate-against-failures loop bounded by the corpus test. No "TBD"/"add validation"/"similar to". The only deliberately-deferred artefact is the Phase-2 corpus (Task 14), which is data captured from a real run, not code.

**Type consistency:** `readContent` / `evaluateHardRules` signatures consistent across Tasks 1–10. Rule IDs stable: `R3, R3b, R4_numbers_match_csv, R5_currency_symbol, R6_no_goal_denial, R7_no_system_note, R8_cta_vocabulary`, H1–H8 from `read-judge`. `DbStateSnapshot.goalsCount` defined (Task 10 Step 5) before use (assert). `USER_DATA_TABLES_BY_USER_ID` exported (Task 12) before the import in its test.

**Known caveat:** Task 13 Step 2 notes knip may treat `tests/**` differently — if exports/fixtures are flagged, confirm the knip config's entry globs rather than deleting used code; this is pre-existing config territory, not a plan failure.
