# Onboarding Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an on-demand automated test suite that drives the post-signup onboarding flow through 8 curated personas via Playwright, captures functional/LLM/visual signals, and produces an HTML report. Runnable as `npm run test:onboarding` against CFO Staging Supabase + real Bedrock.

**Architecture:** Custom Playwright-based CLI runner (not `@playwright/test`). Each persona runs as a throwaway Supabase Auth user. Unit tests (Vitest) run as preflight. LLM-as-judge uses Haiku 4.5 to grade captured archetype + insight outputs. Everything lives under `cfos-office/tests/onboarding/`.

**Tech Stack:** TypeScript, Playwright (Chromium), Vitest, Supabase service role client, `@ai-sdk/amazon-bedrock` (Haiku for judge), `tsx` for CLI, Node built-ins (`node:util` for args, `node:child_process` for dev server).

**Spec reference:** `cfos-office/docs/superpowers/specs/2026-04-20-onboarding-test-suite-design.md`

---

## File Map

### Created files
- `cfos-office/tests/onboarding/personas/types.ts` — Persona + expectations types
- `cfos-office/tests/onboarding/personas/index.ts` — Persona registry
- `cfos-office/tests/onboarding/personas/builder-classic.ts`
- `cfos-office/tests/onboarding/personas/fortress-saver.ts`
- `cfos-office/tests/onboarding/personas/truth-teller-balanced.ts`
- `cfos-office/tests/onboarding/personas/drifter-expat.ts`
- `cfos-office/tests/onboarding/personas/anchor-debt.ts`
- `cfos-office/tests/onboarding/personas/skip-value-map.ts`
- `cfos-office/tests/onboarding/personas/skip-csv-upload.ts`
- `cfos-office/tests/onboarding/personas/time-saver-expert.ts`
- `cfos-office/tests/onboarding/unit/calculate-personality.test.ts`
- `cfos-office/tests/onboarding/unit/seed-from-onboarding.test.ts`
- `cfos-office/tests/onboarding/unit/beat-skip-reducer.test.ts`
- `cfos-office/tests/onboarding/runner/cli.ts` — Entry point
- `cfos-office/tests/onboarding/runner/args.ts` — Arg parsing
- `cfos-office/tests/onboarding/runner/preflight.ts` — Env + prod guard
- `cfos-office/tests/onboarding/runner/dev-server.ts` — Spawn/kill Next dev
- `cfos-office/tests/onboarding/runner/user-factory.ts` — Create/delete test users
- `cfos-office/tests/onboarding/runner/persona-runner.ts` — Orchestrate 1 persona
- `cfos-office/tests/onboarding/runner/playwright-driver.ts` — Beat-level UI driver
- `cfos-office/tests/onboarding/runner/db-assertions.ts` — Post-handoff DB checks
- `cfos-office/tests/onboarding/runner/csv-summariser.ts` — CSV→summary for judge
- `cfos-office/tests/onboarding/runner/judge.ts` — LLM grading via Haiku
- `cfos-office/tests/onboarding/runner/reporter.ts` — HTML + JSON report
- `cfos-office/tests/onboarding/runner/types.ts` — Run result types
- `cfos-office/tests/onboarding/README.md`
- `cfos-office/tests/onboarding/unit/args.test.ts`
- `cfos-office/tests/onboarding/unit/csv-summariser.test.ts`
- `cfos-office/tests/onboarding/unit/preflight.test.ts`

### Modified files
- `cfos-office/package.json` — Add `test:onboarding` script + `playwright` + `tsx` deps
- `cfos-office/.gitignore` — Add `tests/onboarding/test-output/`

---

## Task 1: Dependencies & Scaffolding

**Files:**
- Modify: `cfos-office/package.json`
- Modify: `cfos-office/.gitignore`
- Create: `cfos-office/tests/onboarding/README.md`

- [ ] **Step 1: Install Playwright and tsx**

```bash
cd cfos-office
npm install --save-dev playwright tsx
npx playwright install chromium
```

Expected: Playwright installs, Chromium downloads (~120MB). No errors.

- [ ] **Step 2: Add npm script**

Edit `cfos-office/package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "seed:test-user": "npx tsx scripts/seed-test-user.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:onboarding": "tsx tests/onboarding/runner/cli.ts"
  }
}
```

- [ ] **Step 3: Update .gitignore**

Append to `cfos-office/.gitignore`:

```
# Onboarding test suite artifacts
tests/onboarding/test-output/
```

- [ ] **Step 4: Create directory structure + placeholder README**

```bash
mkdir -p cfos-office/tests/onboarding/personas
mkdir -p cfos-office/tests/onboarding/runner
mkdir -p cfos-office/tests/onboarding/unit
```

Create `cfos-office/tests/onboarding/README.md`:

```markdown
# Onboarding Test Suite

On-demand automated tests for the post-signup onboarding flow. Drives 8 curated personas through the UI via Playwright, grades LLM output, captures screenshots.

## Run

```bash
npm run test:onboarding                              # full suite
npm run test:onboarding -- --personas drifter-expat  # one persona
npm run test:onboarding -- --skip-judge              # no Bedrock judge calls
npm run test:onboarding -- --keep-users              # don't teardown DB rows
npm run test:onboarding -- --concurrency 1           # serial (default 2)
```

## Requirements

- `.env.local` pointing at CFO **Staging** Supabase (`qlbhvlssksnrhsleadzn`)
- AWS Bedrock credentials (EU inference profiles) in env
- Port 3000 free (runner auto-starts dev server)

## Output

`tests/onboarding/test-output/<run-id>/` — `report.html`, `summary.json`, per-persona screenshots + captured JSON.

## See also

Spec: `docs/superpowers/specs/2026-04-20-onboarding-test-suite-design.md`
```

- [ ] **Step 5: Commit**

```bash
cd cfos-office
git add package.json package-lock.json .gitignore tests/onboarding/README.md
git commit -m "chore(onboarding-tests): scaffold deps + directory structure"
```

---

## Task 2: Persona Type Definitions

**Files:**
- Create: `cfos-office/tests/onboarding/personas/types.ts`

- [ ] **Step 1: Write the persona type module**

Create `cfos-office/tests/onboarding/personas/types.ts`:

```ts
import type { ValueQuadrant, MoneyPersonality, ValueMapResult } from '@/lib/value-map/types'
import type { OnboardingBeat } from '@/lib/onboarding/types'

// ── Scripted Value Map response ─────────────────────────────────────────────
// Same shape as the runtime ValueMapResult, but merchant + transaction_id are
// auto-filled from SAMPLE_TRANSACTIONS by cardId.

export interface PersonaValueMapResponse {
  cardId: string           // SAMPLE_TRANSACTIONS id (e.g. 'vm-rent')
  quadrant: ValueQuadrant | null   // null = tap "hard to decide"
  confidence: number       // 1-5 (0 for hard-to-decide)
  firstTapMs: number | null
  cardTimeMs: number
  deliberationMs: number
  hardToDecide?: boolean
}

// ── Persona profile (written to user_profiles after signup) ─────────────────

export interface PersonaProfile {
  displayName: string
  country: string          // ISO 3166-1 alpha-2 (e.g. 'GB', 'ES')
  city?: string
  currency: string         // ISO 4217 (e.g. 'GBP', 'EUR')
}

// ── Persona CSV upload ──────────────────────────────────────────────────────

export interface PersonaCsv {
  filename: string
  contentBase64: string
  expectedBank: 'revolut' | 'santander' | 'generic'
}

// ── Expectations (assertions the runner checks) ─────────────────────────────

export interface PersonaExpectations {
  archetype: {
    expectedQuadrant: ValueQuadrant
    personalityId: MoneyPersonality
  }
  beatsCompleted: OnboardingBeat[]
  beatsSkipped: OnboardingBeat[]
  dbAfterHandoff: {
    user_profiles?: Record<string, unknown>
    financial_portrait?: Record<string, unknown>
    transactions?: { countBetween: [number, number] }
    onboarding_progress?: Record<string, unknown>
  }
  hardRules?: {
    bannedWords?: string[]
    bannedPatterns?: string[]        // regex source strings
    archetype?: {
      mustReferenceQuadrant?: ValueQuadrant
      mustMentionOneOf?: string[]
      mustAcknowledgeOneOf?: string[]
    }
    insight?: {
      mustReferenceMerchantsFromCsv?: string[]
      mustReferenceOneOf?: string[]
      numbersMustMatchCsv?: boolean
    }
  }
  likertDimensions: ('warmth' | 'accuracy' | 'on_brand_voice' | 'persona_fit' | 'actionability')[]
}

// ── Full persona definition ─────────────────────────────────────────────────

export interface Persona {
  id: string
  label: string
  profile: PersonaProfile
  valueMapResponses: PersonaValueMapResponse[] | null  // null = skip-value-map persona
  csv: PersonaCsv | null                               // null = no CSV upload
  skipBeats: OnboardingBeat[]
  expectations: PersonaExpectations
}

export type { ValueMapResult }
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/personas/types.ts
git commit -m "feat(onboarding-tests): persona type definitions"
```

---

## Task 3: Persona Registry (Empty)

**Files:**
- Create: `cfos-office/tests/onboarding/personas/index.ts`

- [ ] **Step 1: Write empty registry**

Create `cfos-office/tests/onboarding/personas/index.ts`:

```ts
import type { Persona } from './types'

// Personas are registered here as they are added.
// Imports and array entries are added task-by-task.

export const PERSONAS: readonly Persona[] = [] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): empty persona registry"
```

---

## Task 4: Vitest Unit Test — calculatePersonality Validates All Personas

**Files:**
- Create: `cfos-office/tests/onboarding/unit/calculate-personality.test.ts`

- [ ] **Step 1: Write test that iterates the registry**

Create `cfos-office/tests/onboarding/unit/calculate-personality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { calculatePersonality } from '@/lib/value-map/personalities'
import { SAMPLE_TRANSACTIONS } from '@/lib/value-map/constants'
import { PERSONAS } from '../personas'
import type { ValueMapResult } from '@/lib/value-map/types'

function scriptedToResults(persona: typeof PERSONAS[number]): ValueMapResult[] {
  if (!persona.valueMapResponses) return []
  return persona.valueMapResponses.map((r) => {
    const card = SAMPLE_TRANSACTIONS.find((t) => t.id === r.cardId)
    if (!card) throw new Error(`Unknown cardId in persona ${persona.id}: ${r.cardId}`)
    return {
      transaction_id: r.cardId,
      quadrant: r.quadrant,
      merchant: card.description ?? card.merchant ?? r.cardId,
      amount: card.amount,
      confidence: r.confidence,
      first_tap_ms: r.firstTapMs,
      card_time_ms: r.cardTimeMs,
      deliberation_ms: r.deliberationMs,
      hard_to_decide: r.hardToDecide,
    }
  })
}

describe('persona scripted Value Map responses produce expected archetype', () => {
  // Iterates registry — new personas automatically get coverage as added.
  for (const persona of PERSONAS) {
    if (!persona.valueMapResponses) continue // skip personas that skip Value Map

    it(`${persona.id}: calculatePersonality returns ${persona.expectations.archetype.personalityId}`, () => {
      const results = scriptedToResults(persona)
      const out = calculatePersonality(results)
      expect(out.personality).toBe(persona.expectations.archetype.personalityId)
    })
  }
})
```

- [ ] **Step 2: Run test to verify it passes with empty registry**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
```

Expected: PASS — 0 tests (empty registry). This is fine; the test will grow as personas are added.

- [ ] **Step 3: Commit**

```bash
cd cfos-office
git add tests/onboarding/unit/calculate-personality.test.ts
git commit -m "test(onboarding-tests): persona personality-calc validation"
```

---

## Task 5: Persona — builder-classic

**Files:**
- Create: `cfos-office/tests/onboarding/personas/builder-classic.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

> **CSV content strategy:** Each CSV is a base64-encoded multi-line string. The content is hand-written in a Revolut-compatible format (Type,Started Date,Description,Amount,Currency,Balance header). Target ~90-120 transactions across 3 months. Below uses a helper — written inline — that generates the content deterministically from a template so the persona file stays readable.

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/builder-classic.ts`:

```ts
import type { Persona } from './types'

// ── CSV: Revolut GBP, 3 months (Jan-Mar 2026), Builder pattern ──────────────
// Investment-heavy: regular gym, courses (Udemy, Coursera), healthy dining,
// Vanguard ISA contribution, regular book purchases. Minimal impulse leaks.

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // Salary
  'TRANSFER,2026-01-28,Salary Acme Ltd,3200.00,GBP,3200.00',
  'TRANSFER,2026-02-28,Salary Acme Ltd,3200.00,GBP,3400.00',
  'TRANSFER,2026-03-28,Salary Acme Ltd,3200.00,GBP,3580.00',
  // Rent
  'CARD_PAYMENT,2026-01-01,Rent Landlord,-1100.00,GBP,2100.00',
  'CARD_PAYMENT,2026-02-01,Rent Landlord,-1100.00,GBP,2300.00',
  'CARD_PAYMENT,2026-03-01,Rent Landlord,-1100.00,GBP,2480.00',
  // Utilities
  'CARD_PAYMENT,2026-01-05,Octopus Energy,-68.00,GBP,2032.00',
  'CARD_PAYMENT,2026-02-05,Octopus Energy,-72.00,GBP,2228.00',
  'CARD_PAYMENT,2026-03-05,Octopus Energy,-65.00,GBP,2415.00',
  'CARD_PAYMENT,2026-01-05,Thames Water,-32.00,GBP,2000.00',
  'CARD_PAYMENT,2026-02-05,Thames Water,-32.00,GBP,2196.00',
  'CARD_PAYMENT,2026-03-05,Thames Water,-32.00,GBP,2383.00',
  'CARD_PAYMENT,2026-01-10,BT Broadband,-35.00,GBP,1965.00',
  'CARD_PAYMENT,2026-02-10,BT Broadband,-35.00,GBP,2161.00',
  'CARD_PAYMENT,2026-03-10,BT Broadband,-35.00,GBP,2348.00',
  // Investment — core Builder signal
  'TRANSFER,2026-01-02,Vanguard ISA transfer,-500.00,GBP,1465.00',
  'TRANSFER,2026-02-02,Vanguard ISA transfer,-500.00,GBP,1661.00',
  'TRANSFER,2026-03-02,Vanguard ISA transfer,-500.00,GBP,1848.00',
  // Gym — recurring investment
  'CARD_PAYMENT,2026-01-15,PureGym Membership,-29.99,GBP,1435.01',
  'CARD_PAYMENT,2026-02-15,PureGym Membership,-29.99,GBP,1631.01',
  'CARD_PAYMENT,2026-03-15,PureGym Membership,-29.99,GBP,1818.01',
  // Courses / books (Investment)
  'CARD_PAYMENT,2026-01-18,Udemy course,-25.00,GBP,1410.01',
  'CARD_PAYMENT,2026-02-20,Coursera monthly,-39.00,GBP,1592.01',
  'CARD_PAYMENT,2026-01-22,Waterstones books,-32.50,GBP,1377.51',
  'CARD_PAYMENT,2026-03-22,Waterstones books,-28.00,GBP,1790.01',
  'CARD_PAYMENT,2026-02-25,Masterclass annual,-180.00,GBP,1412.01',
  // Groceries
  ...['2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04', '2026-03-11', '2026-03-18', '2026-03-25'].map(
    (d, i) => `CARD_PAYMENT,${d},Tesco,-${(55 + ((i * 7) % 25)).toFixed(2)},GBP,0.00`
  ),
  // Healthy dining out
  ...['2026-01-09', '2026-01-23', '2026-02-06', '2026-02-20', '2026-03-06', '2026-03-20'].map(
    (d) => `CARD_PAYMENT,${d},Farmer J,-18.50,GBP,0.00`
  ),
  ...['2026-01-16', '2026-02-13', '2026-03-13'].map(
    (d) => `CARD_PAYMENT,${d},Pret A Manger,-8.75,GBP,0.00`
  ),
  // Transport (TfL)
  ...['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-01-31', '2026-02-07', '2026-02-14', '2026-02-21', '2026-02-28', '2026-03-07', '2026-03-14', '2026-03-21', '2026-03-28'].map(
    (d) => `CARD_PAYMENT,${d},TfL Travel Charge,-8.80,GBP,0.00`
  ),
  // Small subscriptions (Foundation/minor Leak)
  'CARD_PAYMENT,2026-01-12,Spotify,-10.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-12,Spotify,-10.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-12,Spotify,-10.99,GBP,0.00',
  'CARD_PAYMENT,2026-01-14,iCloud storage,-2.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-14,iCloud storage,-2.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-14,iCloud storage,-2.99,GBP,0.00',
]

const csvContent = csvRows.join('\n')
const csvBase64 = Buffer.from(csvContent, 'utf-8').toString('base64')

export const builderClassic: Persona = {
  id: 'builder-classic',
  label: 'The Builder — Casual',
  profile: {
    displayName: 'Alex',
    country: 'GB',
    city: 'London',
    currency: 'GBP',
  },
  valueMapResponses: [
    // Rent → foundation (calm, quick — baseline cost)
    { cardId: 'vm-rent', quadrant: 'foundation', confidence: 5, firstTapMs: 900, cardTimeMs: 1400, deliberationMs: 300 },
    // Groceries → foundation (fast)
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 700, cardTimeMs: 1100, deliberationMs: 200 },
    // Gym → INVESTMENT (hallmark Builder)
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 5, firstTapMs: 1000, cardTimeMs: 1500, deliberationMs: 300 },
    // Takeaway → leak (mild, acknowledges small leak)
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 2000, cardTimeMs: 2900, deliberationMs: 700 },
    // Dinner with friends → INVESTMENT (social connection)
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 4, firstTapMs: 1400, cardTimeMs: 2100, deliberationMs: 500 },
    // Streaming → foundation (uses it, no guilt)
    { cardId: 'vm-streaming', quadrant: 'foundation', confidence: 3, firstTapMs: 1800, cardTimeMs: 2400, deliberationMs: 400 },
    // Learning → INVESTMENT (hallmark Builder)
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 5, firstTapMs: 700, cardTimeMs: 1200, deliberationMs: 300 },
    // Electricity → foundation
    { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 800, cardTimeMs: 1100, deliberationMs: 200 },
    // Clothes → leak (clear-eyed)
    { cardId: 'vm-clothes', quadrant: 'leak', confidence: 3, firstTapMs: 2200, cardTimeMs: 3100, deliberationMs: 700 },
    // Gift → INVESTMENT (relationships)
    { cardId: 'vm-gift', quadrant: 'investment', confidence: 5, firstTapMs: 900, cardTimeMs: 1400, deliberationMs: 300 },
  ],
  csv: {
    filename: 'builder-classic-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'investment',
      personalityId: 'builder',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [40, 80] },
      onboarding_progress: { onboarding_completed_at: 'not-null' },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'investment',
        mustMentionOneOf: ['invest', 'grow', 'build', 'intentional', 'purposeful'],
      },
      insight: {
        mustReferenceMerchantsFromCsv: ['gym', 'vanguard', 'course'],
        mustReferenceOneOf: ['investment', 'growth', 'discipline', 'habit'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
```

- [ ] **Step 2: Register persona**

Edit `cfos-office/tests/onboarding/personas/index.ts`:

```ts
import type { Persona } from './types'
import { builderClassic } from './builder-classic'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
```

- [ ] **Step 3: Run personality-calc test**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
```

Expected: PASS — 1 test (`builder-classic: calculatePersonality returns builder`).

If it fails because the Builder threshold isn't tripped, nudge `vm-dinner-friends`, `vm-learning`, or `vm-gym` amounts / ensure investment % >= 35 across all decided responses. The amounts come from SAMPLE_TRANSACTIONS (rent 950, groceries 62, gym 45, takeaway 18.50, dinner 42, streaming 11, learning 29, electricity 67, clothes 85, gift 35 → total 1444.50). Investment responses above = gym 45 + dinner 42 + learning 29 + gift 35 = 151, leak = 18.50 + 85 = 103.50, foundation = 950+62+11+67 = 1090. Investment % = 151/1444.50 = 10.4% — **NOT ≥35%**. This persona as written will produce `fortress` (foundation ≥ 50%).

Adjust: Move rent to investment (sees rent as "investment in my life") and keep others — 950+151 = 1101 / 1444.50 = 76% → builder. Or move streaming+electricity+rent+groceries all to investment. The cleanest: rent=investment, groceries=investment, gym=investment, takeaway=leak, dinner=investment, streaming=foundation, learning=investment, electricity=foundation, clothes=leak, gift=investment → investment = 950+62+45+42+29+35 = 1163/1444.5 = 80.5% → builder. Update the `quadrant` fields accordingly in the file, then re-run.

- [ ] **Step 4: Re-run after adjustment**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd cfos-office
git add tests/onboarding/personas/builder-classic.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): builder-classic persona"
```

---

## Task 6: Persona — fortress-saver

**Files:**
- Create: `cfos-office/tests/onboarding/personas/fortress-saver.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/fortress-saver.ts`:

```ts
import type { Persona } from './types'

// Fortress: foundation >= 50%. Frugal, rent + groceries + bills dominate.
// CSV: thrifty, minimal discretionary, generic GBP format (headers: date, desc, amount, currency).

const csvRows: string[] = [
  'Date,Description,Amount,Currency',
  // Salary
  'TRANSFER,2026-01-28,Salary Civil Service,2650.00,GBP',
  'TRANSFER,2026-02-28,Salary Civil Service,2650.00,GBP',
  'TRANSFER,2026-03-28,Salary Civil Service,2650.00,GBP',
  // Rent (share)
  '2026-01-01,Rent - Shared house,-650.00,GBP',
  '2026-02-01,Rent - Shared house,-650.00,GBP',
  '2026-03-01,Rent - Shared house,-650.00,GBP',
  // Bills
  '2026-01-05,British Gas,-48.00,GBP',
  '2026-02-05,British Gas,-52.00,GBP',
  '2026-03-05,British Gas,-41.00,GBP',
  '2026-01-06,EDF Electricity,-39.00,GBP',
  '2026-02-06,EDF Electricity,-44.00,GBP',
  '2026-03-06,EDF Electricity,-37.00,GBP',
  '2026-01-10,Council Tax,-98.00,GBP',
  '2026-02-10,Council Tax,-98.00,GBP',
  '2026-03-10,Council Tax,-98.00,GBP',
  '2026-01-12,Virgin Media Broadband,-28.00,GBP',
  '2026-02-12,Virgin Media Broadband,-28.00,GBP',
  '2026-03-12,Virgin Media Broadband,-28.00,GBP',
  // Mobile
  '2026-01-15,Giffgaff Goodybag,-10.00,GBP',
  '2026-02-15,Giffgaff Goodybag,-10.00,GBP',
  '2026-03-15,Giffgaff Goodybag,-10.00,GBP',
  // Savings transfer (Foundation-style, cautious)
  '2026-01-30,Savings Transfer,-300.00,GBP',
  '2026-02-28,Savings Transfer,-300.00,GBP',
  '2026-03-28,Savings Transfer,-300.00,GBP',
  // Groceries (heavy, Aldi-dominant)
  ...['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25', '2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22', '2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29'].map(
    (d, i) => `${d},Aldi,-${(38 + ((i * 3) % 12)).toFixed(2)},GBP`
  ),
  // Minimal dining out (cheap)
  ...['2026-01-13', '2026-02-10', '2026-03-14'].map(
    (d) => `${d},Wetherspoons,-14.50,GBP`
  ),
  // Essential transport only
  ...['2026-01-03', '2026-01-17', '2026-02-07', '2026-02-21', '2026-03-07', '2026-03-21'].map(
    (d) => `${d},National Rail,-12.00,GBP`
  ),
]

const csvContent = csvRows.join('\n')
const csvBase64 = Buffer.from(csvContent, 'utf-8').toString('base64')

export const fortressSaver: Persona = {
  id: 'fortress-saver',
  label: 'The Fortress — Saver',
  profile: {
    displayName: 'Sam',
    country: 'GB',
    city: 'Manchester',
    currency: 'GBP',
  },
  // Foundation-heavy: rent, groceries, bills, electricity all foundation.
  // Foundation total: 950+62+11+67 = 1090 / 1444.50 = 75% → fortress
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: 'foundation', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
    { cardId: 'vm-gym', quadrant: 'leak', confidence: 3, firstTapMs: 2500, cardTimeMs: 3500, deliberationMs: 800 },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
    { cardId: 'vm-dinner-friends', quadrant: 'burden', confidence: 3, firstTapMs: 2800, cardTimeMs: 3800, deliberationMs: 900 },
    { cardId: 'vm-streaming', quadrant: 'foundation', confidence: 4, firstTapMs: 900, cardTimeMs: 1300, deliberationMs: 300 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 3, firstTapMs: 1600, cardTimeMs: 2200, deliberationMs: 500 },
    { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
    { cardId: 'vm-clothes', quadrant: 'leak', confidence: 4, firstTapMs: 1800, cardTimeMs: 2400, deliberationMs: 500 },
    { cardId: 'vm-gift', quadrant: 'foundation', confidence: 4, firstTapMs: 1200, cardTimeMs: 1700, deliberationMs: 400 },
  ],
  csv: {
    filename: 'fortress-saver-generic-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'generic',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'foundation',
      personalityId: 'fortress',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [30, 70] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'foundation',
        mustMentionOneOf: ['careful', 'fortress', 'foundation', 'disciplined', 'protected'],
      },
      insight: {
        mustReferenceOneOf: ['savings', 'foundation', 'stable', 'buffer'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
```

- [ ] **Step 2: Register persona**

Edit `cfos-office/tests/onboarding/personas/index.ts`:

```ts
import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
] as const

// getPersona + personaIds unchanged
```

- [ ] **Step 3: Run test**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
```

Expected: PASS — 2 tests.

- [ ] **Step 4: Commit**

```bash
cd cfos-office
git add tests/onboarding/personas/fortress-saver.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): fortress-saver persona"
```

---

## Task 7: Persona — truth-teller-balanced

**Files:**
- Create: `cfos-office/tests/onboarding/personas/truth-teller-balanced.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/truth-teller-balanced.ts`:

```ts
import type { Persona } from './types'

// Truth Teller: no threshold tripped. Balanced across all 4 quadrants.
// With amounts: rent 950, groceries 62, gym 45, takeaway 18.50, dinner 42, streaming 11, learning 29, electricity 67, clothes 85, gift 35 (total 1444.50).
// Target: leak < 25, burden < 30, investment < 35, foundation < 50.
// Assign: foundation (rent, electricity) = 1017 → 70% — TOO HIGH for fortress threshold.
// Need to split rent. Move rent → burden. Then: foundation = 62+67 = 129 (8.9%), burden = 950 (65.8%) — trips anchor.
// Better split: rent → investment ("the life I'm building"), groceries → foundation, gym → investment, takeaway → leak, dinner → investment, streaming → burden, learning → investment, electricity → foundation, clothes → leak, gift → investment.
// Investment: 950+45+42+29+35 = 1101 (76%) → builder. Too high.
// Need to split rent into smaller chunks conceptually, but the cards are fixed — can only assign one quadrant per card.
// Correct approach: make rent one of the smaller quadrants. rent → leak? No, that's unrealistic.
// Use "hard to decide" (null quadrant) on big-ticket items. Excluded from calc.
// Mark rent + electricity hard_to_decide. Remaining total: 62+45+18.50+42+11+29+85+35 = 327.50.
// Assign: groceries → foundation (62, 19%), gym → investment (45, 14%), takeaway → leak (18.50, 5.6%),
//   dinner → investment (42, 12.8%), streaming → burden (11, 3.4%), learning → investment (29, 8.9%),
//   clothes → leak (85, 25.9%), gift → foundation (35, 10.7%).
// Totals: foundation = 62+35 = 97 (29.6%), investment = 45+42+29 = 116 (35.4%), leak = 18.50+85 = 103.50 (31.6%), burden = 11 (3.4%).
// Investment 35.4% trips builder (≥35%). Adjust: move learning → burden → investment 87 (26.5%) ✓.
// foundation 29.6% ✓, investment 26.5% ✓, burden 40 (12.2%) ✓, leak 103.50 (31.6%) ← trips drifter (≥25%).
// Need leak < 25. Move clothes → burden. leak = 18.50 (5.6%), burden = 11+29+85 = 125 (38%) ← trips anchor (≥30%).
// Move learning out of burden back to foundation. burden = 11+85 = 96 (29.3%) ✓ (just under 30).
// foundation = 62+35+29 = 126 (38.5%) ✓, investment = 45+42 = 87 (26.5%) ✓.
// Final: leak=5.6, burden=29.3, investment=26.5, foundation=38.5. All thresholds clear → truth_teller.

const VMR = [
  { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 4000, cardTimeMs: 5500, deliberationMs: 1200, hardToDecide: true },
  { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 700, cardTimeMs: 1100, deliberationMs: 300 },
  { cardId: 'vm-gym', quadrant: 'investment', confidence: 4, firstTapMs: 1300, cardTimeMs: 1900, deliberationMs: 500 },
  { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 2200, cardTimeMs: 3000, deliberationMs: 700 },
  { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 4, firstTapMs: 1200, cardTimeMs: 1800, deliberationMs: 500 },
  { cardId: 'vm-streaming', quadrant: 'burden', confidence: 3, firstTapMs: 2500, cardTimeMs: 3300, deliberationMs: 700 },
  { cardId: 'vm-learning', quadrant: 'foundation', confidence: 3, firstTapMs: 1800, cardTimeMs: 2500, deliberationMs: 600 },
  { cardId: 'vm-electricity', quadrant: null, confidence: 0, firstTapMs: 3200, cardTimeMs: 4500, deliberationMs: 1100, hardToDecide: true },
  { cardId: 'vm-clothes', quadrant: 'burden', confidence: 2, firstTapMs: 2800, cardTimeMs: 3900, deliberationMs: 900 },
  { cardId: 'vm-gift', quadrant: 'foundation', confidence: 4, firstTapMs: 1100, cardTimeMs: 1600, deliberationMs: 400 },
] as const

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'TRANSFER,2026-01-28,Salary TechCo,2800.00,GBP,2800.00',
  'TRANSFER,2026-02-28,Salary TechCo,2800.00,GBP,3100.00',
  'TRANSFER,2026-03-28,Salary TechCo,2800.00,GBP,3250.00',
  'CARD_PAYMENT,2026-01-01,Rent,-900.00,GBP,1900.00',
  'CARD_PAYMENT,2026-02-01,Rent,-900.00,GBP,2200.00',
  'CARD_PAYMENT,2026-03-01,Rent,-900.00,GBP,2350.00',
  'CARD_PAYMENT,2026-01-05,Octopus,-70.00,GBP,1830.00',
  'CARD_PAYMENT,2026-02-05,Octopus,-70.00,GBP,2130.00',
  'CARD_PAYMENT,2026-03-05,Octopus,-70.00,GBP,2280.00',
  // Mixed spending
  ...['2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04', '2026-03-11', '2026-03-18', '2026-03-25'].map(
    (d, i) => `CARD_PAYMENT,${d},Sainsbury's,-${(55 + ((i * 5) % 20)).toFixed(2)},GBP,0.00`
  ),
  ...['2026-01-08', '2026-01-15', '2026-02-05', '2026-02-12', '2026-03-05', '2026-03-12'].map(
    (d) => `CARD_PAYMENT,${d},Dishoom,-35.00,GBP,0.00`
  ),
  ...['2026-01-20', '2026-02-10', '2026-03-08'].map(
    (d) => `CARD_PAYMENT,${d},Amazon UK,-42.00,GBP,0.00`
  ),
  'CARD_PAYMENT,2026-01-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-15,Netflix,-14.99,GBP,0.00',
  ...['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-02-07', '2026-02-14', '2026-02-21', '2026-03-07', '2026-03-14', '2026-03-21'].map(
    (d) => `CARD_PAYMENT,${d},TfL Travel,-9.40,GBP,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const truthTellerBalanced: Persona = {
  id: 'truth-teller-balanced',
  label: 'The Truth Teller — Balanced',
  profile: {
    displayName: 'Jordan',
    country: 'GB',
    city: 'Bristol',
    currency: 'GBP',
  },
  valueMapResponses: VMR as unknown as Persona['valueMapResponses'],
  csv: {
    filename: 'truth-teller-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'foundation',  // highest but under 50% threshold → falls to truth_teller
      personalityId: 'truth_teller',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      transactions: { countBetween: [30, 70] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustMentionOneOf: ['balance', 'clear', 'mixed', 'truth', 'honest', 'see'],
      },
      insight: {
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
```

- [ ] **Step 2: Register persona**

Edit `cfos-office/tests/onboarding/personas/index.ts`:

```ts
import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'
import { truthTellerBalanced } from './truth-teller-balanced'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
  truthTellerBalanced,
] as const

// helpers unchanged
```

- [ ] **Step 3: Run test**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 4: Commit**

```bash
cd cfos-office
git add tests/onboarding/personas/truth-teller-balanced.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): truth-teller-balanced persona"
```

---

## Task 8: Persona — drifter-expat

**Files:**
- Create: `cfos-office/tests/onboarding/personas/drifter-expat.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

> **Santander XLSX:** The CFO codebase already has a parser at `src/lib/parsers/santander.ts`. For the suite, instead of binary XLSX, we'll supply a Revolut-format CSV flagged `expectedBank: 'santander'` — the runner will upload via the standard upload endpoint which auto-detects. If true Santander-format testing is needed later, swap to a real .xlsx embedded via base64. Keeping CSV for now keeps all persona files uniform.

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/drifter-expat.ts`:

```ts
import type { Persona } from './types'

// Drifter: leak >= 25%. Heavy dining out, impulse shopping, unused subs.
// Barcelona expat, EUR. Lewis-flavoured profile.

// Quadrant math with SAMPLE amounts (total 1444.50):
// Leak: clothes (85) + takeaway (18.50) + streaming (11) + dinner-friends (42) = 156.50 (10.8%) — too low.
// Push more into leak: clothes + takeaway + streaming + dinner + gift (35) + groceries (62) = 253.50 (17.5%) — still low.
// Problem: rent dominates at 950/1444.50 = 65.8%.
// Mark rent as hard_to_decide (null, excluded from calc). Remaining total = 494.50.
// Leak: clothes (85) + takeaway (18.50) + streaming (11) + dinner (42) + gift (35) = 191.50 / 494.50 = 38.7% ✓ drifter.
// Foundation: groceries (62) + electricity (67) = 129 (26.1%) — under 50% ✓.
// Investment: gym (45) + learning (29) = 74 (15%) — under 35% ✓.
// Burden: 0%.
// leak 38.7% trips drifter priority first. ✓

const VMR = [
  { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 5500, cardTimeMs: 7200, deliberationMs: 1500, hardToDecide: true },
  { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 4, firstTapMs: 800, cardTimeMs: 1300, deliberationMs: 300 },
  { cardId: 'vm-gym', quadrant: 'investment', confidence: 2, firstTapMs: 3200, cardTimeMs: 4800, deliberationMs: 1200 },
  { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 2, firstTapMs: 2800, cardTimeMs: 3900, deliberationMs: 900 },
  { cardId: 'vm-dinner-friends', quadrant: 'leak', confidence: 2, firstTapMs: 3500, cardTimeMs: 4800, deliberationMs: 1100 },
  { cardId: 'vm-streaming', quadrant: 'leak', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
  { cardId: 'vm-learning', quadrant: 'investment', confidence: 2, firstTapMs: 3000, cardTimeMs: 4200, deliberationMs: 1000 },
  { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
  { cardId: 'vm-clothes', quadrant: 'leak', confidence: 2, firstTapMs: 2500, cardTimeMs: 3600, deliberationMs: 900 },
  { cardId: 'vm-gift', quadrant: 'leak', confidence: 1, firstTapMs: 4000, cardTimeMs: 5500, deliberationMs: 1300 },
]

// EUR CSV — Revolut-style (auto-detected). Barcelona merchants.
const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'TRANSFER,2026-01-28,Salary Tech SL,2700.00,EUR,2700.00',
  'TRANSFER,2026-02-28,Salary Tech SL,2700.00,EUR,2900.00',
  'TRANSFER,2026-03-28,Salary Tech SL,2700.00,EUR,2650.00',
  'CARD_PAYMENT,2026-01-01,Alquiler Piso,-950.00,EUR,1750.00',
  'CARD_PAYMENT,2026-02-01,Alquiler Piso,-950.00,EUR,1950.00',
  'CARD_PAYMENT,2026-03-01,Alquiler Piso,-950.00,EUR,1700.00',
  // Bi-monthly gas (Spain quirk)
  'CARD_PAYMENT,2026-01-15,Naturgy Gas,-85.00,EUR,1665.00',
  'CARD_PAYMENT,2026-03-15,Naturgy Gas,-78.00,EUR,1622.00',
  // Electricity monthly
  'CARD_PAYMENT,2026-01-08,Endesa,-62.00,EUR,1603.00',
  'CARD_PAYMENT,2026-02-08,Endesa,-58.00,EUR,1892.00',
  'CARD_PAYMENT,2026-03-08,Endesa,-67.00,EUR,1555.00',
  'CARD_PAYMENT,2026-01-10,Movistar Fibra,-45.00,EUR,1558.00',
  'CARD_PAYMENT,2026-02-10,Movistar Fibra,-45.00,EUR,1847.00',
  'CARD_PAYMENT,2026-03-10,Movistar Fibra,-45.00,EUR,1510.00',
  // UK student loan (expat signal)
  'TRANSFER,2026-01-15,Student Loans Company,-95.00,GBP,0.00',
  'TRANSFER,2026-02-15,Student Loans Company,-95.00,GBP,0.00',
  'TRANSFER,2026-03-15,Student Loans Company,-95.00,GBP,0.00',
  // Unused gym
  'CARD_PAYMENT,2026-01-15,DIR Eixample Gym,-49.00,EUR,1461.00',
  'CARD_PAYMENT,2026-02-15,DIR Eixample Gym,-49.00,EUR,1798.00',
  'CARD_PAYMENT,2026-03-15,DIR Eixample Gym,-49.00,EUR,1461.00',
  // Multiple subscriptions (the drift)
  'CARD_PAYMENT,2026-01-12,Netflix,-14.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-12,Netflix,-14.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-12,Netflix,-14.99,EUR,0.00',
  'CARD_PAYMENT,2026-01-18,Spotify Premium,-10.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-18,Spotify Premium,-10.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-18,Spotify Premium,-10.99,EUR,0.00',
  'CARD_PAYMENT,2026-01-20,HBO Max,-9.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-20,HBO Max,-9.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-20,HBO Max,-9.99,EUR,0.00',
  'CARD_PAYMENT,2026-01-22,Disney Plus,-8.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-22,Disney Plus,-8.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-22,Disney Plus,-8.99,EUR,0.00',
  // Heavy dining — the leak signature
  ...['2026-01-03', '2026-01-05', '2026-01-09', '2026-01-12', '2026-01-16', '2026-01-19', '2026-01-23', '2026-01-26', '2026-01-30',
      '2026-02-02', '2026-02-06', '2026-02-09', '2026-02-13', '2026-02-17', '2026-02-20', '2026-02-24', '2026-02-27',
      '2026-03-02', '2026-03-06', '2026-03-09', '2026-03-13', '2026-03-17', '2026-03-20', '2026-03-24', '2026-03-27'].map(
    (d, i) => `CARD_PAYMENT,${d},${['Glovo', 'Deliveroo', 'Bar Mut', 'Cerveceria Catalana', 'La Pepita', 'Cafe del Mar', 'Flax & Kale'][i % 7]},-${(18 + ((i * 3) % 28)).toFixed(2)},EUR,0.00`
  ),
  // Groceries
  ...['2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04', '2026-03-11', '2026-03-18', '2026-03-25'].map(
    (d, i) => `CARD_PAYMENT,${d},Mercadona,-${(48 + ((i * 5) % 18)).toFixed(2)},EUR,0.00`
  ),
  // Impulse shopping
  ...['2026-01-11', '2026-01-24', '2026-02-08', '2026-02-22', '2026-03-05', '2026-03-18', '2026-03-29'].map(
    (d, i) => `CARD_PAYMENT,${d},${['Amazon.es', 'Zara', 'El Corte Ingles', 'FNAC'][i % 4]},-${(32 + ((i * 7) % 40)).toFixed(2)},EUR,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const drifterExpat: Persona = {
  id: 'drifter-expat',
  label: 'The Drifter — Expat',
  profile: {
    displayName: 'Marta',
    country: 'ES',
    city: 'Barcelona',
    currency: 'EUR',
  },
  valueMapResponses: VMR,
  csv: {
    filename: 'drifter-expat-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'leak',
      personalityId: 'drifter',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'EUR' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [70, 120] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'leak',
        mustMentionOneOf: ['drift', 'impulse', 'leak', 'habit', 'small'],
      },
      insight: {
        mustReferenceMerchantsFromCsv: ['glovo', 'deliveroo', 'netflix', 'hbo', 'disney', 'subscription'],
        mustReferenceOneOf: ['subscription', 'dining', 'delivery', 'leak'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
```

- [ ] **Step 2: Register persona**

Edit `cfos-office/tests/onboarding/personas/index.ts`:

```ts
import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'
import { truthTellerBalanced } from './truth-teller-balanced'
import { drifterExpat } from './drifter-expat'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
  truthTellerBalanced,
  drifterExpat,
] as const
```

- [ ] **Step 3: Run test and commit**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
```

Expected: PASS — 4 tests.

```bash
git add tests/onboarding/personas/drifter-expat.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): drifter-expat persona"
```

---

## Task 9: Persona — anchor-debt

**Files:**
- Create: `cfos-office/tests/onboarding/personas/anchor-debt.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/anchor-debt.ts`:

```ts
import type { Persona } from './types'

// Anchor: burden >= 30%. Debt repayments, reluctant fixed costs.
// Mark rent → hard_to_decide. Remaining 494.50.
// Burden: groceries (62) + takeaway (18.50) + streaming (11) + electricity (67) + clothes (85) = 243.50 (49.2%) → anchor (priority check: leak<25, burden≥30 → anchor).
// Verify leak < 25: gift (35) = 7.1% ✓.
// Investment: gym (45) + learning (29) + dinner (42) = 116 (23.5%) ✓ under 35.
// Foundation: 0 → 0% ✓.
// Anchor triggers at burden ≥30% after drifter check (leak <25). ✓

const VMR = [
  { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 3800, cardTimeMs: 5100, deliberationMs: 1300, hardToDecide: true },
  { cardId: 'vm-groceries', quadrant: 'burden', confidence: 3, firstTapMs: 1800, cardTimeMs: 2500, deliberationMs: 600 },
  { cardId: 'vm-gym', quadrant: 'investment', confidence: 3, firstTapMs: 1500, cardTimeMs: 2200, deliberationMs: 600 },
  { cardId: 'vm-takeaway', quadrant: 'burden', confidence: 2, firstTapMs: 2800, cardTimeMs: 3800, deliberationMs: 900 },
  { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 3, firstTapMs: 1900, cardTimeMs: 2600, deliberationMs: 600 },
  { cardId: 'vm-streaming', quadrant: 'burden', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
  { cardId: 'vm-learning', quadrant: 'investment', confidence: 3, firstTapMs: 1700, cardTimeMs: 2400, deliberationMs: 600 },
  { cardId: 'vm-electricity', quadrant: 'burden', confidence: 4, firstTapMs: 1100, cardTimeMs: 1600, deliberationMs: 400 },
  { cardId: 'vm-clothes', quadrant: 'burden', confidence: 2, firstTapMs: 2500, cardTimeMs: 3400, deliberationMs: 800 },
  { cardId: 'vm-gift', quadrant: 'leak', confidence: 2, firstTapMs: 3200, cardTimeMs: 4400, deliberationMs: 1100 },
]

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'TRANSFER,2026-01-28,Salary Retail Co,2300.00,GBP,2300.00',
  'TRANSFER,2026-02-28,Salary Retail Co,2300.00,GBP,2100.00',
  'TRANSFER,2026-03-28,Salary Retail Co,2300.00,GBP,1950.00',
  'CARD_PAYMENT,2026-01-01,Rent,-780.00,GBP,1520.00',
  'CARD_PAYMENT,2026-02-01,Rent,-780.00,GBP,1320.00',
  'CARD_PAYMENT,2026-03-01,Rent,-780.00,GBP,1170.00',
  // Debt repayments — the Anchor signature
  'TRANSFER,2026-01-05,Credit card repayment,-320.00,GBP,0.00',
  'TRANSFER,2026-02-05,Credit card repayment,-320.00,GBP,0.00',
  'TRANSFER,2026-03-05,Credit card repayment,-320.00,GBP,0.00',
  'TRANSFER,2026-01-15,Personal loan payment,-215.00,GBP,0.00',
  'TRANSFER,2026-02-15,Personal loan payment,-215.00,GBP,0.00',
  'TRANSFER,2026-03-15,Personal loan payment,-215.00,GBP,0.00',
  'TRANSFER,2026-01-20,Car finance,-189.00,GBP,0.00',
  'TRANSFER,2026-02-20,Car finance,-189.00,GBP,0.00',
  'TRANSFER,2026-03-20,Car finance,-189.00,GBP,0.00',
  // Bills
  'CARD_PAYMENT,2026-01-08,British Gas,-78.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-08,British Gas,-82.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-08,British Gas,-68.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-12,Council Tax,-115.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-12,Council Tax,-115.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-12,Council Tax,-115.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-14,TalkTalk,-32.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-14,TalkTalk,-32.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-14,TalkTalk,-32.00,GBP,0.00',
  // Basic groceries
  ...['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03', '2026-02-10', '2026-02-17', '2026-02-24', '2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24'].map(
    (d, i) => `CARD_PAYMENT,${d},Morrisons,-${(42 + ((i * 4) % 15)).toFixed(2)},GBP,0.00`
  ),
  // Occasional takeaway
  ...['2026-01-19', '2026-02-11', '2026-03-14'].map(
    (d) => `CARD_PAYMENT,${d},Just Eat,-18.00,GBP,0.00`
  ),
  // Transport minimal
  ...['2026-01-02', '2026-02-02', '2026-03-02'].map(
    (d) => `CARD_PAYMENT,${d},Bus pass monthly,-60.00,GBP,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const anchorDebt: Persona = {
  id: 'anchor-debt',
  label: 'The Anchor — Debt-heavy',
  profile: {
    displayName: 'Riley',
    country: 'GB',
    city: 'Leeds',
    currency: 'GBP',
  },
  valueMapResponses: VMR,
  csv: {
    filename: 'anchor-debt-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'burden',
      personalityId: 'anchor',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [40, 70] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      bannedPatterns: [
        'just\\s+(need|have)\\s+to',
        'simply',
        'discipline|willpower',
      ],
      archetype: {
        mustReferenceQuadrant: 'burden',
        mustMentionOneOf: ['weight', 'burden', 'anchor', 'carrying', 'heavy'],
      },
      insight: {
        mustReferenceMerchantsFromCsv: ['credit', 'loan', 'finance'],
        mustReferenceOneOf: ['debt', 'refinance', 'reduce', 'priority'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
```

- [ ] **Step 2: Register persona**

Edit `cfos-office/tests/onboarding/personas/index.ts`:

```ts
import { anchorDebt } from './anchor-debt'
// ...
export const PERSONAS = [builderClassic, fortressSaver, truthTellerBalanced, drifterExpat, anchorDebt] as const
```

- [ ] **Step 3: Run test and commit**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
git add tests/onboarding/personas/anchor-debt.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): anchor-debt persona"
```

Expected: PASS — 5 tests.

---

## Task 10: Persona — skip-value-map

**Files:**
- Create: `cfos-office/tests/onboarding/personas/skip-value-map.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/skip-value-map.ts`:

```ts
import type { Persona } from './types'

export const skipValueMap: Persona = {
  id: 'skip-value-map',
  label: 'Skip path — Value Map declined',
  profile: {
    displayName: 'Casey',
    country: 'GB',
    city: 'Edinburgh',
    currency: 'GBP',
  },
  valueMapResponses: null,  // User taps Skip on Value Map beat
  csv: null,                // User also skips CSV upload — full minimum-engagement path
  skipBeats: ['value_map', 'csv_upload'],
  expectations: {
    archetype: {
      expectedQuadrant: 'foundation',  // unused for skip personas; runner checks beatsSkipped
      personalityId: 'truth_teller',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'csv_upload', 'capabilities', 'handoff'],
    beatsSkipped: ['archetype', 'first_insight'],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      transactions: { countBetween: [0, 0] },
    },
    likertDimensions: [],  // No LLM outputs generated → no judge
  },
}
```

- [ ] **Step 2: Register, test, commit**

Edit `cfos-office/tests/onboarding/personas/index.ts` to add `skipValueMap`.

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts  # still passes (skip persona has null valueMapResponses, loop skips it)
git add tests/onboarding/personas/skip-value-map.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): skip-value-map persona"
```

---

## Task 11: Persona — skip-csv-upload

**Files:**
- Create: `cfos-office/tests/onboarding/personas/skip-csv-upload.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/skip-csv-upload.ts`:

```ts
import type { Persona } from './types'
import { builderClassic } from './builder-classic'

// Reuses builder-classic's VM responses (easiest "completes Value Map" path)
// but skips CSV upload. Asserts first_insight is skipped.

export const skipCsvUpload: Persona = {
  id: 'skip-csv-upload',
  label: 'Skip path — CSV upload declined',
  profile: {
    displayName: 'Morgan',
    country: 'GB',
    city: 'Cardiff',
    currency: 'GBP',
  },
  valueMapResponses: builderClassic.valueMapResponses,
  csv: null,
  skipBeats: ['csv_upload'],
  expectations: {
    archetype: {
      expectedQuadrant: 'investment',
      personalityId: 'builder',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'handoff'],
    beatsSkipped: ['first_insight'],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [0, 0] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'investment',
        mustMentionOneOf: ['invest', 'grow', 'build', 'intentional'],
      },
      // No insight expected — skipped.
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit'],
  },
}
```

- [ ] **Step 2: Register, test, commit**

Edit `cfos-office/tests/onboarding/personas/index.ts` to add `skipCsvUpload`.

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
git add tests/onboarding/personas/skip-csv-upload.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): skip-csv-upload persona"
```

Expected: PASS — 7 tests (6 with valueMapResponses + loop skips skip-value-map).

---

## Task 12: Persona — time-saver-expert

**Files:**
- Create: `cfos-office/tests/onboarding/personas/time-saver-expert.ts`
- Modify: `cfos-office/tests/onboarding/personas/index.ts`

- [ ] **Step 1: Write the persona**

Create `cfos-office/tests/onboarding/personas/time-saver-expert.ts`:

```ts
import type { Persona } from './types'

// High-income finance pro. Wants automation, NOT advice.
// Hard rules ban unsolicited investment suggestions.
// Value Map pattern: Builder (investment-dominant, calm fast decisions).
// Quadrant math with rent → investment:
// Investment: rent (950) + gym (45) + learning (29) + gift (35) + dinner (42) = 1101 (76.2%) → builder ✓.

const VMR = [
  { cardId: 'vm-rent', quadrant: 'investment', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
  { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 400, cardTimeMs: 700, deliberationMs: 200 },
  { cardId: 'vm-gym', quadrant: 'investment', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
  { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 1200, cardTimeMs: 1700, deliberationMs: 400 },
  { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
  { cardId: 'vm-streaming', quadrant: 'foundation', confidence: 4, firstTapMs: 800, cardTimeMs: 1200, deliberationMs: 300 },
  { cardId: 'vm-learning', quadrant: 'investment', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
  { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 400, cardTimeMs: 700, deliberationMs: 200 },
  { cardId: 'vm-clothes', quadrant: 'leak', confidence: 4, firstTapMs: 1000, cardTimeMs: 1400, deliberationMs: 300 },
  { cardId: 'vm-gift', quadrant: 'investment', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
]

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // High salary
  'TRANSFER,2026-01-28,Salary Bank PLC,6200.00,GBP,6200.00',
  'TRANSFER,2026-02-28,Salary Bank PLC,6200.00,GBP,7100.00',
  'TRANSFER,2026-03-28,Salary Bank PLC,6200.00,GBP,8050.00',
  // Rent
  'CARD_PAYMENT,2026-01-01,Rent Flat Zone 1,-1800.00,GBP,4400.00',
  'CARD_PAYMENT,2026-02-01,Rent Flat Zone 1,-1800.00,GBP,5300.00',
  'CARD_PAYMENT,2026-03-01,Rent Flat Zone 1,-1800.00,GBP,6250.00',
  // Automated investment — the signal
  'TRANSFER,2026-01-02,Vanguard ISA DD,-1666.00,GBP,2734.00',
  'TRANSFER,2026-02-02,Vanguard ISA DD,-1666.00,GBP,3634.00',
  'TRANSFER,2026-03-02,Vanguard ISA DD,-1666.00,GBP,4584.00',
  'TRANSFER,2026-01-02,SIPP contribution,-800.00,GBP,1934.00',
  'TRANSFER,2026-02-02,SIPP contribution,-800.00,GBP,2834.00',
  'TRANSFER,2026-03-02,SIPP contribution,-800.00,GBP,3784.00',
  'TRANSFER,2026-01-03,InvestEngine GIA,-500.00,GBP,1434.00',
  'TRANSFER,2026-02-03,InvestEngine GIA,-500.00,GBP,2334.00',
  'TRANSFER,2026-03-03,InvestEngine GIA,-500.00,GBP,3284.00',
  // Premium professional subs
  'CARD_PAYMENT,2026-01-05,Financial Times,-39.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-05,Financial Times,-39.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-05,Financial Times,-39.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-07,Bloomberg Digital,-34.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-07,Bloomberg Digital,-34.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-07,Bloomberg Digital,-34.99,GBP,0.00',
  'CARD_PAYMENT,2026-01-10,Notion Plus,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-10,Notion Plus,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-10,Notion Plus,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-12,GitHub Pro,-4.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-12,GitHub Pro,-4.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-12,GitHub Pro,-4.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-01-18,Spotify Premium Family,-16.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-18,Spotify Premium Family,-16.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-18,Spotify Premium Family,-16.99,GBP,0.00',
  // Bills
  'CARD_PAYMENT,2026-01-08,Octopus Energy,-88.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-08,Octopus Energy,-92.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-08,Octopus Energy,-85.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-10,BT Broadband,-42.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-10,BT Broadband,-42.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-10,BT Broadband,-42.00,GBP,0.00',
  // Groceries — Waitrose
  ...['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].map(
    (d, i) => `CARD_PAYMENT,${d},Waitrose,-${(72 + ((i * 5) % 25)).toFixed(2)},GBP,0.00`
  ),
  // Business lunches
  ...['2026-01-14', '2026-01-28', '2026-02-11', '2026-02-25', '2026-03-11', '2026-03-25'].map(
    (d) => `CARD_PAYMENT,${d},Sweetgreen,-14.50,GBP,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const timeSaverExpert: Persona = {
  id: 'time-saver-expert',
  label: 'The Time-Saver — Finance Expert',
  profile: {
    displayName: 'Dr. Priya',
    country: 'GB',
    city: 'London',
    currency: 'GBP',
  },
  valueMapResponses: VMR,
  csv: {
    filename: 'time-saver-expert-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'investment',
      personalityId: 'builder',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [50, 90] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      // The critical persona-specific rules
      bannedPatterns: [
        'you\\s+(should|could|might want to)\\s+(invest|save|allocate|consider)',
        'have you thought about',
        '(an ISA|compound interest|diversification)\\s+(is|means)',
      ],
      archetype: {
        mustReferenceQuadrant: 'investment',
        mustAcknowledgeOneOf: ['have a plan', 'know what you', 'clear', 'intentional', 'in control', 'system already', 'dialled in'],
      },
      insight: {
        mustReferenceOneOf: ['track', 'watch', 'flag', 'automate', 'monitor', 'tell you when', 'subscription', 'bill', 'change'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
```

- [ ] **Step 2: Register, test, commit**

Edit `cfos-office/tests/onboarding/personas/index.ts` to add `timeSaverExpert`. Full file should now be:

```ts
import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'
import { truthTellerBalanced } from './truth-teller-balanced'
import { drifterExpat } from './drifter-expat'
import { anchorDebt } from './anchor-debt'
import { skipValueMap } from './skip-value-map'
import { skipCsvUpload } from './skip-csv-upload'
import { timeSaverExpert } from './time-saver-expert'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
  truthTellerBalanced,
  drifterExpat,
  anchorDebt,
  skipValueMap,
  skipCsvUpload,
  timeSaverExpert,
] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
```

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/calculate-personality.test.ts
git add tests/onboarding/personas/time-saver-expert.ts tests/onboarding/personas/index.ts
git commit -m "feat(onboarding-tests): time-saver-expert persona"
```

Expected: PASS — 7 tests (1 skip persona has null VMR, loop skips it).

---

## Task 13: CLI Argument Parsing

**Files:**
- Create: `cfos-office/tests/onboarding/runner/args.ts`
- Create: `cfos-office/tests/onboarding/unit/args.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cfos-office/tests/onboarding/unit/args.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseArgs } from '../runner/args'

describe('parseArgs', () => {
  it('returns defaults when no args', () => {
    expect(parseArgs([])).toEqual({
      personas: null,
      skipJudge: false,
      keepUsers: false,
      concurrency: 2,
      noUnit: false,
      runId: null,
    })
  })

  it('parses --personas as comma-separated list', () => {
    const out = parseArgs(['--personas', 'drifter-expat,builder-classic'])
    expect(out.personas).toEqual(['drifter-expat', 'builder-classic'])
  })

  it('parses --personas=id1,id2 form', () => {
    const out = parseArgs(['--personas=drifter-expat,builder-classic'])
    expect(out.personas).toEqual(['drifter-expat', 'builder-classic'])
  })

  it('parses --skip-judge flag', () => {
    expect(parseArgs(['--skip-judge']).skipJudge).toBe(true)
  })

  it('parses --keep-users flag', () => {
    expect(parseArgs(['--keep-users']).keepUsers).toBe(true)
  })

  it('parses --concurrency value', () => {
    expect(parseArgs(['--concurrency', '1']).concurrency).toBe(1)
  })

  it('parses --run-id value', () => {
    expect(parseArgs(['--run-id', 'my-run']).runId).toBe('my-run')
  })

  it('rejects invalid concurrency', () => {
    expect(() => parseArgs(['--concurrency', 'abc'])).toThrow()
  })

  it('combines multiple flags', () => {
    const out = parseArgs(['--personas', 'drifter-expat', '--skip-judge', '--concurrency', '1'])
    expect(out).toEqual({
      personas: ['drifter-expat'],
      skipJudge: true,
      keepUsers: false,
      concurrency: 1,
      noUnit: false,
      runId: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/args.test.ts
```

Expected: FAIL — "Cannot find module '../runner/args'".

- [ ] **Step 3: Implement args parser**

Create `cfos-office/tests/onboarding/runner/args.ts`:

```ts
export interface CliArgs {
  personas: string[] | null      // null = run all
  skipJudge: boolean
  keepUsers: boolean
  concurrency: number
  noUnit: boolean
  runId: string | null
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    personas: null,
    skipJudge: false,
    keepUsers: false,
    concurrency: 2,
    noUnit: false,
    runId: null,
  }

  function consumeValue(i: number, flag: string): { value: string; skip: number } {
    const current = argv[i]
    const eqIdx = current.indexOf('=')
    if (eqIdx >= 0) return { value: current.slice(eqIdx + 1), skip: 0 }
    if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`)
    return { value: argv[i + 1], skip: 1 }
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const base = a.split('=')[0]
    switch (base) {
      case '--personas': {
        const { value, skip } = consumeValue(i, '--personas')
        out.personas = value.split(',').map((s) => s.trim()).filter(Boolean)
        i += skip
        break
      }
      case '--skip-judge':
        out.skipJudge = true
        break
      case '--keep-users':
        out.keepUsers = true
        break
      case '--concurrency': {
        const { value, skip } = consumeValue(i, '--concurrency')
        const n = Number(value)
        if (!Number.isFinite(n) || n < 1) throw new Error(`--concurrency requires a positive number, got "${value}"`)
        out.concurrency = n
        i += skip
        break
      }
      case '--no-unit':
        out.noUnit = true
        break
      case '--run-id': {
        const { value, skip } = consumeValue(i, '--run-id')
        out.runId = value
        i += skip
        break
      }
      default:
        if (a.startsWith('--')) {
          throw new Error(`Unknown flag: ${a}`)
        }
        break
    }
  }

  return out
}
```

- [ ] **Step 4: Run tests**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/args.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/args.ts tests/onboarding/unit/args.test.ts
git commit -m "feat(onboarding-tests): CLI argument parser"
```

---

## Task 14: Preflight — Env + Production Guard

**Files:**
- Create: `cfos-office/tests/onboarding/runner/preflight.ts`
- Create: `cfos-office/tests/onboarding/unit/preflight.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cfos-office/tests/onboarding/unit/preflight.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkStagingGuard, checkRequiredEnv } from '../runner/preflight'

describe('checkStagingGuard', () => {
  it('accepts the staging project URL', () => {
    expect(() => checkStagingGuard('https://qlbhvlssksnrhsleadzn.supabase.co')).not.toThrow()
  })

  it('rejects a non-staging URL', () => {
    expect(() => checkStagingGuard('https://example.supabase.co')).toThrow(/staging/i)
  })

  it('rejects empty URL', () => {
    expect(() => checkStagingGuard('')).toThrow()
  })
})

describe('checkRequiredEnv', () => {
  const requiredKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']

  it('passes when all keys present', () => {
    const env = Object.fromEntries(requiredKeys.map((k) => [k, 'x']))
    expect(() => checkRequiredEnv(env)).not.toThrow()
  })

  it('fails with the missing key name', () => {
    const env = Object.fromEntries(requiredKeys.map((k) => [k, 'x']))
    delete env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => checkRequiredEnv(env)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `cfos-office/tests/onboarding/runner/preflight.ts`:

```ts
const STAGING_PROJECT_REF = 'qlbhvlssksnrhsleadzn'

export function checkStagingGuard(supabaseUrl: string): void {
  if (!supabaseUrl) {
    throw new Error('Staging guard: NEXT_PUBLIC_SUPABASE_URL is empty or missing.')
  }
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(
      `Staging guard: NEXT_PUBLIC_SUPABASE_URL does not point at CFO Staging (${STAGING_PROJECT_REF}).\n` +
      `Got: ${supabaseUrl}\n` +
      `The suite refuses to run against production or any non-staging project.`
    )
  }
}

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const

export function checkRequiredEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): void {
  const missing: string[] = []
  for (const key of REQUIRED_ENV) {
    if (!env[key] || env[key] === '') missing.push(key)
  }
  if (missing.length) {
    throw new Error(`Preflight: missing required env vars:\n  - ${missing.join('\n  - ')}`)
  }
}

export async function loadDotenvLocal(filepath: string): Promise<void> {
  const fs = await import('node:fs')
  let content: string
  try {
    content = fs.readFileSync(filepath, 'utf-8')
  } catch {
    return
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["'](.*)["']$/, '$1')
    if (!process.env[key]) process.env[key] = value
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/preflight.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/preflight.ts tests/onboarding/unit/preflight.test.ts
git commit -m "feat(onboarding-tests): preflight env checks + staging guard"
```

---

## Task 15: Dev Server Management

**Files:**
- Create: `cfos-office/tests/onboarding/runner/dev-server.ts`

- [ ] **Step 1: Write dev server module**

Create `cfos-office/tests/onboarding/runner/dev-server.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const DEV_SERVER_URL = 'http://localhost:3000'
const STARTUP_TIMEOUT_MS = 60_000

export interface DevServerHandle {
  url: string
  stop: () => Promise<void>
  spawned: boolean
}

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(2000) })
    return res.status < 500
  } catch {
    return false
  }
}

async function waitForReady(startedAt: number): Promise<void> {
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (await isServerRunning()) return
    await sleep(500)
  }
  throw new Error(`Dev server did not become ready within ${STARTUP_TIMEOUT_MS}ms at ${DEV_SERVER_URL}`)
}

export async function ensureDevServer(): Promise<DevServerHandle> {
  if (await isServerRunning()) {
    return {
      url: DEV_SERVER_URL,
      stop: async () => {},
      spawned: false,
    }
  }

  const child: ChildProcess = spawn('npx', ['next', 'dev'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  child.stdout?.on('data', () => {})
  child.stderr?.on('data', (buf) => {
    const msg = buf.toString()
    if (msg.includes('error')) {
      process.stderr.write(`[dev-server] ${msg}`)
    }
  })

  const startedAt = Date.now()
  try {
    await waitForReady(startedAt)
  } catch (err) {
    child.kill('SIGTERM')
    throw err
  }

  return {
    url: DEV_SERVER_URL,
    spawned: true,
    stop: async () => {
      if (!child.killed) {
        child.kill('SIGTERM')
        // Give it a moment to shut down
        await sleep(1500)
        if (!child.killed) child.kill('SIGKILL')
      }
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/dev-server.ts
git commit -m "feat(onboarding-tests): dev server lifecycle manager"
```

---

## Task 16: User Factory

**Files:**
- Create: `cfos-office/tests/onboarding/runner/user-factory.ts`

- [ ] **Step 1: Write the user factory**

Create `cfos-office/tests/onboarding/runner/user-factory.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const EMAIL_DOMAIN = 'cfo-test.local'

export interface TestUser {
  id: string
  email: string
  password: string
}

export function makeAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function randomPassword(): string {
  // 24-char hex
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createTestUser(
  admin: SupabaseClient,
  personaId: string,
  runId: string,
): Promise<TestUser> {
  const email = `test-onboarding-${personaId}-${runId}@${EMAIL_DOMAIN}`.toLowerCase()
  const password = randomPassword()

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      test_suite: 'onboarding',
      persona_id: personaId,
      run_id: runId,
    },
  })

  if (error) throw new Error(`createTestUser failed for ${personaId}: ${error.message}`)
  if (!data.user) throw new Error(`createTestUser returned no user for ${personaId}`)

  return { id: data.user.id, email, password }
}

export async function deleteTestUser(admin: SupabaseClient, userId: string): Promise<void> {
  // user_profiles, onboarding_progress, financial_portrait, transactions,
  // import_batches, value_map_results should cascade via FK on user_id.
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    console.error(`[user-factory] deleteUser ${userId} failed:`, error.message)
  }
}

export async function deleteAllTestUsers(admin: SupabaseClient, runId?: string): Promise<number> {
  // Safety net for crash recovery. Queries all users whose email ends in @cfo-test.local,
  // optionally filtered by runId.
  let deleted = 0
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    if (!data.users.length) break

    for (const u of data.users) {
      if (!u.email?.endsWith(`@${EMAIL_DOMAIN}`)) continue
      if (runId && !u.email.includes(`-${runId}@`)) continue
      await deleteTestUser(admin, u.id)
      deleted++
    }

    if (data.users.length < 100) break
    page++
  }
  return deleted
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/user-factory.ts
git commit -m "feat(onboarding-tests): Supabase test user factory + teardown"
```

---

## Task 17: Runner Types

**Files:**
- Create: `cfos-office/tests/onboarding/runner/types.ts`

- [ ] **Step 1: Write runner result types**

Create `cfos-office/tests/onboarding/runner/types.ts`:

```ts
import type { Persona } from '../personas/types'

export type LayerStatus = 'pass' | 'fail' | 'skip'

export interface HardRuleResult {
  ruleId: string
  passed: boolean
  detail?: string
}

export interface LikertResult {
  dimension: string
  score: number        // 1-5
  reason: string
}

export interface JudgeOutput {
  outputType: 'archetype' | 'insight'
  modelId: string
  timestamp: string
  hardRules: HardRuleResult[]
  likert: LikertResult[]
  raw: unknown         // Raw judge JSON response for audit
}

export interface CapturedBeat {
  beat: string
  screenshotPath: string | null
  networkResponses: {
    path: string
    status: number
    response: unknown
  }[]
}

export interface DbStateSnapshot {
  user_profiles: Record<string, unknown> | null
  financial_portrait: Record<string, unknown>[] | null
  onboarding_progress: Record<string, unknown> | null
  transactionCount: number
}

export interface PersonaRunResult {
  personaId: string
  label: string
  startedAt: string
  finishedAt: string
  durationMs: number

  // Overall
  layers: {
    functional: LayerStatus
    llm: LayerStatus
    visual: LayerStatus
  }

  // Functional layer
  beatsCompleted: string[]
  beatsSkipped: string[]
  functionalErrors: string[]
  dbState: DbStateSnapshot | null

  // Visual layer
  beats: CapturedBeat[]
  consoleErrors: string[]

  // LLM layer
  captured: {
    archetype?: unknown
    insight?: unknown
  }
  judge: {
    archetype?: JudgeOutput
    insight?: JudgeOutput
  }
  hardRuleFailures: string[]    // e.g. ["R1_no_banned_words", "R3_mentions_expected_topic"]
  likertMeans: Record<string, number>

  // Metadata
  error?: string                // Top-level error that aborted the persona
}

export interface SuiteRunResult {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  argsUsed: Record<string, unknown>
  stagingProjectRef: string
  personas: PersonaRunResult[]
  unitTestsPassed: boolean
  overallExitCode: 0 | 1
}

export interface RunContext {
  runId: string
  outputDir: string              // test-output/<run-id>
  skipJudge: boolean
  keepUsers: boolean
  devServerUrl: string
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/types.ts
git commit -m "feat(onboarding-tests): runner result types"
```

---

## Task 18: CSV Summariser

**Files:**
- Create: `cfos-office/tests/onboarding/runner/csv-summariser.ts`
- Create: `cfos-office/tests/onboarding/unit/csv-summariser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cfos-office/tests/onboarding/unit/csv-summariser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { summariseCsv } from '../runner/csv-summariser'

describe('summariseCsv', () => {
  const csv = [
    'Type,Started Date,Description,Amount,Currency,Balance',
    'TRANSFER,2026-01-28,Salary Acme Ltd,3200.00,GBP,3200.00',
    'CARD_PAYMENT,2026-01-01,Rent,-1100.00,GBP,2100.00',
    'CARD_PAYMENT,2026-01-05,Tesco,-60.00,GBP,2040.00',
    'CARD_PAYMENT,2026-01-12,Tesco,-55.00,GBP,1985.00',
    'CARD_PAYMENT,2026-01-15,Netflix,-14.99,GBP,1970.01',
    'CARD_PAYMENT,2026-01-18,Vanguard ISA,-500.00,GBP,1470.01',
  ].join('\n')

  it('extracts a structured summary', () => {
    const summary = summariseCsv(csv, 'GBP')
    expect(summary.transactionCount).toBe(6)
    expect(summary.dateRange.from).toBe('2026-01-01')
    expect(summary.dateRange.to).toBe('2026-01-28')
    expect(summary.incomeTotal).toBeCloseTo(3200)
    expect(summary.spendingTotal).toBeCloseTo(1729.99)
    expect(summary.topMerchants.length).toBeGreaterThan(0)
    expect(summary.topMerchants[0].description.toLowerCase()).toContain('rent')
  })

  it('groups duplicate merchants', () => {
    const summary = summariseCsv(csv, 'GBP')
    const tesco = summary.topMerchants.find((m) => m.description === 'Tesco')
    expect(tesco).toBeDefined()
    expect(tesco?.count).toBe(2)
  })

  it('formats summary as text block for judge prompt', () => {
    const summary = summariseCsv(csv, 'GBP')
    const text = summary.asText()
    expect(text).toContain('6 transactions')
    expect(text).toContain('Rent')
    expect(text).toContain('Tesco')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement summariser**

Create `cfos-office/tests/onboarding/runner/csv-summariser.ts`:

```ts
export interface CsvSummary {
  transactionCount: number
  dateRange: { from: string; to: string }
  incomeTotal: number
  spendingTotal: number
  currency: string
  topMerchants: { description: string; total: number; count: number }[]
  allNumbersMentioned: Set<number>   // For "numbers match CSV" judge check
  asText: () => string
}

interface ParsedRow {
  date: string
  description: string
  amount: number
}

function parseCsv(content: string): ParsedRow[] {
  const lines = content.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const header = lines[0].toLowerCase().split(',').map((h) => h.trim())
  const dateIdx = header.findIndex((h) => h.includes('date'))
  const descIdx = header.findIndex((h) => h === 'description' || h === 'desc')
  const amountIdx = header.findIndex((h) => h === 'amount')

  if (dateIdx < 0 || descIdx < 0 || amountIdx < 0) {
    // Fall back to positional: type,date,desc,amount,...
    return lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim())
      return {
        date: cols[1] ?? '',
        description: cols[2] ?? '',
        amount: Number(cols[3]),
      }
    }).filter((r) => Number.isFinite(r.amount))
  }

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim())
    return {
      date: cols[dateIdx],
      description: cols[descIdx],
      amount: Number(cols[amountIdx]),
    }
  }).filter((r) => Number.isFinite(r.amount))
}

export function summariseCsv(content: string, currency: string): CsvSummary {
  const rows = parseCsv(content)
  let income = 0
  let spending = 0
  const byMerchant = new Map<string, { total: number; count: number }>()
  const numbers = new Set<number>()

  let minDate = ''
  let maxDate = ''

  for (const r of rows) {
    if (r.amount > 0) income += r.amount
    else spending += Math.abs(r.amount)

    numbers.add(Math.abs(Math.round(r.amount * 100) / 100))

    const key = r.description.trim()
    if (!key) continue
    const current = byMerchant.get(key) ?? { total: 0, count: 0 }
    current.total += Math.abs(r.amount)
    current.count += 1
    byMerchant.set(key, current)

    if (!minDate || r.date < minDate) minDate = r.date
    if (!maxDate || r.date > maxDate) maxDate = r.date
  }

  const topMerchants = Array.from(byMerchant.entries())
    .map(([description, v]) => ({ description, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15)

  return {
    transactionCount: rows.length,
    dateRange: { from: minDate, to: maxDate },
    incomeTotal: Math.round(income * 100) / 100,
    spendingTotal: Math.round(spending * 100) / 100,
    currency,
    topMerchants,
    allNumbersMentioned: numbers,
    asText: () => {
      const lines = [
        `${rows.length} transactions from ${minDate} to ${maxDate}`,
        `Total income: ${currency} ${Math.round(income * 100) / 100}`,
        `Total spending: ${currency} ${Math.round(spending * 100) / 100}`,
        `Top merchants by spend:`,
        ...topMerchants.slice(0, 12).map(
          (m) => `  - ${m.description}: ${currency} ${Math.round(m.total * 100) / 100} across ${m.count} txns`,
        ),
      ]
      return lines.join('\n')
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd cfos-office
npx vitest run tests/onboarding/unit/csv-summariser.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/csv-summariser.ts tests/onboarding/unit/csv-summariser.test.ts
git commit -m "feat(onboarding-tests): CSV summariser for judge context"
```

---

## Task 19: LLM Judge

**Files:**
- Create: `cfos-office/tests/onboarding/runner/judge.ts`

- [ ] **Step 1: Write judge module**

Create `cfos-office/tests/onboarding/runner/judge.ts`:

```ts
import { generateText } from 'ai'
import { utilityModel } from '@/lib/ai/provider'
import type { Persona } from '../personas/types'
import type { CsvSummary } from './csv-summariser'
import type { JudgeOutput, HardRuleResult, LikertResult } from './types'

// ── Hard-rule pre-checks (deterministic, run before the LLM) ────────────────

function checkBannedWords(text: string, banned: string[] | undefined): HardRuleResult {
  if (!banned?.length) return { ruleId: 'R1_no_banned_words', passed: true }
  const lower = text.toLowerCase()
  for (const word of banned) {
    if (lower.includes(word.toLowerCase())) {
      return {
        ruleId: 'R1_no_banned_words',
        passed: false,
        detail: `Contains banned word: "${word}"`,
      }
    }
  }
  return { ruleId: 'R1_no_banned_words', passed: true }
}

function checkBannedPatterns(text: string, patterns: string[] | undefined): HardRuleResult {
  if (!patterns?.length) return { ruleId: 'R1b_no_banned_patterns', passed: true }
  for (const src of patterns) {
    const re = new RegExp(src, 'i')
    if (re.test(text)) {
      return {
        ruleId: 'R1b_no_banned_patterns',
        passed: false,
        detail: `Matches banned pattern: /${src}/i`,
      }
    }
  }
  return { ruleId: 'R1b_no_banned_patterns', passed: true }
}

function checkMustMentionOneOf(text: string, candidates: string[] | undefined, ruleId: string): HardRuleResult {
  if (!candidates?.length) return { ruleId, passed: true }
  const lower = text.toLowerCase()
  const hit = candidates.some((c) => lower.includes(c.toLowerCase()))
  return {
    ruleId,
    passed: hit,
    detail: hit ? undefined : `Expected at least one of: ${candidates.join(', ')}`,
  }
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? []
  return matches.map(Number).filter((n) => Number.isFinite(n))
}

function checkNumbersMatchCsv(text: string, csvSummary: CsvSummary | null): HardRuleResult {
  if (!csvSummary) return { ruleId: 'R4_numbers_match_csv', passed: true }
  const quoted = extractNumbers(text)
  // Small numbers (0-5, 12 for months, etc.) and percentages are allowed.
  const allowed = new Set([...csvSummary.allNumbersMentioned])
  const violations: number[] = []
  for (const n of quoted) {
    if (n < 10) continue
    if (n === Math.round(csvSummary.spendingTotal * 100) / 100) continue
    if (n === Math.round(csvSummary.incomeTotal * 100) / 100) continue
    // Tolerate rounding: match if n matches any csv number within 1% or ±1 currency unit
    let ok = false
    for (const num of allowed) {
      if (num === n) { ok = true; break }
      if (Math.abs(num - n) < Math.max(1, num * 0.01)) { ok = true; break }
    }
    if (!ok) violations.push(n)
  }
  if (violations.length > 0) {
    return {
      ruleId: 'R4_numbers_match_csv',
      passed: false,
      detail: `Numbers not found in CSV: ${violations.slice(0, 5).join(', ')}`,
    }
  }
  return { ruleId: 'R4_numbers_match_csv', passed: true }
}

// ── LLM judge for subjective dimensions ─────────────────────────────────────

const JUDGE_PROMPT_TEMPLATE = `You are grading output from "your CFO" — a personal-finance AI in The CFO's Office.

<persona>
{persona_block}
</persona>

<cfo_output_type>{output_type}</cfo_output_type>

<cfo_output>
{cfo_output}
</cfo_output>

<source_csv_summary>
{csv_summary}
</source_csv_summary>

Score the output 1-5 across these dimensions, with a single-sentence justification each:

- L1_warmth: Smart-friend tone vs cold/lecturing
- L2_accuracy: Claims grounded in source data (no hallucinated figures or merchants)
- L3_on_brand: Matches CFO voice (no "advice"/"advise" language, uses tangible comparisons, never preachy)
- L4_persona_fit: Feels written for this specific user, not generic
- L5_actionability: Points toward next action or concrete insight

Return JSON ONLY in this exact shape, nothing else:
{
  "L1_warmth": { "score": 4, "reason": "..." },
  "L2_accuracy": { "score": 5, "reason": "..." },
  "L3_on_brand": { "score": 3, "reason": "..." },
  "L4_persona_fit": { "score": 4, "reason": "..." },
  "L5_actionability": { "score": 4, "reason": "..." }
}`

function buildPersonaBlock(persona: Persona): string {
  return [
    `id: ${persona.id}`,
    `label: ${persona.label}`,
    `country: ${persona.profile.country}`,
    `currency: ${persona.profile.currency}`,
    `target_archetype: ${persona.expectations.archetype.personalityId}`,
    `target_dominant_quadrant: ${persona.expectations.archetype.expectedQuadrant}`,
  ].join('\n')
}

async function callLlmJudge(
  persona: Persona,
  outputType: 'archetype' | 'insight',
  cfoOutput: unknown,
  csvSummary: CsvSummary | null,
): Promise<{ likert: LikertResult[]; raw: unknown; modelId: string }> {
  const prompt = JUDGE_PROMPT_TEMPLATE
    .replace('{persona_block}', buildPersonaBlock(persona))
    .replace('{output_type}', outputType)
    .replace('{cfo_output}', JSON.stringify(cfoOutput, null, 2))
    .replace('{csv_summary}', csvSummary?.asText() ?? 'No CSV uploaded for this persona.')

  const { text } = await generateText({
    model: utilityModel,
    prompt,
    temperature: 0,
    maxOutputTokens: 600,
  })

  // Extract JSON (Haiku may occasionally wrap in prose)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Judge returned no JSON: ${text.slice(0, 200)}`)
  }
  let parsed: Record<string, { score: number; reason: string }>
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (e) {
    throw new Error(`Judge returned malformed JSON: ${jsonMatch[0].slice(0, 200)}`)
  }

  const likert: LikertResult[] = Object.entries(parsed).map(([dim, v]) => ({
    dimension: dim.replace(/^L\d_/, ''),
    score: Math.max(1, Math.min(5, Math.round(v.score))),
    reason: v.reason ?? '',
  }))

  return { likert, raw: parsed, modelId: 'anthropic.claude-haiku-4-5' }
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function judgeOutput(
  persona: Persona,
  outputType: 'archetype' | 'insight',
  cfoOutput: unknown,
  csvSummary: CsvSummary | null,
): Promise<JudgeOutput> {
  const text = typeof cfoOutput === 'string' ? cfoOutput : JSON.stringify(cfoOutput)
  const rules = persona.expectations.hardRules

  const hardRules: HardRuleResult[] = []
  hardRules.push(checkBannedWords(text, rules?.bannedWords))
  hardRules.push(checkBannedPatterns(text, rules?.bannedPatterns))

  if (outputType === 'archetype') {
    hardRules.push(checkMustMentionOneOf(text, rules?.archetype?.mustMentionOneOf, 'R2_archetype_mentions_one_of'))
    hardRules.push(checkMustMentionOneOf(text, rules?.archetype?.mustAcknowledgeOneOf, 'R2b_archetype_acknowledges_one_of'))
    if (rules?.archetype?.mustReferenceQuadrant) {
      hardRules.push(checkMustMentionOneOf(text, [rules.archetype.mustReferenceQuadrant], 'R2c_archetype_references_quadrant'))
    }
  } else {
    hardRules.push(checkMustMentionOneOf(text, rules?.insight?.mustReferenceMerchantsFromCsv, 'R3_insight_references_csv_merchants'))
    hardRules.push(checkMustMentionOneOf(text, rules?.insight?.mustReferenceOneOf, 'R3b_insight_mentions_one_of'))
    if (rules?.insight?.numbersMustMatchCsv) {
      hardRules.push(checkNumbersMatchCsv(text, csvSummary))
    }
  }

  let likert: LikertResult[] = []
  let raw: unknown = null
  let modelId = 'anthropic.claude-haiku-4-5'
  try {
    const judged = await callLlmJudge(persona, outputType, cfoOutput, csvSummary)
    likert = judged.likert
    raw = judged.raw
    modelId = judged.modelId
  } catch (e) {
    hardRules.push({ ruleId: 'R0_judge_call_succeeded', passed: false, detail: String(e) })
  }

  return {
    outputType,
    modelId,
    timestamp: new Date().toISOString(),
    hardRules,
    likert,
    raw,
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/judge.ts
git commit -m "feat(onboarding-tests): LLM judge with hard rules + Likert scoring"
```

---

## Task 20: Playwright Driver

**Files:**
- Create: `cfos-office/tests/onboarding/runner/playwright-driver.ts`

- [ ] **Step 1: Write the driver**

Create `cfos-office/tests/onboarding/runner/playwright-driver.ts`:

```ts
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Persona } from '../personas/types'
import type { TestUser } from './user-factory'
import type { CapturedBeat } from './types'

const BEAT_ORDER = [
  'welcome',
  'framework',
  'value_map',
  'archetype',
  'csv_upload',
  'capabilities',
  'first_insight',
  'handoff',
] as const

export interface DriverOptions {
  baseUrl: string
  outputDir: string              // test-output/<run>/<persona>
  headless?: boolean
}

export interface DriverResult {
  beats: CapturedBeat[]
  capturedArchetype: unknown | null
  capturedInsight: unknown | null
  consoleErrors: string[]
  beatsCompleted: string[]
  beatsSkipped: string[]
  errors: string[]
}

export async function runPersonaInBrowser(
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
): Promise<DriverResult> {
  const result: DriverResult = {
    beats: [],
    capturedArchetype: null,
    capturedInsight: null,
    consoleErrors: [],
    beatsCompleted: [],
    beatsSkipped: [],
    errors: [],
  }

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: opts.headless !== false })
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },  // mobile-first
      deviceScaleFactor: 2,
    })

    const page = await context.newPage()

    page.on('console', (msg) => {
      if (msg.type() === 'error') result.consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      result.consoleErrors.push(`PageError: ${err.message}`)
    })

    // Capture API responses
    page.on('response', async (res) => {
      const url = res.url()
      if (url.includes('/api/onboarding/generate-archetype')) {
        try {
          const body = await res.json()
          result.capturedArchetype = body
        } catch {}
      }
      if (url.includes('/api/onboarding/generate-insight')) {
        try {
          const body = await res.json()
          result.capturedInsight = body
        } catch {}
      }
    })

    await signIn(page, opts.baseUrl, user)
    await runOnboarding(page, persona, opts, result)

    await context.close()
  } catch (e) {
    result.errors.push(`Driver crashed: ${String(e)}`)
  } finally {
    if (browser) await browser.close()
  }

  return result
}

// ── Sign in ─────────────────────────────────────────────────────────────────

async function signIn(page: Page, baseUrl: string, user: TestUser): Promise<void> {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', user.email)
  await page.fill('input[type="password"]', user.password)
  await Promise.all([
    page.waitForURL(/\/office|\/onboarding|\/$/, { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ])
}

// ── Onboarding walkthrough ──────────────────────────────────────────────────

async function runOnboarding(
  page: Page,
  persona: Persona,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  // Land on the onboarding modal
  await page.waitForSelector('text=/First Meeting/i', { timeout: 20_000 })

  for (const beat of BEAT_ORDER) {
    if (persona.skipBeats.includes(beat)) {
      result.beatsSkipped.push(beat)
      continue
    }

    try {
      await driveBeat(page, beat, persona, opts, result)
      result.beatsCompleted.push(beat)
    } catch (e) {
      result.errors.push(`Beat ${beat} failed: ${String(e)}`)
      break
    }
  }
}

async function driveBeat(
  page: Page,
  beat: string,
  persona: Persona,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  // Wait for the beat's characteristic element
  const shot = path.join(opts.outputDir, `${beat}.png`)
  const beatRecord: CapturedBeat = { beat, screenshotPath: null, networkResponses: [] }

  switch (beat) {
    case 'welcome':
    case 'framework': {
      await page.waitForSelector('button:has-text("Let\'s go"), button:has-text("Let\'s do it"), button:has-text("Continue")', { timeout: 30_000 })
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      await clickAnyOf(page, ['button:has-text("Let\'s go")', 'button:has-text("Let\'s do it")', 'button:has-text("Continue")'])
      break
    }

    case 'value_map': {
      if (persona.skipBeats.includes('value_map')) {
        await page.screenshot({ path: shot, fullPage: false })
        beatRecord.screenshotPath = shot
        await clickAnyOf(page, ['button:has-text("Skip")', 'button[aria-label*="Skip"]'])
        break
      }
      if (!persona.valueMapResponses) throw new Error('Persona has no Value Map responses but is not configured to skip')

      // Wait for first card
      await page.waitForSelector('[data-testid="value-map-card"], text=/Monthly rent/i', { timeout: 30_000 })
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot

      for (const response of persona.valueMapResponses) {
        await tapValueMapCard(page, response)
      }
      // Final summary → continue
      await page.waitForSelector('button:has-text("Continue"), button:has-text("See my archetype"), button:has-text("Next")', { timeout: 15_000 })
      await clickAnyOf(page, ['button:has-text("See my archetype")', 'button:has-text("Continue")', 'button:has-text("Next")'])
      break
    }

    case 'archetype': {
      // Wait for archetype card to finish loading (can take up to 20s)
      await page.waitForFunction(
        () => !!document.querySelector('[data-archetype-loaded="true"], h2, h3'),
        { timeout: 45_000 },
      )
      // Extra dwell — onboarding enforces a 20s min dwell after archetype reveal
      await page.waitForTimeout(1000)
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      // Try to click forward; if dwell prevents it, wait longer
      await page.waitForSelector('button:has-text("Upload"), button:has-text("Continue")', { timeout: 30_000 })
      await clickAnyOf(page, ['button:has-text("Upload a statement")', 'button:has-text("Upload")', 'button:has-text("Continue")'])
      break
    }

    case 'csv_upload': {
      if (persona.skipBeats.includes('csv_upload') || !persona.csv) {
        await page.screenshot({ path: shot, fullPage: false })
        beatRecord.screenshotPath = shot
        await clickAnyOf(page, ['button:has-text("Skip")', 'button:has-text("Not now")'])
        break
      }

      // Attach CSV via file input
      await page.waitForSelector('input[type="file"]', { timeout: 20_000 })
      const csvBuf = Buffer.from(persona.csv.contentBase64, 'base64')
      await page.setInputFiles('input[type="file"]', [{
        name: persona.csv.filename,
        mimeType: persona.csv.filename.endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        buffer: csvBuf,
      }])
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      // Wait for upload to advance UI to capabilities
      await page.waitForSelector('text=/brought you to the office|focus on first/i', { timeout: 45_000 })
      break
    }

    case 'capabilities': {
      await page.waitForSelector('[data-testid="capability-option"], button:has-text("Where my money")', { timeout: 30_000 })
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      // Pick first 2 capabilities + submit
      const options = await page.locator('button').filter({ hasText: /Where my money|Understanding my|Tracking what|Planning big/ }).all()
      if (options.length >= 2) {
        await options[0].click()
        await options[1].click()
      }
      await clickAnyOf(page, ['button:has-text("Done")', 'button:has-text("Continue")', 'button:has-text("Next")'])
      break
    }

    case 'first_insight': {
      // Wait for insight to render (can take up to 30s while narration generates)
      await page.waitForSelector('[data-testid="insight-card"], text=/I\'ve been through/i, [data-insight-loaded="true"]', { timeout: 60_000 })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      // Rate the insight 4⭐ to proceed
      const ratingButtons = page.locator('button[aria-label*="rate" i], button[aria-label*="star" i]')
      if (await ratingButtons.count() >= 4) {
        await ratingButtons.nth(3).click()
      } else {
        // Fallback: click any proceed button
        await clickAnyOf(page, ['button:has-text("Continue")', 'button:has-text("Next")'])
      }
      break
    }

    case 'handoff': {
      await page.waitForSelector('button:has-text("Enter the Office"), text=/Welcome to the office/i', { timeout: 30_000 })
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      await clickAnyOf(page, ['button:has-text("Enter the Office")'])
      // Wait for redirect to /office
      await page.waitForURL(/\/office/, { timeout: 15_000 })
      break
    }
  }

  result.beats.push(beatRecord)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function clickAnyOf(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if (await loc.count() > 0) {
      await loc.click()
      return
    }
  }
  throw new Error(`None of selectors clickable: ${selectors.join(' | ')}`)
}

async function tapValueMapCard(page: Page, response: { cardId: string; quadrant: string | null; confidence: number; hardToDecide?: boolean }): Promise<void> {
  // The Value Map shows one card at a time; we tap the quadrant button then confirm.
  await page.waitForTimeout(300)  // let animation settle
  if (response.hardToDecide || response.quadrant === null) {
    await clickAnyOf(page, ['button:has-text("Hard to decide")', 'button:has-text("Skip card")', 'button[aria-label*="hard" i]'])
    return
  }
  const quadrantLabel = response.quadrant.charAt(0).toUpperCase() + response.quadrant.slice(1)
  await clickAnyOf(page, [`button:has-text("${quadrantLabel}")`, `button[data-quadrant="${response.quadrant}"]`])
  // Confidence slider — set to response.confidence if present
  const slider = page.locator('input[type="range"]').first()
  if (await slider.count() > 0) {
    const value = String(response.confidence)
    await slider.evaluate((el, v) => {
      const input = el as HTMLInputElement
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      nativeSetter.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  }
  await clickAnyOf(page, ['button:has-text("Confirm")', 'button:has-text("Next")'])
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/playwright-driver.ts
git commit -m "feat(onboarding-tests): Playwright beat-by-beat driver"
```

---

## Task 21: DB State Assertions

**Files:**
- Create: `cfos-office/tests/onboarding/runner/db-assertions.ts`

- [ ] **Step 1: Write DB assertions module**

Create `cfos-office/tests/onboarding/runner/db-assertions.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Persona } from '../personas/types'
import type { DbStateSnapshot } from './types'

export async function snapshotDbState(admin: SupabaseClient, userId: string): Promise<DbStateSnapshot> {
  const [profileRes, portraitRes, progressRes, txnRes] = await Promise.all([
    admin.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('financial_portrait').select('*').eq('user_id', userId),
    admin.from('onboarding_progress').select('*').eq('user_id', userId).maybeSingle(),
    admin.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  return {
    user_profiles: profileRes.data ?? null,
    financial_portrait: portraitRes.data ?? null,
    onboarding_progress: progressRes.data ?? null,
    transactionCount: txnRes.count ?? 0,
  }
}

export function assertDbState(persona: Persona, snapshot: DbStateSnapshot): string[] {
  const errors: string[] = []
  const expected = persona.expectations.dbAfterHandoff

  if (expected.user_profiles) {
    for (const [key, want] of Object.entries(expected.user_profiles)) {
      const got = (snapshot.user_profiles ?? {})[key]
      if (got !== want) {
        errors.push(`user_profiles.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
      }
    }
  }

  if (expected.financial_portrait) {
    const portrait = snapshot.financial_portrait ?? []
    for (const [key, want] of Object.entries(expected.financial_portrait)) {
      if (want === 'exists') {
        const has = portrait.some((p) => p.trait_key === key)
        if (!has) errors.push(`financial_portrait.${key}: expected to exist`)
      } else {
        const row = portrait.find((p) => p.trait_key === key)
        if (!row || row.trait_value !== want) {
          errors.push(`financial_portrait.${key}: expected trait_value=${JSON.stringify(want)}, got ${JSON.stringify(row?.trait_value)}`)
        }
      }
    }
  }

  if (expected.onboarding_progress) {
    for (const [key, want] of Object.entries(expected.onboarding_progress)) {
      const got = (snapshot.onboarding_progress ?? {})[key]
      if (want === 'not-null') {
        if (got == null) errors.push(`onboarding_progress.${key}: expected not-null, got null`)
      } else if (got !== want) {
        errors.push(`onboarding_progress.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
      }
    }
  }

  if (expected.transactions?.countBetween) {
    const [min, max] = expected.transactions.countBetween
    if (snapshot.transactionCount < min || snapshot.transactionCount > max) {
      errors.push(`transactions.count: expected between ${min}-${max}, got ${snapshot.transactionCount}`)
    }
  }

  return errors
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/db-assertions.ts
git commit -m "feat(onboarding-tests): DB state snapshot + assertion helpers"
```

---

## Task 22: Persona Runner (Orchestrator)

**Files:**
- Create: `cfos-office/tests/onboarding/runner/persona-runner.ts`

- [ ] **Step 1: Write the orchestrator**

Create `cfos-office/tests/onboarding/runner/persona-runner.ts`:

```ts
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { makeAdminClient, createTestUser, deleteTestUser } from './user-factory'
import { runPersonaInBrowser } from './playwright-driver'
import { snapshotDbState, assertDbState } from './db-assertions'
import { summariseCsv } from './csv-summariser'
import { judgeOutput } from './judge'
import type { Persona } from '../personas/types'
import type { PersonaRunResult, RunContext, LayerStatus } from './types'

export async function runPersona(
  persona: Persona,
  ctx: RunContext,
): Promise<PersonaRunResult> {
  const startedAt = new Date().toISOString()
  const startTs = Date.now()
  const admin = makeAdminClient()
  const personaOutputDir = path.join(ctx.outputDir, persona.id)
  await mkdir(path.join(personaOutputDir, 'captured'), { recursive: true })

  const result: PersonaRunResult = {
    personaId: persona.id,
    label: persona.label,
    startedAt,
    finishedAt: '',
    durationMs: 0,
    layers: { functional: 'skip', llm: 'skip', visual: 'skip' },
    beatsCompleted: [],
    beatsSkipped: [],
    functionalErrors: [],
    dbState: null,
    beats: [],
    consoleErrors: [],
    captured: {},
    judge: {},
    hardRuleFailures: [],
    likertMeans: {},
  }

  let user: Awaited<ReturnType<typeof createTestUser>> | null = null

  try {
    // 1. Create user
    user = await createTestUser(admin, persona.id, ctx.runId)

    // 2. Drive browser
    const driverOut = await runPersonaInBrowser(persona, user, {
      baseUrl: ctx.devServerUrl,
      outputDir: personaOutputDir,
    })
    result.beats = driverOut.beats
    result.beatsCompleted = driverOut.beatsCompleted
    result.beatsSkipped = driverOut.beatsSkipped
    result.consoleErrors = driverOut.consoleErrors
    result.functionalErrors.push(...driverOut.errors)
    result.captured.archetype = driverOut.capturedArchetype ?? undefined
    result.captured.insight = driverOut.capturedInsight ?? undefined

    // 3. DB assertions
    const snap = await snapshotDbState(admin, user.id)
    result.dbState = snap
    const dbErrs = assertDbState(persona, snap)
    result.functionalErrors.push(...dbErrs)

    // Persist captured JSON
    await writeFile(
      path.join(personaOutputDir, 'captured', 'archetype.json'),
      JSON.stringify(driverOut.capturedArchetype ?? null, null, 2),
    )
    await writeFile(
      path.join(personaOutputDir, 'captured', 'insight.json'),
      JSON.stringify(driverOut.capturedInsight ?? null, null, 2),
    )
    await writeFile(
      path.join(personaOutputDir, 'captured', 'db-state-after-handoff.json'),
      JSON.stringify(snap, null, 2),
    )
    if (result.consoleErrors.length) {
      await writeFile(
        path.join(personaOutputDir, 'console-errors.log'),
        result.consoleErrors.join('\n'),
      )
    }

    // 4. Functional layer status
    const beatsMatch = persona.expectations.beatsCompleted.every((b) => result.beatsCompleted.includes(b))
    result.layers.functional = (beatsMatch && result.functionalErrors.length === 0) ? 'pass' : 'fail'
    result.layers.visual = result.beats.length > 0 ? 'pass' : 'fail'

    // 5. LLM judge
    if (!ctx.skipJudge && persona.expectations.likertDimensions.length > 0) {
      const csvSummary = persona.csv
        ? summariseCsv(Buffer.from(persona.csv.contentBase64, 'base64').toString('utf-8'), persona.profile.currency)
        : null

      if (result.captured.archetype) {
        const j = await judgeOutput(persona, 'archetype', result.captured.archetype, csvSummary)
        result.judge.archetype = j
        await writeFile(path.join(personaOutputDir, 'captured', 'judge-archetype.json'), JSON.stringify(j, null, 2))
      }
      if (result.captured.insight) {
        const j = await judgeOutput(persona, 'insight', result.captured.insight, csvSummary)
        result.judge.insight = j
        await writeFile(path.join(personaOutputDir, 'captured', 'judge-insight.json'), JSON.stringify(j, null, 2))
      }

      // Aggregate
      const allHardRules = [
        ...(result.judge.archetype?.hardRules ?? []),
        ...(result.judge.insight?.hardRules ?? []),
      ]
      const failures = allHardRules.filter((r) => !r.passed)
      result.hardRuleFailures = failures.map((f) => `${f.ruleId}${f.detail ? ' — ' + f.detail : ''}`)

      const likertSums: Record<string, { total: number; n: number }> = {}
      for (const j of [result.judge.archetype, result.judge.insight]) {
        if (!j) continue
        for (const l of j.likert) {
          if (!likertSums[l.dimension]) likertSums[l.dimension] = { total: 0, n: 0 }
          likertSums[l.dimension].total += l.score
          likertSums[l.dimension].n += 1
        }
      }
      for (const [dim, v] of Object.entries(likertSums)) {
        result.likertMeans[dim] = Math.round((v.total / v.n) * 10) / 10
      }

      result.layers.llm = failures.length === 0 ? 'pass' : 'fail'
    } else {
      result.layers.llm = persona.expectations.likertDimensions.length === 0 ? 'skip' : 'skip'
    }
  } catch (e) {
    result.error = `Persona runner crashed: ${String(e)}`
    result.layers.functional = 'fail'
  } finally {
    if (user && !ctx.keepUsers) {
      await deleteTestUser(admin, user.id)
    }
  }

  result.finishedAt = new Date().toISOString()
  result.durationMs = Date.now() - startTs
  return result
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/persona-runner.ts
git commit -m "feat(onboarding-tests): persona runner orchestration"
```

---

## Task 23: Reporter (HTML + JSON)

**Files:**
- Create: `cfos-office/tests/onboarding/runner/reporter.ts`

- [ ] **Step 1: Write reporter**

Create `cfos-office/tests/onboarding/runner/reporter.ts`:

```ts
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SuiteRunResult, PersonaRunResult, LayerStatus } from './types'

function badge(status: LayerStatus): string {
  if (status === 'pass') return '<span class="b pass">✓ pass</span>'
  if (status === 'fail') return '<span class="b fail">✗ fail</span>'
  return '<span class="b skip">— skip</span>'
}

function statusCell(status: LayerStatus): string {
  if (status === 'pass') return '✓'
  if (status === 'fail') return '✗'
  return '—'
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 100) / 10
  return `${s}s`
}

function personaSection(p: PersonaRunResult, outputRoot: string): string {
  const imgs = p.beats
    .filter((b) => b.screenshotPath)
    .map((b) => {
      const rel = path.relative(outputRoot, b.screenshotPath!)
      return `<figure><img src="${rel}" alt="${b.beat}"><figcaption>${b.beat}</figcaption></figure>`
    })
    .join('')

  const hardRules = [
    ...(p.judge.archetype?.hardRules ?? []).map((r) => ({ ...r, type: 'archetype' })),
    ...(p.judge.insight?.hardRules ?? []).map((r) => ({ ...r, type: 'insight' })),
  ]
  const hardRulesHtml = hardRules.map((r) =>
    `<li class="${r.passed ? 'pass' : 'fail'}">[${r.type}] ${r.ruleId}${r.detail ? ` — ${r.detail}` : ''}</li>`
  ).join('')

  const likertRows = Object.entries(p.likertMeans)
    .map(([dim, score]) => `<tr><td>${dim}</td><td>${score.toFixed(1)}</td></tr>`).join('')

  const funcErrorsHtml = p.functionalErrors.length
    ? `<details><summary>Functional errors (${p.functionalErrors.length})</summary><pre>${p.functionalErrors.join('\n')}</pre></details>`
    : ''

  const consoleHtml = p.consoleErrors.length
    ? `<details><summary>Console errors (${p.consoleErrors.length})</summary><pre>${p.consoleErrors.join('\n')}</pre></details>`
    : ''

  return `
<section class="persona">
  <header>
    <h2>${p.label} <code>(${p.personaId})</code></h2>
    <div class="layers">
      Functional: ${badge(p.layers.functional)}
      LLM: ${badge(p.layers.llm)}
      Visual: ${badge(p.layers.visual)}
      <span class="duration">${fmtDuration(p.durationMs)}</span>
    </div>
  </header>
  ${p.error ? `<div class="error">Fatal: ${p.error}</div>` : ''}
  <h3>Screenshots</h3>
  <div class="gallery">${imgs}</div>
  <h3>LLM judge</h3>
  <h4>Hard rules</h4>
  <ul class="rules">${hardRulesHtml || '<li>None (no judge run)</li>'}</ul>
  <h4>Likert means</h4>
  <table><thead><tr><th>Dimension</th><th>Score (1-5)</th></tr></thead><tbody>${likertRows || '<tr><td colspan="2">—</td></tr>'}</tbody></table>
  <h3>Captured</h3>
  <details><summary>Archetype JSON</summary><pre>${JSON.stringify(p.captured.archetype ?? null, null, 2)}</pre></details>
  <details><summary>Insight JSON</summary><pre>${JSON.stringify(p.captured.insight ?? null, null, 2)}</pre></details>
  <details><summary>DB state after handoff</summary><pre>${JSON.stringify(p.dbState ?? null, null, 2)}</pre></details>
  ${funcErrorsHtml}
  ${consoleHtml}
</section>`
}

const CSS = `
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; background: #0e1117; color: #e8e9ed; }
h1, h2, h3, h4 { color: #fefefe; }
h1 { margin-top: 0; }
h2 { border-bottom: 1px solid #2a2e37; padding-bottom: 8px; }
.summary-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
.summary-table th, .summary-table td { padding: 8px 12px; border-bottom: 1px solid #2a2e37; text-align: left; }
.summary-table th { color: #9aa0a6; font-weight: 600; font-size: 12px; text-transform: uppercase; }
.b { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px; }
.b.pass { background: #22543d; color: #68d391; }
.b.fail { background: #742a2a; color: #fc8181; }
.b.skip { background: #2d3748; color: #a0aec0; }
.persona { background: #1a1e27; padding: 20px; border-radius: 8px; margin-bottom: 24px; }
.persona header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
.persona .duration { color: #9aa0a6; font-size: 14px; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin: 12px 0; }
.gallery figure { margin: 0; }
.gallery img { width: 100%; border: 1px solid #2a2e37; border-radius: 4px; cursor: pointer; }
.gallery img:hover { transform: scale(1.02); transition: 0.15s; }
.gallery figcaption { font-size: 12px; color: #9aa0a6; text-align: center; margin-top: 4px; font-family: monospace; }
pre { background: #0e1117; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
details { margin: 8px 0; }
summary { cursor: pointer; color: #90cdf4; }
.rules li { font-family: monospace; font-size: 12px; padding: 2px 0; }
.rules li.pass { color: #68d391; }
.rules li.fail { color: #fc8181; }
.error { background: #742a2a; color: #fed7d7; padding: 10px; border-radius: 4px; margin: 10px 0; }
table { border-collapse: collapse; }
table th, table td { padding: 4px 12px; border-bottom: 1px solid #2a2e37; }
`

export async function writeReports(suite: SuiteRunResult, outputDir: string): Promise<void> {
  // JSON
  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(suite, null, 2))

  // HTML
  const rows = suite.personas.map((p) => `
    <tr>
      <td>${p.personaId}</td>
      <td>${p.label}</td>
      <td>${statusCell(p.layers.functional)}</td>
      <td>${statusCell(p.layers.llm)}</td>
      <td>${statusCell(p.layers.visual)}</td>
      <td>${fmtDuration(p.durationMs)}</td>
    </tr>`).join('')

  const likertGlobal = aggregateLikert(suite.personas)
  const likertHtml = Object.entries(likertGlobal).map(([k, v]) => `<strong>${k}:</strong> ${v.toFixed(1)}`).join(' · ')

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Onboarding suite — ${suite.runId}</title>
  <style>${CSS}</style>
</head>
<body>
<h1>Onboarding Test Suite — ${suite.runId}</h1>
<p><strong>Project:</strong> ${suite.stagingProjectRef} · <strong>Duration:</strong> ${fmtDuration(suite.durationMs)} · <strong>Exit:</strong> ${suite.overallExitCode}</p>
<table class="summary-table">
  <thead><tr><th>Persona</th><th>Label</th><th>Functional</th><th>LLM</th><th>Visual</th><th>Duration</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p>Likert means: ${likertHtml || '—'}</p>
${suite.personas.map((p) => personaSection(p, outputDir)).join('')}
</body>
</html>`

  await writeFile(path.join(outputDir, 'report.html'), html)
}

function aggregateLikert(personas: PersonaRunResult[]): Record<string, number> {
  const sums: Record<string, { total: number; n: number }> = {}
  for (const p of personas) {
    for (const [dim, score] of Object.entries(p.likertMeans)) {
      if (!sums[dim]) sums[dim] = { total: 0, n: 0 }
      sums[dim].total += score
      sums[dim].n += 1
    }
  }
  const out: Record<string, number> = {}
  for (const [dim, v] of Object.entries(sums)) {
    out[dim] = Math.round((v.total / v.n) * 10) / 10
  }
  return out
}

export function printCliSummary(suite: SuiteRunResult): void {
  const lines: string[] = []
  lines.push(`\nOnboarding Test Suite — ${suite.runId}`)
  lines.push('─'.repeat(72))
  lines.push(`Preflight:       ${suite.unitTestsPassed ? '✓' : '✗'} unit tests`)
  lines.push('─'.repeat(72))
  lines.push('Persona'.padEnd(32) + 'Functional  LLM   Visual   Time')
  lines.push('─'.repeat(72))

  for (const p of suite.personas) {
    const row = [
      p.personaId.padEnd(32),
      statusCell(p.layers.functional).padEnd(12),
      statusCell(p.layers.llm).padEnd(6),
      statusCell(p.layers.visual).padEnd(9),
      fmtDuration(p.durationMs),
    ].join('')
    let extra = ''
    if (p.hardRuleFailures.length > 0) extra = `  ← ${p.hardRuleFailures[0]}`
    else if (p.functionalErrors.length > 0) extra = `  ← ${p.functionalErrors[0]}`
    lines.push(row + extra)
  }

  lines.push('─'.repeat(72))
  const likert = aggregateLikert(suite.personas)
  if (Object.keys(likert).length > 0) {
    lines.push('Likert means: ' + Object.entries(likert).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('    '))
  }
  lines.push('─'.repeat(72))
  lines.push(`Report: file://${path.resolve(process.cwd(), 'tests/onboarding/test-output', suite.runId, 'report.html')}`)
  lines.push(`Exit: ${suite.overallExitCode}\n`)

  console.log(lines.join('\n'))
}
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/reporter.ts
git commit -m "feat(onboarding-tests): HTML + JSON + CLI reporter"
```

---

## Task 24: CLI Entry Point

**Files:**
- Create: `cfos-office/tests/onboarding/runner/cli.ts`

- [ ] **Step 1: Write CLI**

Create `cfos-office/tests/onboarding/runner/cli.ts`:

```ts
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { parseArgs } from './args'
import { checkStagingGuard, checkRequiredEnv, loadDotenvLocal } from './preflight'
import { ensureDevServer } from './dev-server'
import { runPersona } from './persona-runner'
import { writeReports, printCliSummary } from './reporter'
import { PERSONAS, getPersona } from '../personas'
import { deleteAllTestUsers, makeAdminClient } from './user-factory'
import type { PersonaRunResult, SuiteRunResult, RunContext } from './types'

const STAGING_PROJECT_REF = 'qlbhvlssksnrhsleadzn'

async function runUnitTests(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['vitest', 'run', 'tests/onboarding/unit'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    proc.on('exit', (code) => resolve(code === 0))
  })
}

async function runInBatches<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

async function main(): Promise<void> {
  // 1. Load env
  await loadDotenvLocal(path.resolve(process.cwd(), '.env.local'))

  // 2. Parse args
  const args = parseArgs(process.argv.slice(2))

  // 3. Preflight
  checkRequiredEnv(process.env)
  checkStagingGuard(process.env.NEXT_PUBLIC_SUPABASE_URL!)

  // 4. Resolve personas
  const toRun = args.personas === null
    ? [...PERSONAS]
    : args.personas.map((id) => {
        const p = getPersona(id)
        if (!p) throw new Error(`Unknown persona: ${id}. Available: ${PERSONAS.map((p) => p.id).join(', ')}`)
        return p
      })

  // 5. Run unit tests
  if (!args.noUnit) {
    const ok = await runUnitTests()
    if (!ok) {
      console.error('Unit tests failed — aborting.')
      process.exit(1)
    }
  }

  // 6. Ensure dev server
  console.log('Ensuring dev server…')
  const server = await ensureDevServer()
  console.log(`Dev server at ${server.url}${server.spawned ? ' (spawned)' : ' (existing)'}`)

  // 7. Output dir
  const runId = args.runId ?? new Date().toISOString().replace(/[:.]/g, '-')
  const outputDir = path.resolve(process.cwd(), 'tests/onboarding/test-output', runId)
  await mkdir(outputDir, { recursive: true })

  const ctx: RunContext = {
    runId,
    outputDir,
    skipJudge: args.skipJudge,
    keepUsers: args.keepUsers,
    devServerUrl: server.url,
  }

  const startedAt = new Date().toISOString()
  const startTs = Date.now()

  let personaResults: PersonaRunResult[] = []
  try {
    console.log(`Running ${toRun.length} persona(s), concurrency ${args.concurrency}…`)
    personaResults = await runInBatches(toRun, args.concurrency, (p) => runPersona(p, ctx))
  } finally {
    if (server.spawned) {
      console.log('Stopping spawned dev server…')
      await server.stop()
    }
    // Safety-net: reap any orphaned test users with this runId
    if (!args.keepUsers) {
      try {
        const admin = makeAdminClient()
        const n = await deleteAllTestUsers(admin, runId)
        if (n > 0) console.log(`Cleaned up ${n} orphaned test user(s).`)
      } catch (e) {
        console.error('Cleanup failed (not fatal):', String(e))
      }
    }
  }

  const finishedAt = new Date().toISOString()
  const durationMs = Date.now() - startTs

  const hasFailures = personaResults.some((p) =>
    p.layers.functional === 'fail' || p.layers.llm === 'fail' || p.layers.visual === 'fail'
  )

  const suite: SuiteRunResult = {
    runId,
    startedAt,
    finishedAt,
    durationMs,
    argsUsed: { ...args },
    stagingProjectRef: STAGING_PROJECT_REF,
    personas: personaResults,
    unitTestsPassed: true,   // would have exited above otherwise
    overallExitCode: hasFailures ? 1 : 0,
  }

  await writeReports(suite, outputDir)
  printCliSummary(suite)
  process.exit(suite.overallExitCode)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office
git add tests/onboarding/runner/cli.ts
git commit -m "feat(onboarding-tests): CLI entry point + orchestration"
```

---

## Task 25: Smoke Test — Single Persona

- [ ] **Step 1: Verify dev server starts correctly**

```bash
cd cfos-office
# Make sure env has CFO Staging vars
cat .env.local | grep -E 'NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|AWS_REGION' | head -3
```

Expected: Staging URL and keys present.

- [ ] **Step 2: Run a single persona (skip-value-map — fastest, no LLM)**

```bash
cd cfos-office
npm run test:onboarding -- --personas skip-value-map --skip-judge --concurrency 1
```

Expected:
- Unit tests run and pass
- Dev server detected or spawned
- skip-value-map persona runs (~60-90s)
- Teardown deletes user
- Report at `tests/onboarding/test-output/<run-id>/report.html`
- Exit code 0 (or non-zero with explanatory errors)

- [ ] **Step 3: Debug as needed**

If the smoke test fails, inspect:
- `tests/onboarding/test-output/<run-id>/skip-value-map/` — screenshots show where it got stuck
- `console-errors.log` for page errors
- The CLI output for the failing beat

Common issues:
- **Selectors don't match:** Check real UI in `src/components/onboarding/beats/` — update `clickAnyOf` selector lists in `playwright-driver.ts`
- **Login page path differs:** Verify `/login` exists (may be `/(auth)/login`)
- **Modal not shown for fresh user:** Check OnboardingModal conditional render path

- [ ] **Step 4: Commit any selector fixes**

```bash
cd cfos-office
git add tests/onboarding/runner/playwright-driver.ts
git commit -m "fix(onboarding-tests): selector adjustments from smoke test"
```

---

## Task 26: Full Suite Dry Run

- [ ] **Step 1: Run with --skip-judge first (faster feedback, verifies functional layer)**

```bash
cd cfos-office
npm run test:onboarding -- --skip-judge --concurrency 2
```

Expected:
- All 8 personas run (~8-12 min)
- Screenshots captured for every beat per persona
- DB state assertions verified
- Report generated

- [ ] **Step 2: Review the report**

```bash
open tests/onboarding/test-output/<latest>/report.html
```

Look for:
- Any persona with functional=fail — triage the specific error
- Any persona with unexpected skipped beats
- Screenshots that look broken (missing avatars, clipped text)

- [ ] **Step 3: Fix any functional bugs found**

These are genuine bugs — document each in a commit message.

- [ ] **Step 4: Run full suite with judge**

```bash
cd cfos-office
npm run test:onboarding
```

Expected:
- Full run ~12-16 min (adds Bedrock judge calls)
- LLM layer status per persona
- Hard-rule failures surface as specific persona bugs (not suite bugs)

- [ ] **Step 5: Triage LLM failures**

Each hard-rule failure is a **finding** — either:
- **A bug in the CFO prompt** (e.g., generated "advice" word — prompt needs tightening)
- **An overly strict persona rule** (e.g., persona requires the word "drift" but the archetype says "drifting" — adjust the rule to `drift|drifting`)

Document findings. Do not auto-fix — the point of this suite is surfacing these.

- [ ] **Step 6: Commit**

```bash
cd cfos-office
git add .
git commit -m "test(onboarding-tests): first full suite run — findings documented"
```

---

## Self-Review Checklist

After implementation, verify:

1. **Spec coverage:**
   - [ ] All 8 personas implemented (Tasks 5-12)
   - [ ] Functional + LLM + Visual layers (Tasks 18-23)
   - [ ] Teardown auto-delete + `--keep-users` flag (Tasks 16, 22, 24)
   - [ ] Production guard (Task 14)
   - [ ] HTML + JSON + CLI reports (Task 23)
   - [ ] CLI flags: --personas, --skip-judge, --keep-users, --concurrency, --no-unit, --run-id (Tasks 13, 24)

2. **Placeholder scan:**
   - [ ] No TBD, TODO, or "add error handling" phrases
   - [ ] Every task has working code, not just descriptions

3. **Type consistency:**
   - [ ] `PersonaRunResult` shape consistent across persona-runner.ts and reporter.ts
   - [ ] `JudgeOutput`, `HardRuleResult`, `LikertResult` names match between judge.ts and types.ts
   - [ ] CSV summary methods (`asText()`) used consistently

4. **Runs end-to-end:**
   - [ ] Smoke test (Task 25) completes
   - [ ] Full run (Task 26) completes and generates a report

---

## After the plan

When all tasks complete, the suite is usable via `npm run test:onboarding`. Future improvements (out of scope):

- Add `--headed` flag to watch runs
- Parallel Playwright contexts within single Node process (true parallelism, not batching)
- Pixel-diff visual regression on a baseline set
- GitHub Action wrapping the CLI for optional CI usage
- Slack webhook for suite summary on completion
- Tracking Likert means in a time-series file for drift detection
