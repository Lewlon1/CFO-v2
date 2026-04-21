# First-Insight Grounding and Actionability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the first-insight narration hallucinating numbers and merchants, and lift the actionability Likert mean from 3.4 to ≥ 4.0, without changing the modal's UX contract.

**Architecture:** Two orthogonal fixes inside `src/app/api/onboarding/generate-insight/route.ts` and `src/lib/ai/context-builder.ts`.

1. **Grounding.** The engine already computes correct numbers and top merchants deterministically in `src/lib/analytics/pattern-detectors.ts`, but the prompt asks the LLM to weave them into free prose. The LLM restates them creatively and invents new ones. We replace "narrate this data" with an explicit **quotable-facts allowlist** of literal strings the LLM must echo verbatim, then add a **post-generation validator** that extracts numbers/merchants from the narrative and falls back to the existing no-narrative path when a violation is detected. This makes "LLM interprets, system computes" (CLAUDE.md rule) enforceable, not aspirational.

2. **Actionability.** The `suggestedResponses` shown as tappable chips come from `payload.suggestedResponses`, assembled in `src/lib/analytics/insight-engine.ts`. They're currently conversation-starters ("Tell me more about that"). Rework them as concrete action-verbs tied to the patterns. When an `experiment` is present, its CTA becomes the first response.

No changes to the UI contract — the API still returns `{ narrative, statCards, suggestedResponses, experiment }`, and the modal renders identically.

**Tech Stack:** Next.js 16 App Router route handler, Vercel AI SDK (`generateText`), Bedrock (Claude Sonnet 4.6), Vitest for unit tests, the existing `tests/onboarding/` persona suite as the integration test.

---

## Context

The onboarding test suite run on 2026-04-21 (`tests/onboarding/test-output/2026-04-21T13-38-49-154Z/`) failed the LLM judge for all 4 personas that completed the flow:

| Persona | Failed rule | Evidence |
|---|---|---|
| builder-classic | R4 numbers_match_csv | narrative cited "86 cents of every euro" for a GBP user; 86 not in CSV |
| fortress-saver | R3b insight_mentions_one_of | narrative never said savings/foundation/stable/buffer despite persona's core trait |
| truth-teller-balanced | R4 numbers_match_csv | numbers 73, 700, 135, 27, 872 cited but not CSV amounts |
| drifter-expat | R3 insight_references_csv_merchants | narrative about subscriptions/Saturday spending never named Glovo or Deliveroo |

Likert means: warmth 4.8, accuracy 3.8, on_brand 4.1, persona_fit 4.0, **actionability 3.4** (weakest). Judge commentary on actionability called suggested responses "conversation starters rather than concrete next steps".

Grep confirmed:
- `payload.currency` IS passed to the context builder (line 38 of `context-builder.ts`), so currency is a correctness issue at the upstream data layer, not a prompt omission.
- There is no post-LLM validation (line 95-98 of `route.ts`): raw text is split into blocks and returned.
- A fallback path already exists (line 114-123) when Bedrock throws. The fix adds a second reason to trigger that path: validation failure.

Run FINDINGS.md already catalogues related bugs #1 (skip-csv orphaning first_insight) and #2 (primary_currency defaulting to EUR); those are adjacent but separate and out of scope here.

---

## File structure

### Modify
- `src/lib/ai/context-builder.ts` (lines 17-120) — replace `### Available data` + `### Patterns to narrate` with quotable-facts blocks. Export a new `buildQuotableFacts(payload)` helper.
- `src/app/api/onboarding/generate-insight/route.ts` — wire in the validator, fall back on violation.
- `src/lib/analytics/insight-engine.ts` — rework `suggestedResponses` assembly to action-form.
- `src/lib/analytics/insight-types.ts` — add `QuotableFact` + `ValidationResult` types.
- `src/lib/analytics/pattern-detectors.ts` — per-pattern `quotable_facts` method (opt-in).

### Create
- `src/lib/ai/insight-validator.ts` — `extractNumbers`, `extractMerchants`, `validateNarrative` pure functions.
- `src/lib/ai/insight-validator.test.ts` — unit tests for the validator.
- `src/lib/ai/__tests__/context-builder-quotable-facts.test.ts` — unit tests for `buildQuotableFacts`.

### Integration test
- `tests/onboarding/` — no new files. The existing `npm run test:onboarding` suite is the integration test.

---

## Task 1: `QuotableFact` and `ValidationResult` types

**Files:**
- Modify: `src/lib/analytics/insight-types.ts`

- [ ] **Step 1: Read the current file end-to-end**

Run: `cat cfos-office/src/lib/analytics/insight-types.ts`
Expected: confirm `Transaction`, `PatternResult`, `InsightPayload`, `StatCard`, `Experiment` types are already defined.

- [ ] **Step 2: Append the two new types to `insight-types.ts`**

```typescript
/**
 * A single fact the LLM is allowed to quote verbatim in the first-insight
 * narrative. `text` is the exact string the LLM must echo. `numbers` is the
 * numeric values inside `text` (so the post-LLM validator can check that any
 * number in the narrative appears in at least one allowed fact). `merchants`
 * is the merchant names similarly checkable.
 */
export type QuotableFact = {
  text: string;
  numbers: number[];
  merchants: string[];
};

/** Result of post-LLM validation. */
export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'numbers_not_allowed' | 'merchants_not_allowed';
      offenders: string[];
    };
```

- [ ] **Step 3: Commit**

```bash
cd cfos-office && git add src/lib/analytics/insight-types.ts
git commit -m "feat(insight): add QuotableFact and ValidationResult types"
```

---

## Task 2: `extractNumbers` helper

**Files:**
- Create: `src/lib/ai/insight-validator.ts`
- Test: `src/lib/ai/insight-validator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cfos-office/src/lib/ai/insight-validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractNumbers } from './insight-validator';

describe('extractNumbers', () => {
  it('extracts integers', () => {
    expect(extractNumbers('You spent 3300 on housing')).toEqual([3300]);
  });

  it('extracts decimals', () => {
    expect(extractNumbers('Gym costs 29.99 a month')).toEqual([29.99]);
  });

  it('ignores commas in thousand separators', () => {
    expect(extractNumbers('£3,300 on housing')).toEqual([3300]);
  });

  it('strips currency symbols', () => {
    expect(extractNumbers('€500 to Vanguard and $20 to coffee')).toEqual([500, 20]);
  });

  it('ignores numbers below 10 (pronouns like "one", "two")', () => {
    expect(extractNumbers('one of five things is that 3300 on rent')).toEqual([3300]);
  });

  it('returns empty for text with no numbers', () => {
    expect(extractNumbers('no numbers here at all')).toEqual([]);
  });

  it('preserves percentage numerators as-is (they are checkable too)', () => {
    expect(extractNumbers('69% of your spend')).toEqual([69]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cfos-office && npm test -- insight-validator`
Expected: FAIL with "Cannot find module ./insight-validator".

- [ ] **Step 3: Write minimal implementation**

Create `cfos-office/src/lib/ai/insight-validator.ts`:

```typescript
/**
 * Extract all numbers >= 10 from a narrative string, for validation against
 * a quotable-facts allowlist. Mirrors the judge's extraction regex so our
 * app-side guard matches the test harness.
 */
export function extractNumbers(text: string): number[] {
  // Strip currency symbols so "£3,300" -> "3,300", "€500" -> "500".
  const cleaned = text.replace(/[£€$¥]/g, '');
  // Match integers and decimals, allowing thousand-separator commas.
  const matches = cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 10);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd cfos-office && npm test -- insight-validator`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
cd cfos-office && git add src/lib/ai/insight-validator.ts src/lib/ai/insight-validator.test.ts
git commit -m "feat(insight): extractNumbers validator helper"
```

---

## Task 3: `extractMerchants` helper

**Files:**
- Modify: `src/lib/ai/insight-validator.ts`
- Test: `src/lib/ai/insight-validator.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

Add to `cfos-office/src/lib/ai/insight-validator.test.ts`:

```typescript
import { extractMerchants } from './insight-validator';

describe('extractMerchants', () => {
  const knownMerchants = ['glovo', 'deliveroo', 'netflix', 'vanguard', 'puregym'];

  it('matches case-insensitively', () => {
    expect(extractMerchants('You spent £18 on Glovo and £22 on Deliveroo.', knownMerchants))
      .toEqual(['glovo', 'deliveroo']);
  });

  it('matches as whole words only', () => {
    // "vanguardian" should not match "vanguard"
    expect(extractMerchants('vanguardian is not vanguard', knownMerchants))
      .toEqual(['vanguard']);
  });

  it('returns each match once even when mentioned multiple times', () => {
    expect(extractMerchants('Netflix. Netflix. Netflix.', knownMerchants))
      .toEqual(['netflix']);
  });

  it('returns empty for no matches', () => {
    expect(extractMerchants('grocery trips and bus fares', knownMerchants))
      .toEqual([]);
  });

  it('handles empty merchant list', () => {
    expect(extractMerchants('anything', [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cfos-office && npm test -- insight-validator`
Expected: FAIL with "extractMerchants is not a function".

- [ ] **Step 3: Append the implementation**

Append to `cfos-office/src/lib/ai/insight-validator.ts`:

```typescript
/**
 * Return the subset of `knownMerchants` that appear as whole-word case-insensitive
 * matches in `text`. The input list is already normalised to lowercase by the
 * caller (the engine produces normalised merchant keys).
 */
export function extractMerchants(text: string, knownMerchants: string[]): string[] {
  if (knownMerchants.length === 0) return [];
  const lowered = text.toLowerCase();
  const seen = new Set<string>();
  for (const m of knownMerchants) {
    const re = new RegExp(`\\b${escapeRegex(m)}\\b`, 'i');
    if (re.test(lowered)) seen.add(m);
  }
  return Array.from(seen);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd cfos-office && npm test -- insight-validator`
Expected: PASS, 12/12 (7 from Task 2 + 5 new).

- [ ] **Step 5: Commit**

```bash
cd cfos-office && git add src/lib/ai/insight-validator.ts src/lib/ai/insight-validator.test.ts
git commit -m "feat(insight): extractMerchants validator helper"
```

---

## Task 4: `validateNarrative` combining function

**Files:**
- Modify: `src/lib/ai/insight-validator.ts`
- Test: `src/lib/ai/insight-validator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `cfos-office/src/lib/ai/insight-validator.test.ts`:

```typescript
import { validateNarrative } from './insight-validator';
import type { QuotableFact } from '@/lib/analytics/insight-types';

describe('validateNarrative', () => {
  const facts: QuotableFact[] = [
    { text: '£3,300 on housing', numbers: [3300], merchants: [] },
    { text: '64% of your spend', numbers: [64], merchants: [] },
    { text: '£500 a month to Vanguard', numbers: [500], merchants: ['vanguard'] },
  ];

  it('passes when narrative only cites allowed numbers and merchants', () => {
    const narrative = 'You put £3,300 on housing and £500 a month to Vanguard. Overall, 64% of your spend went to housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });

  it('fails when narrative cites a number not in any fact', () => {
    const narrative = 'You spent 20 a month on coffee and 3300 on housing.';
    const result = validateNarrative(narrative, facts);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('numbers_not_allowed');
      expect(result.offenders).toContain('20');
    }
  });

  it('fails when narrative names a merchant not in any fact', () => {
    const narrative = 'You subscribe to Netflix and put £500 to Vanguard.';
    const result = validateNarrative(narrative, facts, { knownMerchants: ['netflix', 'vanguard'] });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('merchants_not_allowed');
      expect(result.offenders).toContain('netflix');
    }
  });

  it('ignores the transaction-count context fact when not provided', () => {
    // When knownMerchants is not passed, no merchant check runs.
    const narrative = 'A big number here: 3300 on housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cfos-office && npm test -- insight-validator`
Expected: FAIL with "validateNarrative is not a function".

- [ ] **Step 3: Append the implementation**

Append to `cfos-office/src/lib/ai/insight-validator.ts`:

```typescript
import type { QuotableFact, ValidationResult } from '@/lib/analytics/insight-types';

export type ValidateOptions = {
  /**
   * Whole universe of merchant names present in the user's transactions. The
   * validator rejects any merchant in the narrative that is in this list but
   * NOT in any QuotableFact.merchants. When omitted, merchants are not checked.
   */
  knownMerchants?: string[];
};

export function validateNarrative(
  narrative: string,
  facts: QuotableFact[],
  opts: ValidateOptions = {},
): ValidationResult {
  const allowedNumbers = new Set<number>();
  const allowedMerchants = new Set<string>();
  for (const f of facts) {
    for (const n of f.numbers) allowedNumbers.add(n);
    for (const m of f.merchants) allowedMerchants.add(m.toLowerCase());
  }

  const cited = extractNumbers(narrative);
  const badNumbers = cited.filter((n) => !allowedNumbers.has(n));
  if (badNumbers.length > 0) {
    return {
      ok: false,
      reason: 'numbers_not_allowed',
      offenders: badNumbers.map(String),
    };
  }

  if (opts.knownMerchants && opts.knownMerchants.length > 0) {
    const citedMerchants = extractMerchants(narrative, opts.knownMerchants);
    const badMerchants = citedMerchants.filter((m) => !allowedMerchants.has(m));
    if (badMerchants.length > 0) {
      return {
        ok: false,
        reason: 'merchants_not_allowed',
        offenders: badMerchants,
      };
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd cfos-office && npm test -- insight-validator`
Expected: PASS, 16/16 (12 prior + 4 new).

- [ ] **Step 5: Commit**

```bash
cd cfos-office && git add src/lib/ai/insight-validator.ts src/lib/ai/insight-validator.test.ts
git commit -m "feat(insight): validateNarrative combining function"
```

---

## Task 5: `buildQuotableFacts` in the context builder

**Files:**
- Modify: `src/lib/ai/context-builder.ts`
- Test: `src/lib/ai/__tests__/context-builder-quotable-facts.test.ts`

Each pattern already carries a `data` JSON object with the canonical numbers and merchants. This task adds a helper that converts a `PatternResult` into one or more `QuotableFact` strings the LLM must echo verbatim.

- [ ] **Step 1: Write the failing test**

Create `cfos-office/src/lib/ai/__tests__/context-builder-quotable-facts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildQuotableFacts } from '../context-builder';
import type { InsightPayload } from '@/lib/analytics/insight-types';

const BASE: InsightPayload = {
  userName: 'Test',
  country: 'GB',
  currency: 'GBP',
  monthCount: 3,
  transactionCount: 66,
  hasValueMap: true,
  archetype: 'builder',
  disciplineScore: 80,
  statCards: [
    { label: 'Tracked spend', value: '£5,191', source_pattern_id: 'headline' },
    { label: 'Months', value: '3', source_pattern_id: 'headline' },
    { label: 'Largest category', value: 'Housing', source_pattern_id: 'headline' },
  ],
  layers: {
    headline: {
      id: 'housing_dominant',
      score: 90,
      layer: 'headline',
      data: { category: 'Housing', total: 3300, pct: 64, currency: 'GBP' },
      narrative_prompt: 'Open with the housing figure.',
    },
  },
  hook: { prompt_for_claude: '' },
  suggestedResponses: [],
};

describe('buildQuotableFacts', () => {
  it('emits a money fact with the user currency, not EUR by default', () => {
    const facts = buildQuotableFacts(BASE);
    const money = facts.find((f) => f.text.includes('£3,300'));
    expect(money).toBeDefined();
    expect(money?.numbers).toContain(3300);
  });

  it('emits a percentage fact for share-of-spend', () => {
    const facts = buildQuotableFacts(BASE);
    const pct = facts.find((f) => f.text.includes('64%'));
    expect(pct).toBeDefined();
    expect(pct?.numbers).toContain(64);
  });

  it('never omits the transaction count as a quotable fact', () => {
    const facts = buildQuotableFacts(BASE);
    const tc = facts.find((f) => f.numbers.includes(66));
    expect(tc).toBeDefined();
  });

  it('uses the correct currency symbol for EUR users', () => {
    const euro = { ...BASE, currency: 'EUR' as const };
    const facts = buildQuotableFacts(euro);
    expect(facts.some((f) => f.text.includes('€3,300'))).toBe(true);
    expect(facts.every((f) => !f.text.includes('£'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cfos-office && npm test -- context-builder-quotable-facts`
Expected: FAIL with "buildQuotableFacts is not a function" or similar.

- [ ] **Step 3: Add `buildQuotableFacts` to `context-builder.ts`**

Add these imports at the top of `cfos-office/src/lib/ai/context-builder.ts`:

```typescript
import type { InsightPayload, QuotableFact, PatternResult } from '@/lib/analytics/insight-types';
```

(Remove the duplicate `import type { InsightPayload }` from line 7.)

Add above `buildFirstInsightContext`:

```typescript
function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'GBP': return '£';
    case 'EUR': return '€';
    case 'USD': return '$';
    default: return currency + ' ';
  }
}

function formatMoney(amount: number, currency: string): string {
  const sym = currencySymbol(currency);
  const rounded = Number.isInteger(amount) ? amount : Math.round(amount * 100) / 100;
  const hasCents = !Number.isInteger(rounded);
  return `${sym}${rounded.toLocaleString('en-GB', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

/**
 * Turn a `PatternResult` into one or more QuotableFact entries. Each fact is
 * a literal string the LLM must echo verbatim in the narrative. The validator
 * later checks every number and merchant in the narrative appears in at least
 * one fact's `numbers` / `merchants`.
 *
 * The pattern's `data` shape is heterogeneous by design (each detector writes
 * its own keys), so this function pattern-matches on known keys and produces
 * canonical facts for each one.
 */
function factsFromPattern(pattern: PatternResult, currency: string): QuotableFact[] {
  const facts: QuotableFact[] = [];
  const data = pattern.data as Record<string, unknown>;

  if (typeof data.total === 'number' && typeof data.category === 'string') {
    facts.push({
      text: `${formatMoney(data.total, currency)} on ${data.category.toLowerCase()}`,
      numbers: [Math.round(data.total)],
      merchants: [],
    });
  }

  if (typeof data.pct === 'number') {
    facts.push({
      text: `${Math.round(data.pct)}% of your spend`,
      numbers: [Math.round(data.pct)],
      merchants: [],
    });
  }

  if (typeof data.topMerchant === 'string' && typeof data.topMerchantAmount === 'number') {
    facts.push({
      text: `${formatMoney(data.topMerchantAmount, currency)} to ${data.topMerchant}`,
      numbers: [Math.round(data.topMerchantAmount)],
      merchants: [data.topMerchant.toLowerCase()],
    });
  }

  if (Array.isArray(data.topMerchants)) {
    for (const m of data.topMerchants) {
      if (m && typeof m === 'object' && 'name' in m && 'total' in m) {
        const name = String((m as { name: unknown }).name).toLowerCase();
        const total = Number((m as { total: unknown }).total);
        if (Number.isFinite(total)) {
          facts.push({
            text: `${formatMoney(total, currency)} to ${name}`,
            numbers: [Math.round(total)],
            merchants: [name],
          });
        }
      }
    }
  }

  if (typeof data.avgTrip === 'number') {
    facts.push({
      text: `around ${formatMoney(data.avgTrip, currency)} each time`,
      numbers: [Math.round(data.avgTrip)],
      merchants: [],
    });
  }

  if (typeof data.storeCount === 'number' && data.storeCount >= 10) {
    facts.push({
      text: `${data.storeCount} different places`,
      numbers: [data.storeCount],
      merchants: [],
    });
  }

  return facts;
}

export function buildQuotableFacts(payload: InsightPayload): QuotableFact[] {
  const facts: QuotableFact[] = [];

  // Transaction count is always quotable — frequently cited as "I went through
  // all 66 of your transactions" etc.
  facts.push({
    text: `${payload.transactionCount} transactions`,
    numbers: [payload.transactionCount],
    merchants: [],
  });

  // Stat card values are already formatted correctly by the engine; we trust them
  // verbatim. Extract numeric components for validation.
  for (const card of payload.statCards) {
    const numbers = Array.from(
      card.value.matchAll(/\d[\d,]*(?:\.\d+)?/g),
    ).map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n >= 10);
    facts.push({ text: card.value, numbers, merchants: [] });
  }

  // Per-pattern canonical facts
  for (const layer of ['headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook'] as const) {
    const pattern = payload.layers[layer];
    if (!pattern) continue;
    facts.push(...factsFromPattern(pattern, payload.currency));
  }

  // Experiment savings bands — the existing EXPERIMENT RULES already tell the
  // LLM to quote these verbatim; we register them as quotable so the validator
  // doesn't reject them.
  const experiment = payload.layers.action?.experiment;
  if (experiment) {
    facts.push({
      text: `${formatMoney(experiment.monthly_saving_low, experiment.currency)}–${formatMoney(experiment.monthly_saving_high, experiment.currency)} a month`,
      numbers: [Math.round(experiment.monthly_saving_low), Math.round(experiment.monthly_saving_high)],
      merchants: [],
    });
    facts.push({
      text: `${formatMoney(experiment.annual_saving_low, experiment.currency)}–${formatMoney(experiment.annual_saving_high, experiment.currency)} a year`,
      numbers: [Math.round(experiment.annual_saving_low), Math.round(experiment.annual_saving_high)],
      merchants: [],
    });
  }

  return facts;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd cfos-office && npm test -- context-builder-quotable-facts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
cd cfos-office && git add src/lib/ai/context-builder.ts src/lib/ai/__tests__/context-builder-quotable-facts.test.ts
git commit -m "feat(insight): buildQuotableFacts — canonical quotable strings per pattern"
```

---

## Task 6: Inject quotable facts into the prompt

**Files:**
- Modify: `src/lib/ai/context-builder.ts`

The existing `buildFirstInsightContext` lists pattern data as loose JSON. Replace the narration instructions with an explicit quotable-facts block and strong grounding rules.

- [ ] **Step 1: Replace lines 53-68 of `buildFirstInsightContext`**

Current (lines 53-68 of `cfos-office/src/lib/ai/context-builder.ts`):

```typescript
  lines.push('### Patterns to narrate (in this order)');
  const layerOrder = ['headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook'] as const;
  const seenPatternIds = new Set<string>();
  for (const layer of layerOrder) {
    const pattern = payload.layers[layer];
    if (!pattern) continue;
    if (seenPatternIds.has(pattern.id) && layer === 'action') continue;
    seenPatternIds.add(pattern.id);
    lines.push('');
    lines.push(`#### ${layer.toUpperCase()}`);
    lines.push(`Pattern: ${pattern.id}`);
    lines.push(`Data: ${JSON.stringify(pattern.data)}`);
    lines.push(`Instruction: ${pattern.narrative_prompt}`);
  }
```

Replace with:

```typescript
  // Quotable facts — the ONLY strings containing numbers or merchant names
  // the LLM is permitted to cite. The post-LLM validator rejects narratives
  // containing any other number >= 10 or any other merchant name.
  const quotableFacts = buildQuotableFacts(payload);
  lines.push('### QUOTABLE FACTS — the only numbers/merchants you may cite');
  lines.push('Each line is a phrase you may echo verbatim in your narrative.');
  lines.push('You may NOT cite any other number >= 10 or any other merchant name.');
  lines.push('If you want to mention a figure that is not listed here, rephrase without the figure.');
  for (const f of quotableFacts) {
    lines.push(`- "${f.text}"`);
  }
  lines.push('');

  lines.push('### Patterns to narrate (in this order)');
  lines.push('For each pattern below, follow the instruction. Weave the quotable facts above into prose.');
  const layerOrder = ['headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook'] as const;
  const seenPatternIds = new Set<string>();
  for (const layer of layerOrder) {
    const pattern = payload.layers[layer];
    if (!pattern) continue;
    if (seenPatternIds.has(pattern.id) && layer === 'action') continue;
    seenPatternIds.add(pattern.id);
    lines.push('');
    lines.push(`#### ${layer.toUpperCase()}`);
    lines.push(`Pattern: ${pattern.id}`);
    lines.push(`Instruction: ${pattern.narrative_prompt}`);
  }
```

- [ ] **Step 2: Run the existing tests to confirm the context builder still works**

Run: `cd cfos-office && npm test`
Expected: existing 58 tests + 4 new quotable-facts tests = 62/62 passing.

- [ ] **Step 3: Run the build to confirm no type errors**

Run: `cd cfos-office && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd cfos-office && git add src/lib/ai/context-builder.ts
git commit -m "feat(insight): inject quotable-facts allowlist into first-insight prompt"
```

---

## Task 7: Wire the validator into the route handler

**Files:**
- Modify: `src/app/api/onboarding/generate-insight/route.ts`

When validation fails, we log and fall through to the existing no-narrative fallback (`statCards + suggestedResponses` only). We do NOT regenerate — regeneration adds latency and often hits the same hallucination a second time. Graceful degradation is the right move.

- [ ] **Step 1: Read the current route to plan the insert**

Run: `cat cfos-office/src/app/api/onboarding/generate-insight/route.ts | head -125`
Expected: confirm current structure lines 95-123.

- [ ] **Step 2: Replace lines 95-111 with validator-gated branching**

Current (lines 95-111):

```typescript
    const text = result.text
    const statCards = parseStats(text)
    const suggestedResponses = parseOptions(text)
    const narrative = stripBlocks(text)

    return NextResponse.json({
      insight: {
        narrative,
        statCards:
          statCards.length > 0
            ? statCards
            : payload.statCards.map((c) => ({ ...c })),
        suggestedResponses:
          suggestedResponses.length > 0 ? suggestedResponses : payload.suggestedResponses,
        experiment: payload.layers.action?.experiment,
      },
    })
```

Replace with:

```typescript
    const text = result.text
    const statCards = parseStats(text)
    const suggestedResponses = parseOptions(text)
    const narrative = stripBlocks(text)

    // Post-generation grounding check. Compare numbers/merchants in the narrative
    // against the quotable-facts allowlist. On violation, log and return the
    // deterministic fallback (no narrative) — graceful degradation keeps the
    // UX working even when the model ignores grounding guardrails.
    const facts = buildQuotableFacts(payload)
    const knownMerchants = collectKnownMerchants(payload)
    const validation = validateNarrative(narrative, facts, { knownMerchants })

    if (!validation.ok) {
      console.error(
        '[generate-insight] narrative rejected by validator:',
        validation.reason,
        'offenders:', validation.offenders,
      )
      return NextResponse.json({
        insight: {
          narrative: '',
          statCards: payload.statCards,
          suggestedResponses: payload.suggestedResponses,
          experiment: payload.layers.action?.experiment,
        },
        validation: { ok: false, reason: validation.reason },
      })
    }

    return NextResponse.json({
      insight: {
        narrative,
        statCards:
          statCards.length > 0
            ? statCards
            : payload.statCards.map((c) => ({ ...c })),
        suggestedResponses:
          suggestedResponses.length > 0 ? suggestedResponses : payload.suggestedResponses,
        experiment: payload.layers.action?.experiment,
      },
    })
```

- [ ] **Step 3: Update imports at the top of the file**

Change line 8 from:

```typescript
import type { StatCard } from '@/lib/analytics/insight-types'
```

to:

```typescript
import type { StatCard, InsightPayload } from '@/lib/analytics/insight-types'
import { buildQuotableFacts } from '@/lib/ai/context-builder'
import { validateNarrative } from '@/lib/ai/insight-validator'
```

- [ ] **Step 4: Add the `collectKnownMerchants` helper above the `POST` function**

```typescript
function collectKnownMerchants(payload: InsightPayload): string[] {
  const merchants = new Set<string>()
  for (const layer of ['headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook'] as const) {
    const pattern = payload.layers[layer]
    if (!pattern) continue
    const data = pattern.data as Record<string, unknown>
    if (typeof data.topMerchant === 'string') merchants.add(data.topMerchant.toLowerCase())
    if (Array.isArray(data.topMerchants)) {
      for (const m of data.topMerchants) {
        if (m && typeof m === 'object' && 'name' in m) {
          merchants.add(String((m as { name: unknown }).name).toLowerCase())
        }
      }
    }
  }
  return Array.from(merchants)
}
```

- [ ] **Step 5: Run the build to confirm no type errors**

Run: `cd cfos-office && npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
cd cfos-office && git add src/app/api/onboarding/generate-insight/route.ts
git commit -m "feat(insight): validator-gated narrative with graceful fallback"
```

---

## Task 8: Rework `suggestedResponses` into action-verbs

**Files:**
- Modify: `src/lib/analytics/insight-engine.ts`

`buildSuggestedResponses(layers, hook)` already exists in `insight-engine.ts` (line 271). Its current body pushes `'Tell me more about that'`, `'Why does that matter?'`, `'What should I do about it?'` — conversation-starters, flagged by the judge on every persona. Replace the body with action-verbs tied to actual pattern IDs: `category_concentration`, `merchant_fragmentation`, `day_of_week_skew`, `recurring_expense_total`, `spending_velocity`, `convenience_vs_planned`. When an `experiment` is present on the action layer, its CTA leads.

- [ ] **Step 1: Read the current function (lines 271-289)**

Run: `sed -n '271,289p' cfos-office/src/lib/analytics/insight-engine.ts`
Expected: confirm the signature `buildSuggestedResponses(layers: InsightPayload['layers'], hook: Hook): string[]` and the three conversation-starter pushes.

- [ ] **Step 2: Replace the function body**

In `cfos-office/src/lib/analytics/insight-engine.ts` at line 271, replace the entire function body (opening `{` to closing `}`) with:

```typescript
function buildSuggestedResponses(
  layers: InsightPayload['layers'],
  hook: Hook
): string[] {
  const out: string[] = [];

  // 1. Experiment CTA leads when present — it's the most concrete action.
  const experiment = layers.action?.experiment;
  if (experiment) {
    switch (experiment.template_kind) {
      case 'grocery_consolidation':
        out.push('Draft my weekly grocery list');
        break;
      case 'subscription_audit':
        out.push('Show me every active subscription');
        break;
      case 'bill_switch':
        out.push('Find me a better deal');
        break;
      default:
        out.push('Set up this experiment');
    }
  }

  // 2. Pattern-specific drill-down action. Each maps to a concrete task the
  // chat can execute, not a conversation starter.
  const headline = layers.headline;
  const hidden = layers.hidden_pattern;
  const drillSource = headline ?? hidden;
  if (drillSource?.id === 'category_concentration') {
    const cat = (drillSource.data as { topCategory?: string }).topCategory;
    out.push(cat ? `Break down my ${cat.toLowerCase()}` : 'Break down my top category');
  } else if (drillSource?.id === 'merchant_fragmentation') {
    out.push('List my top merchants by spend');
  } else if (drillSource?.id === 'day_of_week_skew') {
    out.push('Show me what I spent last Saturday');
  } else if (drillSource?.id === 'recurring_expense_total') {
    out.push('List every recurring charge');
  } else if (drillSource?.id === 'spending_velocity') {
    out.push('Show my weekly spending pace');
  } else if (drillSource?.id === 'convenience_vs_planned') {
    out.push('Show me my convenience spending');
  } else if (drillSource) {
    out.push('Show me the full breakdown');
  }

  // 3. Hook's own suggested response stays (it's the narrative's closing action).
  // Kept last so experiment + pattern action are the top two tappable chips.
  if (hook.suggested_response) out.push(hook.suggested_response);

  // Dedupe and cap at 3.
  return Array.from(new Set(out)).slice(0, 3);
}
```

- [ ] **Step 3: Run the build**

Run: `cd cfos-office && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Run tests**

Run: `cd cfos-office && npm test`
Expected: all existing + new tests pass.

- [ ] **Step 5: Commit**

```bash
cd cfos-office && git add src/lib/analytics/insight-engine.ts
git commit -m "feat(insight): action-verb suggestedResponses with experiment CTA lead"
```

---

## Task 9: Full persona-suite validation

**Files:**
- None modified. This is the integration test.

- [ ] **Step 1: Run the full onboarding suite**

Run: `cd cfos-office && npm run test:onboarding`
Expected: ~7-15 minutes wall clock. Output `Onboarding Test Suite` table with each persona's functional/LLM/visual status.

- [ ] **Step 2: Verify the 4 previously-failing personas now pass the LLM layer**

Expected changes vs baseline (2026-04-21T13-38-49-154Z):
- `builder-classic` LLM layer: FAIL (R4) → **PASS**
- `fortress-saver` LLM layer: FAIL (R3b) → **PASS**
- `truth-teller-balanced` LLM layer: FAIL (R4) → **PASS**
- `drifter-expat` LLM layer: FAIL (R3) → **PASS**

If any of the 4 still fails:
- Read the relevant persona's `captured/insight.json` in the new test-output dir.
- Confirm whether it's a new offender (e.g. a computed number not yet in quotable-facts — if so, add the mapping to `factsFromPattern`) or a fundamentally different failure mode (rare).
- Do NOT weaken the validator; extend `buildQuotableFacts` to cover the legitimate missing fact.

- [ ] **Step 3: Verify the Likert actionability mean improved**

Expected changes vs baseline:
- actionability mean: 3.4 → **≥ 4.0** (target; stretch 4.2).
- Other dimensions unchanged or improved; none regress below baseline minus 0.2.

If actionability did NOT reach ≥ 4.0:
- Read one persona's `captured/` judge commentary about actionability.
- The action responses may need more specificity (e.g. naming a specific merchant) — adjust `buildSuggestedResponses` mappings and re-run.

- [ ] **Step 4: Note the new run-id in FINDINGS.md**

Append to `cfos-office/tests/onboarding/FINDINGS.md`:

```markdown
## 2026-04-21 — Grounding + actionability fix

Run: `tests/onboarding/test-output/<new-run-id>/report.html`

- Validator-gated narrative landed. Builder/Fortress/Truth-teller/Drifter personas now pass R3/R3b/R4.
- Actionability Likert mean: 3.4 → <new mean>. Other dimensions: <list>.
- Observed false-fallbacks: <count — times the validator triggered graceful fallback in the 8 personas>.
```

- [ ] **Step 5: Commit**

```bash
cd cfos-office && git add cfos-office/tests/onboarding/FINDINGS.md
git commit -m "docs(onboarding-tests): 2026-04-21 grounding + actionability fix results"
```

---

## Task 10: FINDINGS.md — register the hallucination as a fixed bug

**Files:**
- Modify: `cfos-office/tests/onboarding/FINDINGS.md`

The smoke-run FINDINGS.md already has "Bugs to investigate" entries 1–3. This fix resolves a new entry (#4) that was surfaced by the LLM judge, not the smoke. Document it for the record.

- [ ] **Step 1: Insert a new bug entry**

Insert after the existing bug #3 in `cfos-office/tests/onboarding/FINDINGS.md`:

```markdown
### 4. First-insight narration hallucinated numbers and merchants

**Surfaced by:** 2026-04-21 full suite run. All 4 completed personas failed R3/R3b/R4.

**What happened:** The LLM was asked to weave patterns into free prose, including numbers and merchant names, under guardrails that said "every number must appear in the data below". It did not comply — it rephrased 64% housing share as "86 cents of every euro" for a GBP user, cited £29.99 gym as "€20/month", invented merchant names, and skipped required merchants (Glovo/Deliveroo) in favour of more readable prose.

**Why it happened:** The prompt gave Claude the pattern JSON and said "narrate this". With 0.7 temperature and Sonnet's strong prose bias, that became a licence to paraphrase. The "LLM interprets, system computes" architectural rule was not mechanically enforced.

**Fix:** `docs/superpowers/plans/2026-04-21-first-insight-grounding-and-actionability.md` — quotable-facts allowlist + post-LLM validator with graceful fallback.

**Status:** Fixed on 2026-04-21 (see Task 9 run-id).
```

- [ ] **Step 2: Commit**

```bash
cd cfos-office && git add tests/onboarding/FINDINGS.md
git commit -m "docs(findings): register hallucination fix as bug #4"
```

---

## Out of scope

- **Currency default bug #2** (UK users default to EUR in `user_profiles`) — adjacent but separate. Fix in its own branch.
- **Sign-in redirect timeout** in 4 personas — Playwright driver issue, not a product bug. Fix in the test suite, not the app.
- **Judge's R4 rule for percentages** — the judge extracts "69" from "69%" and checks against CSV amounts. The judge is slightly too strict: percentages are legitimate derived figures. Out of scope here; a separate improvement to `tests/onboarding/runner/judge.ts` can recognise `\d+%` as a percentage and validate against computed pattern data rather than CSV amounts.
- **Regeneration on validation failure** — considered and rejected. Adds latency, often hits the same hallucination, and the fallback path (deterministic stat cards + action responses, no narrative) is already a reasonable user experience. Revisit if telemetry shows >20% of users land on the fallback path in production.
- **Structured output via Zod schema** (`generateObject` with `{narrative, cited_facts[]}`) — bigger change; considered for a follow-up if the allowlist approach proves insufficient.

## Verification summary

After completing all 10 tasks:
- `npm test` → all unit tests pass (58 existing + ~16 new).
- `npm run build` → succeeds.
- `npm run lint` → no new errors or warnings.
- `npm run test:onboarding` → 4 personas that completed the flow now pass the LLM judge. Actionability Likert mean ≥ 4.0.
- `FINDINGS.md` → bug #4 registered + 2026-04-21 run results noted.

The change is strictly additive at the prompt layer (new quotable-facts block) and validator layer (new post-LLM check). The API response shape is unchanged. The UI contract is unchanged. If the validator misfires, the graceful fallback (`narrative: ''`) has been exercised by the existing error-path (line 114-123 in the original route) — the modal already handles an empty narrative.
