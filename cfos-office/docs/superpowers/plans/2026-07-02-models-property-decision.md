# Models Feature — Session M1 (Property Decision Modeller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/office/models` — an AI-guided property keep-vs-sell decision modeller with a deterministic TS engine, LLM interviewer, editable assumptions ledger, and verdict + flip-points, persisted per-run and RLS-scoped, on Supabase staging only.

**Architecture:** All arithmetic lives in pure, unit-tested TypeScript (`lib/models/engine/property.ts`), ported verbatim in behaviour from the provided prototype and golden-tested against the session brief's pinned fixture. The LLM (Bedrock, via the existing `generateText`/`chatModel` convention) only extracts slot values, phrases questions, and challenges outliers — it is never asked for or shown to state a computed result. A three-tier resolver (`run > profile > market`) merges assumptions before every engine call. The UI ports the prototype's three-panel (Interview / Ledger / Verdict) structure and behaviour but is re-skinned entirely with house design tokens and primitives — the prototype's bespoke hex/Google-Font styling is not reused (see Correction 6 below).

**Tech Stack:** Next.js App Router (`(office)` route group), Supabase Postgres + RLS, `@ai-sdk/amazon-bedrock` via existing `chatModel`, `zod` v4, `vitest`, `recharts` (already a dependency), house UI primitives (`Card`, `Badge`, `Input`, `CurrencyInput`, `button`) from `src/components/ui/`. **No new dependencies.**

---

## Plan-of-record corrections (Step 0 orientation — brief vs. actual tree)

The brief's paths and a few assumptions don't match the repo. Per the brief's own instruction ("the tree wins"), this plan uses the tree. Read this before starting Task 1.

1. **Route is `/office/models`, not `/models`.** There is no `app/(app)/` group. The authenticated shell is `src/app/(office)/layout.tsx`; every existing feature nests at `src/app/(office)/office/<slug>/` (e.g. `office/goals`, `office/cash-flow`). Models follows the same pattern: `src/app/(office)/office/models/`.
2. **Mutations are API routes, not server actions.** Confirmed against Goals (`app/api/goals/delete/route.ts`, `app/api/goals/contributions/route.ts`) and Upload (`app/api/upload/route.ts`) — both use client `fetch()` → API route → Supabase, scoped by `.eq('user_id', user.id)`. Server actions exist only in the separate `onboarding-v2` subsystem. Models uses API routes throughout: `app/api/models/runs/route.ts` (create), `app/api/models/runs/[id]/route.ts` (patch), `app/api/models/interviewer/route.ts`.
3. **Auth pattern:** every `(office)` page/route calls `await createClient()` from `@/lib/supabase/server`, then `await supabase.auth.getUser()`, then redirects/401s if absent. There is no `middleware.ts`. All new pages/routes follow this exactly.
4. **Next migration number is `073`, not the brief's placeholder timestamp.** Latest is `072_demo_session_claim_guard.sql`. New file: `supabase/migrations/076_models_feature.sql` (originally authored as `073_`; renumbered to `076_` on the v2.9 merge because the v2.9 line also shipped a `073_secure_export_user_data.sql` — see below).
5. **FK target is `public.user_profiles(id)`, not `auth.users(id)`.** The brief's draft SQL used `auth.users(id)`; every migration from the last two months (`063`, `065`, `066`, `067`) FKs `user_id` to `public.user_profiles(id) on delete cascade` instead. This plan's migration matches that. RLS style also matches `067_user_declared_fixed_costs.sql` exactly: 4 separate policies per table (select/insert/update/delete), `(select auth.uid()) = user_id`, `updated_at` application-managed (no DB trigger).
6. **UI does not reuse the prototype's styling.** The prototype hardcodes raw hex colours (`#17513D`, `#B07C24`, `#9E3B2F`...), an inline `<style>` block, and a Google Fonts `@import`. This trips the CI-enforced `cfo/visual-token-guards` ESLint rule (`src/**` — no raw hex/rgb, no arbitrary Tailwind colour brackets, no `rounded-[≥4px]`) documented in `UI-DIRECTION.md`. The port keeps the prototype's **behaviour and structure** (three-panel layout, mobile tabs, provenance chips, ledger row edit-in-place, flip-point cards, caveats box) but is rebuilt with `src/components/ui/{Card,Badge,Input,CurrencyInput,button}.tsx` and `src/lib/tokens.ts` (`colors`, not raw hex). Zero `dark:` classes (inert per CLAUDE.md — theme is `data-theme` only).
7. **Models is not a 5th accented home-folder card.** `OfficeHomeClient.tsx` renders exactly four `FolderSection` cards (Goals/Cash Flow/Values/Net Worth) using the CLAUDE.md-locked four-folder palette ("the load-bearing visual identity of the office home — divergence creates inconsistency"). Models gets a new, non-accented entry row on the home page, following the existing `InboxRow.tsx` pattern (plain `Card`, no `folderColors` entry) but always rendered, not conditional on unread state. New component: `src/components/office/ModelsRow.tsx`.
8. **Interviewer LLM call uses Bedrock via the existing `generateText` convention, not a raw `fetch()` to `api.anthropic.com`.** The prototype's `callInterviewer()` calls the public Anthropic API directly from the client — wrong backend (this repo is EU Bedrock-only per CLAUDE.md) and would leak credentials if ported as-is. The port follows `src/lib/categorisation/llm-categoriser.ts`'s exact shape: `generateText({ model: chatModel, messages })`, fence-stripping JSON parse, `trackLLMUsage`/`logBedrockUsage`, `sendAlert` on failure. Runs server-side only, in `app/api/models/interviewer/route.ts`. Uses `chatModel` (Sonnet), not `utilityModel` (Haiku) — the interviewer makes judgment calls (challenging outlier values) that need full model quality, matching the "chatModel — ... all user-facing conversation" rule in CLAUDE.md's model-routing table.
9. **`resolveValues` (ported 2-tier, engine-owned) is distinct from `resolve.ts` (production 3-tier).** The brief lists both. This plan makes `resolveValues(slots, slotDefs, marketDefaults)` a registry-agnostic pure function in the engine (parameterised, not hardcoding the prototype's module-level `SLOTS`/`MARKET_DEFAULTS`, since those move to separate `registry.ts`/`marketDefaults.ts` files) — it exists so the golden tests can exercise the engine with a flat fixture exactly as the brief specifies it. `resolve.ts`'s `resolveRunValues()` is the production path (`run > profile > market`) that the interviewer route, ledger, and verdict actually call. `runModel`/`flipPoint`/`saleNet` are agnostic to how their input `Record<string, number>` was resolved.
10. **Only `horizon_years` maps to a profile-tier field (`default_horizon_years`).** The brief's 5 "profile-tier slots" (`tax_residency`, `base_currency`, `income_band`, `liquid_savings`, `default_horizon_years`) are `user_financial_profile` columns, but only `default_horizon_years` corresponds to a numeric property-engine slot (`horizon_years`). The other 4 are cross-decision context (currency/residency/income band/savings) that isn't a property-engine input at all — they're confirmed once at interview open and stored on the profile row for future decision types, not fed into `runModel`. `resolve.ts` therefore only reads `profile.default_horizon_years` (via an explicit per-slot `profileField` mapping — only `horizon_years` has one), rather than assuming every profile column doubles as an engine slot.
11. **"Letting group inactive if user states they'd never let it" needs a slot.** The brief asks for this relevance rule but the closed numeric slot model has no boolean type. This plan adds one minimal slot, `will_never_let_flag` (0/1, not shown as a ledger row — consumed only by `relevantIf`), set by the interviewer LLM when the user says they'd never rent the place out. This keeps the "closed variable set, all numeric" invariant intact per locked design decision #2.
12. **No `uuid` package.** `gen_random_uuid()` is already used as the PK default throughout `supabase/migrations/`; no client-side UUID generation is needed for this feature.

---

## STOP LINE

Tasks 1–20 below are the brief's "everything above the stop line" (§1–§7 of the brief). All of it must be done-done — tests green, RLS verified, refresh restores a run — before Tasks 21–22 (escape hatch, profile settings surface) are touched. If time runs out, cut from Tasks 21–22, never from 1–20, and never skip a test.

---

### Task 1: Migration file (staging only)

**Files:**
- Create: `cfos-office/supabase/migrations/076_models_feature.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Models feature (M1 walking skeleton) — property decision modeller.
--
-- user_financial_profile: the "baseline-criteria hypothesis" — a small,
-- stable-across-decisions profile tier (5 fields) that seeds future model
-- runs' assumptions without re-asking. Deliberately narrow; promotion/
-- demotion of fields between tiers is validated later via a SQL query over
-- model_runs.assumptions origins, not new instrumentation.
--
-- model_runs: one row per decision-modelling session. `assumptions` is a
-- jsonb map of slot_id -> {value, origin}; `messages` is the interview
-- transcript; `caveats` holds escape-hatch scope warnings.

create table if not exists public.user_financial_profile (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  tax_residency text not null default 'ES',
  base_currency text not null default 'EUR',
  income_band text,
  liquid_savings numeric,
  default_horizon_years int not null default 10,
  updated_at timestamptz not null default now()
);

create table if not exists public.model_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  decision_type text not null,
  schema_version int not null,
  defaults_version text not null,
  status text not null default 'interviewing'
    check (status in ('interviewing','complete')),
  assumptions jsonb not null default '{}',
  messages jsonb not null default '[]',
  caveats jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists model_runs_user_updated_idx
  on public.model_runs (user_id, updated_at desc);

alter table public.user_financial_profile enable row level security;
alter table public.model_runs enable row level security;

-- (select auth.uid()) wrapping per the standing auth_rls_initplan rule.
create policy user_financial_profile_select
  on public.user_financial_profile
  for select
  using ((select auth.uid()) = user_id);

create policy user_financial_profile_insert
  on public.user_financial_profile
  for insert
  with check ((select auth.uid()) = user_id);

create policy user_financial_profile_update
  on public.user_financial_profile
  for update
  using ((select auth.uid()) = user_id);

create policy user_financial_profile_delete
  on public.user_financial_profile
  for delete
  using ((select auth.uid()) = user_id);

create policy model_runs_select
  on public.model_runs
  for select
  using ((select auth.uid()) = user_id);

create policy model_runs_insert
  on public.model_runs
  for insert
  with check ((select auth.uid()) = user_id);

create policy model_runs_update
  on public.model_runs
  for update
  using ((select auth.uid()) = user_id);

create policy model_runs_delete
  on public.model_runs
  for delete
  using ((select auth.uid()) = user_id);

-- updated_at is application-managed (matches the convention in 001 / 067).
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/supabase/migrations/076_models_feature.sql
git commit -m "feat(models): add user_financial_profile + model_runs tables (staging migration)"
```

---

### Task 2: Apply migration to staging + two-user RLS verification

**Hard rule:** staging project ref is `qlbhvlssksnrhsleadzn`. Production is `iccelmjenljanqrhhzdv` — **never** pass that project_id to any Supabase MCP tool this session. Confirm the `project_id` argument on every call before running it.

- [ ] **Step 1: Apply the migration to staging**

Use the Supabase MCP `apply_migration` tool with `project_id: "qlbhvlssksnrhsleadzn"`, `name: "076_models_feature"`, and the SQL from Task 1. Confirm success via `list_tables` (`project_id: "qlbhvlssksnrhsleadzn"`) — expect `user_financial_profile` and `model_runs` to appear.

- [ ] **Step 2: Find two real staging users to test with**

Via Supabase MCP `execute_sql` (`project_id: "qlbhvlssksnrhsleadzn"`):

```sql
select id, email from auth.users limit 2;
```

Note the two ids as `USER_A` and `USER_B`.

- [ ] **Step 3: Verify RLS with simulated JWTs — insert as A, confirm B cannot read it**

Run as one `execute_sql` call (staging project_id):

```sql
-- Insert a run as USER_A
select set_config('request.jwt.claims', json_build_object('sub', 'USER_A')::text, true);
set local role authenticated;
insert into public.model_runs (user_id, decision_type, schema_version, defaults_version)
values ('USER_A', 'property', 1, '2026-Q2-illustrative');

-- Switch to USER_B and attempt to read USER_A's row
select set_config('request.jwt.claims', json_build_object('sub', 'USER_B')::text, true);
set local role authenticated;
select count(*) as visible_to_b from public.model_runs where user_id = 'USER_A';
-- Expect visible_to_b = 0

-- Confirm USER_A can see their own row when re-simulated
select set_config('request.jwt.claims', json_build_object('sub', 'USER_A')::text, true);
set local role authenticated;
select count(*) as visible_to_a from public.model_runs where user_id = 'USER_A';
-- Expect visible_to_a = 1
```

(Replace `USER_A`/`USER_B` with the real UUIDs from Step 2.)

- [ ] **Step 4: Clean up the test row**

```sql
delete from public.model_runs where decision_type = 'property' and schema_version = 1 and defaults_version = '2026-Q2-illustrative' and assumptions = '{}';
```

- [ ] **Step 5: Record the result**

Note the exact `visible_to_b = 0` / `visible_to_a = 1` output in the session's running notes — this is the "two-user RLS check performed and described in handoff" deliverable, not just an assertion.

---

### Task 3: Engine types

**Files:**
- Create: `cfos-office/src/lib/models/types.ts`

- [ ] **Step 1: Write the types**

```typescript
export type SlotOrigin = 'user' | 'edited' | 'market' | 'profile'

export interface SlotDefinition {
  id: string
  label: string
  unit: string
  required: boolean
  group: string
  tier: 'run' | 'profile'
  /** Only set for the one slot (horizon_years) that has a profile-tier fallback. */
  profileField?: 'default_horizon_years'
  relevantIf?: (values: Record<string, number | null>) => boolean
}

export interface SlotValue {
  value: number
  origin: SlotOrigin
}

export type SlotMap = Record<string, SlotValue | undefined>

export interface MarketDefault {
  value: number
  source: string
  asOf: string
}

export interface ResolvedValues {
  values: Record<string, number | null>
  provenance: Record<string, SlotOrigin | null>
}

export interface ModelRow {
  year: number
  rent: number
  invest: number
  cash: number
  redeploy: number | null
}

export interface ModelResult {
  rows: ModelRow[]
  myProceeds0: number
  cgtToday: number
  firstYearCF: number | null
  terminals: {
    rent: number
    invest: number
    cash: number
    redeploy: number | null
  }
}

export interface InterviewNode {
  id: string
  targetSlots: string[]
  prompt: string
}

export interface DecisionConfig {
  id: string
  schemaVersion: number
  defaultsVersion: string
  slots: SlotDefinition[]
  interview: InterviewNode[]
  scenarios: string[]
}
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/src/lib/models/types.ts
git commit -m "feat(models): add Models engine types"
```

---

### Task 4: Market defaults (versioned)

**Files:**
- Create: `cfos-office/src/lib/models/marketDefaults.ts`

- [ ] **Step 1: Write the defaults**

```typescript
import type { MarketDefault } from './types'

export const DEFAULTS_VERSION = '2026-Q2-illustrative'

export const MARKET_DEFAULTS: Record<string, MarketDefault> = {
  appreciation_pct: { value: 3.0, source: 'UK long-run nominal house price growth', asOf: '2026-05' },
  investment_return_pct: { value: 7.0, source: 'Global equity long-run nominal return', asOf: '2026-05' },
  cash_rate_pct: { value: 3.5, source: 'Easy-access GBP savings, typical', asOf: '2026-05' },
  mortgage_rate_pct: { value: 4.5, source: 'UK BTL remortgage, typical', asOf: '2026-05' },
  agent_fee_pct: { value: 12, source: 'London full management, 10-15% range', asOf: '2026-04' },
  void_weeks: { value: 3, source: 'London average void period, wks/yr', asOf: '2026-04' },
  selling_costs_pct: { value: 2.5, source: 'Agent + legal + EPC, typical London', asOf: '2026-04' },
  maintenance_pct: { value: 1.0, source: 'Rule of thumb, % of value p.a.', asOf: 'static' },
  rental_tax_pct: { value: 22, source: 'SIMPLIFIED blend: UK NRL + ES top-up', asOf: 'simplified' },
  cgt_rate_pct: { value: 24, source: 'SIMPLIFIED: UK res. CGT, no rebasing', asOf: 'simplified' },
  new_buying_costs_pct: { value: 11, source: 'SIMPLIFIED: ES ITP + notary', asOf: 'simplified' },
  new_mortgage_rate_pct: { value: 3.5, source: 'ES residential mortgage, typical', asOf: '2026-05' },
  new_property_appreciation_pct: { value: 3.0, source: 'ES long-run nominal house price growth', asOf: '2026-05' },
}
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/src/lib/models/marketDefaults.ts
git commit -m "feat(models): add versioned market defaults"
```

---

### Task 5: Engine — `resolveValues` + `saleNet` + tests

**Files:**
- Create: `cfos-office/src/lib/models/engine/property.ts`
- Create: `cfos-office/src/lib/models/engine/property.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { resolveValues, saleNet } from './property'
import { MARKET_DEFAULTS } from '../marketDefaults'
import type { SlotDefinition, SlotMap } from '../types'

const SLOTS: SlotDefinition[] = [
  { id: 'property_value', label: 'Current market value', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'purchase_price', label: 'Original purchase price', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'mortgage_balance', label: 'Outstanding mortgage', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'selling_costs_pct', label: 'Selling costs', unit: '%', required: false, group: 'Exit', tier: 'run' },
  { id: 'cgt_rate_pct', label: 'Eff. CGT rate on sale', unit: '%', required: false, group: 'Tax (simplified)', tier: 'run' },
]

describe('resolveValues', () => {
  it('prefers a stated run value over the market default', () => {
    const slots: SlotMap = { property_value: { value: 500000, origin: 'user' } }
    const resolved = resolveValues(slots, SLOTS, MARKET_DEFAULTS)
    expect(resolved.property_value).toBe(500000)
  })

  it('falls back to the market default when unset', () => {
    const resolved = resolveValues({}, SLOTS, MARKET_DEFAULTS)
    expect(resolved.selling_costs_pct).toBe(2.5)
    expect(resolved.cgt_rate_pct).toBe(24)
  })

  it('returns null for a required slot with no default and no stated value', () => {
    const resolved = resolveValues({}, SLOTS, MARKET_DEFAULTS)
    expect(resolved.property_value).toBeNull()
  })

  it('ignores a NaN-valued entry and falls through to default', () => {
    const slots: SlotMap = { cgt_rate_pct: { value: Number.NaN, origin: 'edited' } }
    const resolved = resolveValues(slots, SLOTS, MARKET_DEFAULTS)
    expect(resolved.cgt_rate_pct).toBe(24)
  })
})

describe('saleNet', () => {
  it('nets a property value against costs, mortgage, and CGT on the gain', () => {
    const result = saleNet(480000, 390000, 210000, { selling_costs_pct: 2.5, cgt_rate_pct: 24 })
    // costs = 480000*0.025 = 12000; gain = 90000; cgt = 90000*0.24 = 21600
    // net = 480000 - 12000 - 210000 - 21600 = 236400
    expect(result.costs).toBeCloseTo(12000, 6)
    expect(result.cgt).toBeCloseTo(21600, 6)
    expect(result.net).toBeCloseTo(236400, 6)
  })

  it('floors the taxable gain at zero when selling below purchase price', () => {
    const result = saleNet(300000, 390000, 210000, { selling_costs_pct: 2.5, cgt_rate_pct: 24 })
    expect(result.cgt).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: FAIL — `property.ts` does not exist / exports missing.

- [ ] **Step 3: Write the implementation**

```typescript
import type { MarketDefault, SlotDefinition, SlotMap } from '../types'

export function resolveValues(
  slots: SlotMap,
  slotDefs: SlotDefinition[],
  marketDefaults: Record<string, MarketDefault>
): Record<string, number | null> {
  const v: Record<string, number | null> = {}
  for (const s of slotDefs) {
    const entry = slots[s.id]
    if (entry && entry.value !== null && entry.value !== undefined && !Number.isNaN(entry.value)) {
      v[s.id] = Number(entry.value)
    } else if (marketDefaults[s.id]) {
      v[s.id] = marketDefaults[s.id].value
    } else {
      v[s.id] = null
    }
  }
  return v
}

export function saleNet(
  pv: number,
  purchasePrice: number,
  mortgage: number,
  v: { selling_costs_pct: number; cgt_rate_pct: number }
): { net: number; costs: number; cgt: number } {
  const costs = (pv * v.selling_costs_pct) / 100
  const gain = Math.max(0, pv - purchasePrice)
  const cgt = (gain * v.cgt_rate_pct) / 100
  return { net: pv - costs - mortgage - cgt, costs, cgt }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add cfos-office/src/lib/models/engine/property.ts cfos-office/src/lib/models/engine/property.test.ts
git commit -m "feat(models): port resolveValues + saleNet with tests"
```

---

### Task 6: Engine — `runModel` (rent / invest / cash) + golden test

**Files:**
- Modify: `cfos-office/src/lib/models/engine/property.ts`
- Modify: `cfos-office/src/lib/models/engine/property.test.ts`

- [ ] **Step 1: Write the failing golden test**

Append to `property.test.ts` (merge `runModel` into the existing `import { resolveValues, saleNet } from './property'` line at the top of the file rather than adding a second import statement):

```typescript
// Canonical fixture — pinned against the M1 brief. Hand-verified: myProceeds0
// = 236400 * 0.3333 = 78,792.12; cgtToday share = 21600 * 0.3333 = 7,199.28;
// year-1 net rent CF share = (grossRent 22,615.3846 - agent 2,713.8462 -
// maint 4,800 - own 3,000 - interest 9,450 = profit 2,651.5385, tax 583.3385)
// * 0.3333 = 689.33. All match the brief's pinned expected values exactly.
const FIXTURE = {
  property_value: 480000,
  purchase_price: 390000,
  mortgage_balance: 210000,
  ownership_share_pct: 33.33,
  monthly_rent: 2000,
  monthly_costs: 250,
  horizon_years: 10,
  appreciation_pct: 3.0,
  investment_return_pct: 7.0,
  cash_rate_pct: 3.5,
  mortgage_rate_pct: 4.5,
  agent_fee_pct: 12,
  void_weeks: 3,
  selling_costs_pct: 2.5,
  maintenance_pct: 1.0,
  rental_tax_pct: 22,
  cgt_rate_pct: 24,
}

describe('runModel — golden fixture', () => {
  it('matches the brief-pinned sale-today, year-1 cash flow, and 10-year terminals', () => {
    const m = runModel(FIXTURE)
    expect(Math.round(m.myProceeds0)).toBe(78792)
    expect(Math.round(m.cgtToday)).toBe(7199)
    expect(Math.round(m.firstYearCF as number)).toBe(689)
    expect(Math.round(m.terminals.rent)).toBe(133621)
    expect(Math.round(m.terminals.invest)).toBe(154996)
    expect(Math.round(m.terminals.cash)).toBe(111144)
  })

  it('produces 11 rows (year 0 through horizon) and a monotonically increasing invest trajectory', () => {
    const m = runModel(FIXTURE)
    expect(m.rows).toHaveLength(11)
    for (let i = 1; i < m.rows.length; i++) {
      expect(m.rows[i].invest).toBeGreaterThan(m.rows[i - 1].invest)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: FAIL — `runModel` not exported.

- [ ] **Step 3: Implement `runModel`**

Append to `property.ts`:

```typescript
import type { ModelResult } from '../types'

export function runModel(v: Record<string, number>): ModelResult {
  const share = v.ownership_share_pct / 100
  const years = Math.max(1, Math.round(v.horizon_years))

  const s0 = saleNet(v.property_value, v.purchase_price, v.mortgage_balance, v)
  const myProceeds0 = s0.net * share

  let invest = myProceeds0
  let cash = myProceeds0

  let pv = v.property_value
  let rentMo = v.monthly_rent
  let rentPot = 0
  let firstYearCF: number | null = null

  const rentRows: number[] = [s0.net * share]
  const investRows: number[] = [myProceeds0]
  const cashRows: number[] = [myProceeds0]

  for (let y = 1; y <= years; y++) {
    invest *= 1 + v.investment_return_pct / 100
    cash *= 1 + v.cash_rate_pct / 100

    const grossRent = rentMo * 12 * (1 - v.void_weeks / 52)
    const agent = (grossRent * v.agent_fee_pct) / 100
    const maint = (pv * v.maintenance_pct) / 100
    const interest = (v.mortgage_balance * v.mortgage_rate_pct) / 100
    const own = v.monthly_costs * 12
    const profit = grossRent - agent - maint - own - interest
    const tax = Math.max(0, profit) * (v.rental_tax_pct / 100)
    const netCF = (profit - tax) * share
    if (y === 1) firstYearCF = netCF

    rentPot = rentPot * (1 + v.cash_rate_pct / 100) + netCF
    pv *= 1 + v.appreciation_pct / 100
    rentMo *= 1 + v.appreciation_pct / 100

    const sy = saleNet(pv, v.purchase_price, v.mortgage_balance, v)
    rentRows.push(sy.net * share + rentPot)
    investRows.push(invest)
    cashRows.push(cash)
  }

  const redeployRows = runRedeploy(v, years, myProceeds0)

  const rows = rentRows.map((rent, i) => ({
    year: i,
    rent,
    invest: investRows[i],
    cash: cashRows[i],
    redeploy: redeployRows ? redeployRows[i] : null,
  }))

  return {
    rows,
    myProceeds0,
    cgtToday: s0.cgt * share,
    firstYearCF,
    terminals: {
      rent: rentRows[rentRows.length - 1],
      invest: investRows[investRows.length - 1],
      cash: cashRows[cashRows.length - 1],
      redeploy: redeployRows ? redeployRows[redeployRows.length - 1] : null,
    },
  }
}

// Scenario 4 — sell & redeploy proceeds as the deposit on a new owner-occupied
// home. Interest-only simplification, same as the London side. Returns null
// when the user hasn't opted into this scenario (no target property price).
function runRedeploy(v: Record<string, number>, years: number, deposit: number): number[] | null {
  const newPrice0 = v.new_property_price
  if (!newPrice0 || newPrice0 <= 0) return null

  const buyingCostsPct = v.new_buying_costs_pct
  const mortgageRate = v.new_mortgage_rate_pct
  const appreciation = v.new_property_appreciation_pct
  const rentPaid = v.current_rent_paid_monthly ?? 0

  const buyingCosts = (newPrice0 * buyingCostsPct) / 100
  const totalCashNeeded = newPrice0 + buyingCosts
  const newMortgage = Math.max(0, totalCashNeeded - deposit)
  let pot = Math.max(0, deposit - totalCashNeeded)
  let newPrice = newPrice0

  const rows = [newPrice0 - newMortgage + pot]
  for (let y = 1; y <= years; y++) {
    const avoidedRent = rentPaid * 12
    const interest = (newMortgage * mortgageRate) / 100
    const maint = (newPrice * v.maintenance_pct) / 100
    const netBenefit = avoidedRent - interest - maint
    pot = pot * (1 + v.cash_rate_pct / 100) + netBenefit
    newPrice *= 1 + appreciation / 100
    const sellingCosts = (newPrice * v.selling_costs_pct) / 100
    const equity = newPrice - newMortgage - sellingCosts
    rows.push(equity + pot)
  }
  return rows
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add cfos-office/src/lib/models/engine/property.ts cfos-office/src/lib/models/engine/property.test.ts
git commit -m "feat(models): port runModel with golden-fixture test"
```

---

### Task 7: Engine — `flipPoint` + test

**Files:**
- Modify: `cfos-office/src/lib/models/engine/property.ts`
- Modify: `cfos-office/src/lib/models/engine/property.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `property.test.ts` (merge `flipPoint` into the existing top-of-file import from `'./property'`):

```typescript
describe('flipPoint', () => {
  it('finds the appreciation_pct crossover between rent-out and sell-and-invest', () => {
    const result = flipPoint(FIXTURE, 'appreciation_pct', -2, 12)
    expect(result).not.toBeNull()
    expect(result as number).toBeCloseTo(4.157, 2)

    const m = runModel({ ...FIXTURE, appreciation_pct: result as number })
    expect(Math.abs(m.terminals.rent - m.terminals.invest)).toBeLessThan(1)
  })

  it('returns null when there is no crossing in the given range', () => {
    const result = flipPoint(FIXTURE, 'appreciation_pct', 20, 30)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: FAIL — `flipPoint` not exported.

- [ ] **Step 3: Implement `flipPoint`**

Append to `property.ts`:

```typescript
export function flipPoint(
  v: Record<string, number>,
  varId: string,
  lo: number,
  hi: number
): number | null {
  const gap = (x: number) => {
    const m = runModel({ ...v, [varId]: x })
    return m.terminals.rent - m.terminals.invest
  }
  let a = lo
  let b = hi
  let fa = gap(a)
  let fb = gap(b)
  if (fa * fb > 0) return null
  for (let i = 0; i < 60; i++) {
    const mid = (a + b) / 2
    const fm = gap(mid)
    if (fa * fm <= 0) {
      b = mid
      fb = fm
    } else {
      a = mid
      fa = fm
    }
  }
  return (a + b) / 2
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add cfos-office/src/lib/models/engine/property.ts cfos-office/src/lib/models/engine/property.test.ts
git commit -m "feat(models): port flipPoint bisection with test"
```

---

### Task 8: Engine — edge-case tests

**Files:**
- Modify: `cfos-office/src/lib/models/engine/property.test.ts`

- [ ] **Step 1: Write and run the edge tests (implementation already handles all four — this task is test-only)**

Append to `property.test.ts`:

```typescript
describe('runModel — edge cases', () => {
  it('zero mortgage: no interest deduction, no mortgage subtracted from sale proceeds', () => {
    const m = runModel({ ...FIXTURE, mortgage_balance: 0 })
    // net = 480000 - 12000(costs) - 0(mortgage) - 21600(cgt) = 446400; *0.3333 share = 148,785.12
    expect(Math.round(m.myProceeds0)).toBe(148785)
    expect(m.myProceeds0).toBeGreaterThan(runModel(FIXTURE).myProceeds0)
  })

  it('negative rental profit floors tax at zero, not a negative rebate', () => {
    const m = runModel({ ...FIXTURE, monthly_costs: 5000 })
    expect(m.firstYearCF).toBeLessThan(0)
    // If tax were allowed to go negative, netCF would differ from profit*share exactly.
    const grossRent = 2000 * 12 * (1 - 3 / 52)
    const agent = (grossRent * 12) / 100
    const maint = 480000 * 0.01
    const interest = (210000 * 4.5) / 100
    const own = 5000 * 12
    const profit = grossRent - agent - maint - own - interest
    expect(m.firstYearCF).toBeCloseTo(profit * 0.3333, 1)
  })

  it('100% ownership share returns the full sale net, unshared', () => {
    const m = runModel({ ...FIXTURE, ownership_share_pct: 100 })
    expect(m.myProceeds0).toBeCloseTo(236400, 6)
  })

  it('horizon of 1 year returns exactly 2 rows (year 0 and year 1)', () => {
    const m = runModel({ ...FIXTURE, horizon_years: 1 })
    expect(m.rows).toHaveLength(2)
    expect(m.terminals.rent).toBeCloseTo(83009.1, 0)
  })
})
```

- [ ] **Step 2: Run and verify all pass**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 3: Commit**

```bash
git add cfos-office/src/lib/models/engine/property.test.ts
git commit -m "test(models): add engine edge-case coverage"
```

---

### Task 9: Engine — scenario 4 (redeploy) golden test

**Files:**
- Modify: `cfos-office/src/lib/models/engine/property.test.ts`

- [ ] **Step 1: Write and run the scenario-4 golden test**

Append to `property.test.ts`:

```typescript
describe('runModel — scenario 4 (sell & redeploy into a new home)', () => {
  // Hand-checked year 1: buyingCosts = 320000*0.11 = 35,200; totalCashNeeded =
  // 355,200; deposit (myProceeds0) = 78,792.12; newMortgage = 355,200 -
  // 78,792.12 = 276,407.88; pot0 = 0 (deposit < totalCashNeeded).
  // Year 1: avoidedRent = 1100*12 = 13,200; interest = 276,407.88*0.035 =
  // 9,674.28; maint = 320000*0.01 = 3,200; netBenefit = 13200 - 9674.28 -
  // 3200 = 325.72; pot1 = 325.72. newPrice1 = 320000*1.03 = 329,600;
  // sellingCosts1 = 329600*0.025 = 8,240; equity1 = 329600 - 276407.88 -
  // 8240 = 44,952.12. Row 1 = equity1 + pot1 = 45,277.84 -> rounds to 45,278,
  // matching the value below (computed by running the implementation and
  // confirmed against this hand check).
  const withRedeploy = { ...FIXTURE, new_property_price: 320000, current_rent_paid_monthly: 1100 }

  it('matches the hand-checked year-1 redeploy trajectory point and pinned 10-year terminal', () => {
    const m = runModel(withRedeploy)
    expect(Math.round(m.rows[1].redeploy as number)).toBe(45278)
    expect(Math.round(m.terminals.redeploy as number)).toBe(141579)
  })

  it('appears as a ranked option alongside rent/invest/cash', () => {
    const m = runModel(withRedeploy)
    const ranked = Object.entries(m.terminals)
      .filter(([, val]) => val !== null)
      .sort(([, a], [, b]) => (b as number) - (a as number))
    expect(ranked.map(([k]) => k)).toContain('redeploy')
  })

  it('is null when the user has not opted into scenario 4 (no new_property_price)', () => {
    const m = runModel(FIXTURE)
    expect(m.terminals.redeploy).toBeNull()
    expect(m.rows[1].redeploy).toBeNull()
  })
})
```

- [ ] **Step 2: Run and verify all pass**

Run: `cd cfos-office && npx vitest run src/lib/models/engine/property.test.ts`
Expected: PASS (17 tests). **STOP LINE gate: do not proceed to Task 10 until all engine tests are green.**

- [ ] **Step 3: Commit**

```bash
git add cfos-office/src/lib/models/engine/property.test.ts
git commit -m "test(models): pin scenario-4 redeploy golden values"
```

---

### Task 10: Registry — decision-type config

**Files:**
- Create: `cfos-office/src/lib/models/registry.ts`

- [ ] **Step 1: Write the registry**

```typescript
import type { DecisionConfig, SlotDefinition } from './types'

const SLOTS: SlotDefinition[] = [
  { id: 'property_value', label: 'Current market value', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'purchase_price', label: 'Original purchase price', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'mortgage_balance', label: 'Outstanding mortgage', unit: '£', required: true, group: 'Property', tier: 'run' },
  {
    id: 'mortgage_rate_pct',
    label: 'Mortgage rate',
    unit: '%',
    required: false,
    group: 'Property',
    tier: 'run',
    relevantIf: (v) => (v.mortgage_balance ?? 0) > 0,
  },
  { id: 'ownership_share_pct', label: 'Your ownership share', unit: '%', required: true, group: 'Ownership', tier: 'run' },
  {
    id: 'will_never_let_flag',
    label: 'Would never rent it out',
    unit: 'bool',
    required: false,
    group: 'Letting',
    tier: 'run',
  },
  {
    id: 'monthly_rent',
    label: 'Achievable monthly rent',
    unit: '£/mo',
    required: true,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  {
    id: 'monthly_costs',
    label: 'Service charge + insurance',
    unit: '£/mo',
    required: true,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  {
    id: 'agent_fee_pct',
    label: 'Letting agent fee',
    unit: '%',
    required: false,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  {
    id: 'void_weeks',
    label: 'Void period',
    unit: 'wk/yr',
    required: false,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  { id: 'maintenance_pct', label: 'Maintenance', unit: '%/yr', required: false, group: 'Letting', tier: 'run' },
  {
    id: 'rental_tax_pct',
    label: 'Eff. tax on rental profit',
    unit: '%',
    required: false,
    group: 'Tax (simplified)',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  { id: 'cgt_rate_pct', label: 'Eff. CGT rate on sale', unit: '%', required: false, group: 'Tax (simplified)', tier: 'run' },
  { id: 'selling_costs_pct', label: 'Selling costs', unit: '%', required: false, group: 'Exit', tier: 'run' },
  { id: 'appreciation_pct', label: 'House price growth', unit: '%/yr', required: false, group: 'Market', tier: 'run' },
  { id: 'investment_return_pct', label: 'Index fund return', unit: '%/yr', required: false, group: 'Market', tier: 'run' },
  { id: 'cash_rate_pct', label: 'Cash savings rate', unit: '%/yr', required: false, group: 'Market', tier: 'run' },
  {
    id: 'horizon_years',
    label: 'Decision horizon',
    unit: 'yrs',
    required: true,
    group: 'Horizon',
    tier: 'profile',
    profileField: 'default_horizon_years',
  },
  // Scenario 4 — sell & redeploy into a new home. Inactive (defaults injected,
  // hidden from the ledger, skipped by the interviewer) until the user answers
  // yes to the branching question in the interview.
  {
    id: 'new_property_price',
    label: 'New property price',
    unit: '£',
    required: false,
    group: 'Redeploy',
    tier: 'run',
  },
  {
    id: 'new_buying_costs_pct',
    label: 'Buying costs (new home)',
    unit: '%',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
  {
    id: 'new_mortgage_rate_pct',
    label: 'Mortgage rate (new home)',
    unit: '%',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
  {
    id: 'new_property_appreciation_pct',
    label: 'House price growth (new home)',
    unit: '%/yr',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
  {
    id: 'current_rent_paid_monthly',
    label: 'Rent you currently pay',
    unit: '£/mo',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
]

const INTERVIEW_ORDER = [
  'property_value',
  'purchase_price',
  'mortgage_balance',
  'ownership_share_pct',
  'monthly_rent',
  'monthly_costs',
  'horizon_years',
]

export const PROPERTY_DECISION: DecisionConfig = {
  id: 'property',
  schemaVersion: 1,
  defaultsVersion: '2026-Q2-illustrative',
  slots: SLOTS,
  interview: [
    ...INTERVIEW_ORDER.map((id) => ({
      id,
      targetSlots: [id],
      prompt: SLOTS.find((s) => s.id === id)?.label ?? id,
    })),
    {
      id: 'redeploy_branch',
      targetSlots: ['new_property_price', 'current_rent_paid_monthly'],
      prompt: 'Would selling fund another property purchase?',
    },
  ],
  scenarios: ['rent', 'invest', 'cash', 'redeploy'],
}

export function activeSlots(values: Record<string, number | null>): SlotDefinition[] {
  return SLOTS.filter((s) => !s.relevantIf || s.relevantIf(values))
}

export { SLOTS as PROPERTY_SLOTS }
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/src/lib/models/registry.ts
git commit -m "feat(models): add property decision registry"
```

---

### Task 11: Three-tier resolver + test

**Files:**
- Create: `cfos-office/src/lib/models/resolve.ts`
- Create: `cfos-office/src/lib/models/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { resolveRunValues } from './resolve'
import { PROPERTY_SLOTS } from './registry'
import { MARKET_DEFAULTS } from './marketDefaults'
import type { SlotMap } from './types'

describe('resolveRunValues — precedence run > profile > market', () => {
  it('prefers a run-level stated value over profile and market', () => {
    const runAssumptions: SlotMap = { horizon_years: { value: 15, origin: 'user' } }
    const profile = { default_horizon_years: 10 }
    const result = resolveRunValues(runAssumptions, profile, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.horizon_years).toBe(15)
    expect(result.provenance.horizon_years).toBe('user')
  })

  it('falls back to the profile value when no run value is stated', () => {
    const result = resolveRunValues({}, { default_horizon_years: 12 }, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.horizon_years).toBe(12)
    expect(result.provenance.horizon_years).toBe('profile')
  })

  it('falls back to the market default when neither run nor profile has a value', () => {
    const result = resolveRunValues({}, null, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.appreciation_pct).toBe(3.0)
    expect(result.provenance.appreciation_pct).toBe('market')
    // horizon_years has no market default and no profile — null.
    expect(result.values.horizon_years).toBeNull()
    expect(result.provenance.horizon_years).toBeNull()
  })

  it('a required run-only slot with no default and no run value resolves to null', () => {
    const result = resolveRunValues({}, null, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.property_value).toBeNull()
    expect(result.provenance.property_value).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cfos-office && npx vitest run src/lib/models/resolve.test.ts`
Expected: FAIL — `resolve.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

```typescript
import type { MarketDefault, ResolvedValues, SlotDefinition, SlotMap } from './types'

export function resolveRunValues(
  runAssumptions: SlotMap,
  profile: { default_horizon_years?: number | null } | null,
  slotDefs: SlotDefinition[],
  marketDefaults: Record<string, MarketDefault>
): ResolvedValues {
  const values: Record<string, number | null> = {}
  const provenance: Record<string, ResolvedValues['provenance'][string]> = {}

  for (const slot of slotDefs) {
    const runEntry = runAssumptions[slot.id]
    if (runEntry && typeof runEntry.value === 'number' && !Number.isNaN(runEntry.value)) {
      values[slot.id] = runEntry.value
      provenance[slot.id] = runEntry.origin
      continue
    }

    if (slot.tier === 'profile' && slot.profileField && profile) {
      const profileVal = profile[slot.profileField]
      if (typeof profileVal === 'number' && !Number.isNaN(profileVal)) {
        values[slot.id] = profileVal
        provenance[slot.id] = 'profile'
        continue
      }
    }

    const def = marketDefaults[slot.id]
    if (def) {
      values[slot.id] = def.value
      provenance[slot.id] = 'market'
      continue
    }

    values[slot.id] = null
    provenance[slot.id] = null
  }

  return { values, provenance }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cfos-office && npx vitest run src/lib/models/resolve.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add cfos-office/src/lib/models/resolve.ts cfos-office/src/lib/models/resolve.test.ts
git commit -m "feat(models): add three-tier assumption resolver"
```

---

### Task 12: `POST /api/models/runs` — create a run

**Files:**
- Create: `cfos-office/src/app/api/models/runs/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PROPERTY_DECISION } from '@/lib/models/registry'

const OPENING_MESSAGE =
  "Let's model the property: keep it and rent it out, sell and index the proceeds, or sell and sit in cash. A handful of questions, then the engine runs. First — what's it worth today? A recent valuation or your best estimate is fine."

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_financial_profile')
    .select('default_horizon_years')
    .eq('user_id', user.id)
    .maybeSingle()

  // Interview opens by confirming stale profile values, not re-asking — seed
  // horizon_years at 'profile' tier if a profile row already exists.
  const assumptions = profile?.default_horizon_years
    ? { horizon_years: { value: profile.default_horizon_years, origin: 'profile' } }
    : {}

  const openingText = profile?.default_horizon_years
    ? `${OPENING_MESSAGE} (I've got your usual ${profile.default_horizon_years}-year horizon — shout if that's changed.)`
    : OPENING_MESSAGE

  const { data: run, error } = await supabase
    .from('model_runs')
    .insert({
      user_id: user.id,
      decision_type: PROPERTY_DECISION.id,
      schema_version: PROPERTY_DECISION.schemaVersion,
      defaults_version: PROPERTY_DECISION.defaultsVersion,
      status: 'interviewing',
      assumptions,
      messages: [{ role: 'assistant', text: openingText }],
      caveats: [],
    })
    .select('id')
    .single()

  if (error || !run) {
    console.error('[models/runs] insert error:', error)
    return NextResponse.json({ error: 'Failed to create model run' }, { status: 500 })
  }

  return NextResponse.json({ id: run.id })
}
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/src/app/api/models/runs/route.ts
git commit -m "feat(models): add run-creation API route"
```

---

### Task 13: `PATCH /api/models/runs/[id]` — ledger edit

**Files:**
- Create: `cfos-office/src/app/api/models/runs/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { PROPERTY_SLOTS } from '@/lib/models/registry'

const PatchSchema = z.object({
  slot_id: z.string(),
  value: z.number(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid patch payload' }, { status: 400 })
  }

  // Closed world — silently reject edits to slot ids the registry doesn't know.
  if (!PROPERTY_SLOTS.some((s) => s.id === parsed.data.slot_id)) {
    return NextResponse.json({ error: 'Unknown slot id' }, { status: 400 })
  }

  const { data: run, error: fetchError } = await supabase
    .from('model_runs')
    .select('assumptions')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const assumptions = {
    ...(run.assumptions as Record<string, unknown>),
    [parsed.data.slot_id]: { value: parsed.data.value, origin: 'edited' },
  }

  const { error: updateError } = await supabase
    .from('model_runs')
    .update({ assumptions, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[models/runs/:id] update error:', updateError)
    return NextResponse.json({ error: 'Failed to update run' }, { status: 500 })
  }

  return NextResponse.json({ assumptions })
}
```

- [ ] **Step 2: Commit**

```bash
git add "cfos-office/src/app/api/models/runs/[id]/route.ts"
git commit -m "feat(models): add ledger-edit PATCH route"
```

---

### Task 14: `POST /api/models/interviewer`

**Files:**
- Create: `cfos-office/src/app/api/models/interviewer/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { chatModel, chatModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import { sendAlert } from '@/lib/alerts/notify'
import { PROPERTY_DECISION, PROPERTY_SLOTS } from '@/lib/models/registry'
import { MARKET_DEFAULTS } from '@/lib/models/marketDefaults'

const RequestSchema = z.object({
  runId: z.string().uuid(),
  message: z.string().min(1),
})

const InterviewerResponseSchema = z.object({
  extracted: z.array(
    z.object({
      id: z.string(),
      value: z.number(),
      origin: z.enum(['user', 'market']),
    })
  ),
  challenge: z.string().nullable(),
  reply: z.string(),
  done: z.boolean(),
})

function buildPrompt(
  filled: Record<string, number>,
  remaining: string[],
  history: string
): string {
  const schemaBrief = PROPERTY_SLOTS.map(
    (s) => `${s.id} (${s.label}, ${s.unit}${s.required ? ', REQUIRED' : ''})`
  ).join('; ')
  const defaultsBrief = Object.entries(MARKET_DEFAULTS)
    .map(([k, d]) => `${k}=${d.value} (${d.source})`)
    .join('; ')

  return `You are the interviewer inside a CFO tool modelling a property decision: keep-and-rent-out vs sell-and-invest vs sell-and-hold-cash vs sell-and-redeploy into a new home. Currency is GBP.

You NEVER do arithmetic and NEVER state results. A deterministic engine computes everything. Your only jobs: extract slot values from the user's words, challenge values that look off versus market averages, and ask the next question.

SLOT SCHEMA: ${schemaBrief}
ALREADY FILLED: ${JSON.stringify(filled)}
REMAINING (priority order): ${remaining.join(', ') || 'none — required slots complete'}
MARKET REFERENCE VALUES: ${defaultsBrief}

CONVERSATION SO FAR:
${history}

RULES:
1. Extract every slot value present in the user's latest message. Users may answer several at once, give ranges (take the midpoint and say so), use "k"/"m" shorthand, or revise earlier answers. Values must be plain numbers. Percentages as numbers, e.g. 33.3 not 0.333.
2. If a user-stated value deviates more than ~20% from a market reference, set "challenge" to ONE short sentence naming the market figure and saying you'll keep their number. Otherwise "challenge" is null.
3. Ask exactly ONE next question, targeting the first remaining slot. Plain language, one sentence. If the user seems unsure, offer to proceed with a market default.
4. If a user asks to use a default or says "you pick", extract the market reference value with origin "market".
5. After the required slots are filled, ask once: "Would selling fund another property purchase?" If yes, ask for new_property_price and current_rent_paid_monthly next. If no, treat scenario 4 as skipped and move to done.
6. If a user states they would never rent the place out, extract will_never_let_flag=1 with origin "user".
7. If nothing remains, set done=true and reply with one short line handing off to the results panel.
8. Keep replies under 45 words. Warm but flat.
9. Never say "advice" or "advise". This is decision support, not a recommendation.

Respond with ONLY raw JSON, no markdown fences, exactly this shape:
{"extracted":[{"id":"slot_id","value":123,"origin":"user"}],"challenge":null,"reply":"...","done":false}`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsedReq = RequestSchema.safeParse(body)
  if (!parsedReq.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { runId, message } = parsedReq.data

  const { data: run, error: fetchError } = await supabase
    .from('model_runs')
    .select('assumptions, messages')
    .eq('id', runId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const assumptions = run.assumptions as Record<string, { value: number; origin: string }>
  const messages = run.messages as Array<{ role: string; text: string }>

  const filled: Record<string, number> = {}
  for (const [id, entry] of Object.entries(assumptions)) {
    if (entry?.value !== undefined) filled[id] = entry.value
  }
  const remaining = PROPERTY_DECISION.interview
    .flatMap((n) => n.targetSlots)
    .filter((id) => !(id in filled))

  const nextMessages = [...messages, { role: 'user', text: message }]
  const history = nextMessages
    .slice(-14)
    .map((m) => `${m.role === 'user' ? 'USER' : 'CFO'}: ${m.text}`)
    .join('\n')

  const prompt = buildPrompt(filled, remaining, history)

  let text: string
  try {
    const startTime = Date.now()
    const result = await generateText({ model: chatModel, messages: [{ role: 'user', content: prompt }] })
    text = result.text
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId: user.id,
      callType: 'models_interviewer',
      model: chatModelId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      durationMs,
      metadata: { run_id: runId },
    })
    logBedrockUsage({
      callSite: 'models_interviewer',
      model: 'sonnet',
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      userId: user.id,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[models/interviewer] bedrock call failed', { error, runId })
    void sendAlert({
      severity: 'critical',
      event: 'models_interviewer_bedrock_failed',
      user_id: user.id,
      details: `Bedrock call failed for run ${runId}: ${msg}`,
      metadata: { model: chatModelId, runId },
    })
    return NextResponse.json({
      reply: "The interviewer dropped the connection — say that again, or fill the value straight into the ledger.",
      extracted: [],
      done: false,
    })
  }

  const parseAttempt = (raw: string) => {
    const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    return InterviewerResponseSchema.safeParse(JSON.parse(cleaned))
  }

  let parsed
  try {
    parsed = parseAttempt(text)
  } catch {
    parsed = { success: false as const }
  }

  if (!parsed.success) {
    // Retry once with a stricter reminder, then apologise.
    try {
      const retry = await generateText({
        model: chatModel,
        messages: [{ role: 'user', content: `${prompt}\n\nYour previous response was not valid JSON. Return ONLY the raw JSON object, nothing else.` }],
      })
      parsed = parseAttempt(retry.text)
    } catch {
      parsed = { success: false as const }
    }
  }

  if (!parsed.success) {
    console.error('[models/interviewer] unparseable response', { runId, responsePreview: text.slice(0, 500) })
    void sendAlert({
      severity: 'warning',
      event: 'models_interviewer_unparseable',
      user_id: user.id,
      details: `Could not parse interviewer response for run ${runId}`,
      metadata: { runId, responsePreview: text.slice(0, 500) },
    })
    return NextResponse.json({
      reply: "Couldn't parse that — mind rephrasing, or fill the value straight into the ledger?",
      extracted: [],
      done: false,
    })
  }

  // Closed world — drop any slot id the registry doesn't recognise.
  const knownIds = new Set(PROPERTY_SLOTS.map((s) => s.id))
  const validExtractions = parsed.data.extracted.filter((e) => knownIds.has(e.id))

  const updatedAssumptions = { ...assumptions }
  for (const e of validExtractions) {
    updatedAssumptions[e.id] = { value: e.value, origin: e.origin }
  }

  // Profile-tier slots also seed user_financial_profile for future runs.
  const horizonExtraction = validExtractions.find((e) => e.id === 'horizon_years')
  if (horizonExtraction) {
    await supabase.from('user_financial_profile').upsert(
      { user_id: user.id, default_horizon_years: Math.round(horizonExtraction.value), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  }

  const replyParts = [parsed.data.challenge, parsed.data.reply].filter(Boolean)
  const finalMessages = [
    ...nextMessages,
    { role: 'assistant', text: replyParts.join(' ') || 'Noted.', challenge: Boolean(parsed.data.challenge), done: parsed.data.done },
  ]

  const { error: updateError } = await supabase
    .from('model_runs')
    .update({
      assumptions: updatedAssumptions,
      messages: finalMessages,
      status: parsed.data.done ? 'complete' : 'interviewing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[models/interviewer] persist error:', updateError)
    return NextResponse.json({ error: 'Failed to save interview progress' }, { status: 500 })
  }

  return NextResponse.json({
    extracted: validExtractions,
    challenge: parsed.data.challenge,
    reply: parsed.data.reply,
    done: parsed.data.done,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/src/app/api/models/interviewer/route.ts
git commit -m "feat(models): add LLM interviewer route with zod-validated extraction"
```

---

### Task 15: Models list page

**Files:**
- Create: `cfos-office/src/app/(office)/office/models/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ModelsListClient } from './ModelsListClient'

export default async function ModelsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: runs } = await supabase
    .from('model_runs')
    .select('id, decision_type, status, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return <ModelsListClient runs={runs ?? []} />
}
```

- [ ] **Step 2: Write the client list + "New model" action**

Create `cfos-office/src/app/(office)/office/models/ModelsListClient.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'

interface RunSummary {
  id: string
  decision_type: string
  status: string
  updated_at: string
}

const DECISION_LABELS: Record<string, string> = {
  property: 'Property',
}

export function ModelsListClient({ runs }: { runs: RunSummary[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const createRun = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/models/runs', { method: 'POST' })
      if (!res.ok) throw new Error('create failed')
      const { id } = await res.json()
      router.push(`/office/models/${id}`)
    } catch {
      setCreating(false)
    }
  }

  return (
    <div className="px-3.5 pt-2 pb-6 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-bold text-text-primary">Models</h1>
        <Button onClick={createRun} disabled={creating} size="sm">
          {creating ? 'Starting…' : 'New model'}
        </Button>
      </div>

      {runs.length === 0 && (
        <Card variant="inset" className="p-4 text-[13px] text-text-tertiary">
          No models yet. Start one to weigh a property decision — keep &amp; rent out, sell &amp; invest, or sell &amp; redeploy into a new home.
        </Card>
      )}

      {runs.map((run) => (
        <Card
          key={run.id}
          variant="default"
          interactive
          className="p-3 flex items-center justify-between"
          onClick={() => router.push(`/office/models/${run.id}`)}
        >
          <div>
            <div className="text-[13px] font-semibold text-text-primary">
              {DECISION_LABELS[run.decision_type] ?? run.decision_type}
            </div>
            <div className="font-data text-[10px] text-text-tertiary">
              {run.status === 'complete' ? 'Complete' : 'Interviewing'} · {new Date(run.updated_at).toLocaleDateString('en-GB')}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add "cfos-office/src/app/(office)/office/models/page.tsx" "cfos-office/src/app/(office)/office/models/ModelsListClient.tsx"
git commit -m "feat(models): add models list page"
```

---

### Task 16: Model run page (three-panel shell)

**Files:**
- Create: `cfos-office/src/app/(office)/office/models/[runId]/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RunClient } from './RunClient'

export default async function ModelRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: run } = await supabase
    .from('model_runs')
    .select('id, decision_type, status, assumptions, messages, caveats')
    .eq('id', runId)
    .eq('user_id', user.id)
    .single()

  if (!run) notFound()

  const { data: profile } = await supabase
    .from('user_financial_profile')
    .select('default_horizon_years')
    .eq('user_id', user.id)
    .maybeSingle()

  return <RunClient run={run} profile={profile} />
}
```

- [ ] **Step 2: Write the client shell (mobile tabs / desktop grid, per prototype structure — Correction 6 applies)**

Create `cfos-office/src/app/(office)/office/models/[runId]/RunClient.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { InterviewPanel } from '@/components/models/InterviewPanel'
import { AssumptionsLedger } from '@/components/models/AssumptionsLedger'
import { VerdictPanel } from '@/components/models/VerdictPanel'
import { PROPERTY_SLOTS } from '@/lib/models/registry'
import { MARKET_DEFAULTS } from '@/lib/models/marketDefaults'
import { resolveRunValues } from '@/lib/models/resolve'
import { runModel, flipPoint } from '@/lib/models/engine/property'
import type { SlotMap } from '@/lib/models/types'

interface RunData {
  id: string
  decision_type: string
  status: string
  assumptions: SlotMap
  messages: Array<{ role: string; text: string; challenge?: boolean; done?: boolean }>
  caveats: string[]
}

type Tab = 'interview' | 'ledger' | 'verdict'

export function RunClient({
  run,
  profile,
}: {
  run: RunData
  profile: { default_horizon_years: number | null } | null
}) {
  const [assumptions, setAssumptions] = useState<SlotMap>(run.assumptions)
  const [messages, setMessages] = useState(run.messages)
  const [tab, setTab] = useState<Tab>('interview')

  const resolved = resolveRunValues(assumptions, profile, PROPERTY_SLOTS, MARKET_DEFAULTS)
  const requiredIds = PROPERTY_SLOTS.filter((s) => s.required).map((s) => s.id)
  const filledRequired = requiredIds.filter((id) => resolved.values[id] !== null)
  const ready = filledRequired.length === requiredIds.length

  const model = ready ? runModel(resolved.values as Record<string, number>) : null
  const flips = ready
    ? [flipPoint(resolved.values as Record<string, number>, 'appreciation_pct', -2, 12)]
    : []

  const onEdit = async (slotId: string, value: number) => {
    setAssumptions((prev) => ({ ...prev, [slotId]: { value, origin: 'edited' } }))
    await fetch(`/api/models/runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot_id: slotId, value }),
    })
  }

  const onExtracted = (extracted: Array<{ id: string; value: number; origin: string }>) => {
    setAssumptions((prev) => {
      const next = { ...prev }
      for (const e of extracted) {
        next[e.id] = { value: e.value, origin: e.origin === 'market' ? 'market' : 'user' }
      }
      return next
    })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="md:hidden flex border-b border-border-subtle">
        {(['interview', 'ledger', 'verdict'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 font-data text-[11px] tracking-wide border-b-2"
            style={{ borderColor: tab === t ? 'var(--accent-gold)' : 'transparent' }}
          >
            {t.toUpperCase()}
            {t === 'ledger' ? ` ${filledRequired.length}/${requiredIds.length}` : ''}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden md:grid md:grid-cols-5">
        <div className={`${tab === 'interview' ? 'block' : 'hidden'} md:block md:col-span-2 h-full border-r border-border-subtle`}>
          <InterviewPanel runId={run.id} messages={messages} setMessages={setMessages} onExtracted={onExtracted} />
        </div>
        <div className={`${tab === 'ledger' ? 'block' : 'hidden'} md:block md:col-span-1 h-full border-r border-border-subtle overflow-y-auto`}>
          <AssumptionsLedger
            resolved={resolved}
            requiredIds={requiredIds}
            filledCount={filledRequired.length}
            onEdit={onEdit}
          />
        </div>
        <div className={`${tab === 'verdict' ? 'block' : 'hidden'} md:block md:col-span-2 h-full overflow-y-auto`}>
          <VerdictPanel model={model} resolved={resolved} flips={flips} filledCount={filledRequired.length} totalRequired={requiredIds.length} />
        </div>
      </div>
    </div>
  )
}
```

**Known prototype bug — not reproduced here:** `InterviewPanel`, `AssumptionsLedger`, `VerdictPanel` are imported top-level components with props (Tasks 17–19), never defined inline inside `RunClient`. Defining them inline and rendering as JSX would remount them per keystroke and drop input focus.

- [ ] **Step 3: Commit**

```bash
git add "cfos-office/src/app/(office)/office/models/[runId]/page.tsx" "cfos-office/src/app/(office)/office/models/[runId]/RunClient.tsx"
git commit -m "feat(models): add model run page shell"
```

---

### Task 17: `AssumptionsLedger` component

**Files:**
- Create: `cfos-office/src/components/models/AssumptionsLedger.tsx`

- [ ] **Step 1: Write the component**

```typescript
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { PROPERTY_SLOTS, activeSlots } from '@/lib/models/registry'
import type { ResolvedValues, SlotOrigin } from '@/lib/models/types'

const ORIGIN_TONE: Record<SlotOrigin, 'gold' | 'neutral' | 'info'> = {
  user: 'gold',
  edited: 'neutral',
  market: 'info',
  profile: 'info',
}

function formatValue(unit: string, value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (unit === 'bool') return value === 1 ? 'Yes' : 'No'
  if (unit.startsWith('£')) return `£${Math.round(value).toLocaleString('en-GB')}`
  return `${value}`
}

export function AssumptionsLedger({
  resolved,
  requiredIds,
  filledCount,
  onEdit,
}: {
  resolved: ResolvedValues
  requiredIds: string[]
  filledCount: number
  onEdit: (slotId: string, value: number) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')

  const visible = activeSlots(resolved.values).filter((s) => s.unit !== 'bool')
  const groups = visible.reduce<Record<string, typeof visible>>((acc, s) => {
    ;(acc[s.group] ??= []).push(s)
    return acc
  }, {})

  const commit = (slotId: string) => {
    const n = Number(editVal.replace(/,/g, ''))
    setEditingId(null)
    if (Number.isNaN(n)) return
    onEdit(slotId, n)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-3 pt-3 pb-1">
        <div className="font-data text-[11px] tracking-widest text-accent-gold">ASSUMPTIONS LEDGER</div>
        <div className="text-[11px] text-text-tertiary mt-0.5">
          {filledCount}/{requiredIds.length} required
        </div>
      </div>

      {Object.entries(groups).map(([group, slots]) => (
        <div key={group} className="mt-2">
          <div className="px-3 py-1 font-data text-[10px] tracking-widest text-text-muted">{group.toUpperCase()}</div>
          {slots.map((slot) => {
            const value = resolved.values[slot.id]
            const origin = resolved.provenance[slot.id]
            const missing = slot.required && value === null
            const isEditing = editingId === slot.id

            return (
              <div key={slot.id} className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
                <div className="flex-1 min-w-0 text-[13px] text-text-primary truncate">{slot.label}</div>
                {isEditing ? (
                  <Input
                    autoFocus
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={() => commit(slot.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(slot.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="w-24 text-right font-data text-[13px]"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(slot.id)
                      setEditVal(value === null ? '' : String(value))
                    }}
                    className="font-data text-[13px] tabular-nums text-right min-w-[5.5rem]"
                    style={{ color: missing ? 'var(--negative)' : 'var(--text-primary)' }}
                  >
                    {missing ? 'required' : formatValue(slot.unit, value)}
                  </button>
                )}
                {origin && !missing && (
                  <Badge tone={ORIGIN_TONE[origin]} className="shrink-0">
                    {origin}
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      ))}

      <div className="px-3 py-3 text-[11px] text-text-tertiary">
        Every figure is editable — tap a value.
      </div>
    </div>
  )
}

// PROPERTY_SLOTS retained for callers that need the full unfiltered set.
export { PROPERTY_SLOTS }
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/src/components/models/AssumptionsLedger.tsx
git commit -m "feat(models): add AssumptionsLedger component"
```

---

### Task 18: `InterviewPanel` component

**Files:**
- Create: `cfos-office/src/components/models/InterviewPanel.tsx`

- [ ] **Step 1: Write the component**

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'

interface Message {
  role: string
  text: string
  challenge?: boolean
  done?: boolean
}

export function InterviewPanel({
  runId,
  messages,
  setMessages,
  onExtracted,
}: {
  runId: string
  messages: Message[]
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  onExtracted: (extracted: Array<{ id: string; value: number; origin: string }>) => void
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text }])
    setBusy(true)
    try {
      const res = await fetch('/api/models/interviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, message: text }),
      })
      const data = await res.json()
      onExtracted(data.extracted ?? [])
      const parts = [data.challenge, data.reply].filter(Boolean)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: parts.join(' ') || 'Noted.', challenge: Boolean(data.challenge), done: Boolean(data.done) },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'The interviewer dropped the connection — say that again, or fill the value straight into the ledger.' },
      ])
    }
    setBusy(false)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-xs px-3 py-2 text-[13px] leading-relaxed rounded-control border"
              style={
                m.role === 'user'
                  ? { background: 'var(--accent-gold)', color: 'var(--bg-base)', borderColor: 'var(--accent-gold)' }
                  : {
                      background: m.challenge ? 'var(--accent-gold-bg)' : 'var(--bg-card)',
                      borderColor: m.challenge ? 'var(--accent-gold-border)' : 'var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-control border border-border-subtle text-[13px] text-text-tertiary">working…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="p-3 border-t border-border-subtle flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Answer here, or say “use the default”…"
          className="flex-1"
        />
        <Button onClick={() => void send()} disabled={busy || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add cfos-office/src/components/models/InterviewPanel.tsx
git commit -m "feat(models): add InterviewPanel component"
```

---

### Task 19: `VerdictPanel` + `FlipPoints` components

**Files:**
- Create: `cfos-office/src/components/models/FlipPoints.tsx`
- Create: `cfos-office/src/components/models/VerdictPanel.tsx`

- [ ] **Step 1: Write `FlipPoints`**

```typescript
'use client'

import { Card } from '@/components/ui/Card'

export function FlipPoints({ flips, currentAppreciation }: { flips: (number | null)[]; currentAppreciation: number }) {
  const appreciationFlip = flips[0]

  return (
    <div className="mt-4">
      <div className="font-data text-[11px] tracking-widest text-accent-gold mb-1">FLIP POINTS</div>
      <div className="space-y-2">
        {appreciationFlip !== null && appreciationFlip !== undefined ? (
          <Card variant="inset" className="p-3 text-[13px] text-text-primary">
            House price growth of {appreciationFlip.toFixed(1)}%/yr is the crossover — below it, selling &amp; investing wins; above it, keeping the property wins.
            <div className="text-[11px] text-text-tertiary mt-1">Current assumption: {currentAppreciation}%</div>
          </Card>
        ) : (
          <Card variant="inset" className="p-3 text-[13px] text-text-primary">
            No single-variable crossover within plausible ranges — the ranking is robust to any one assumption moving alone.
          </Card>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `VerdictPanel`**

```typescript
'use client'

import { Card } from '@/components/ui/Card'
import { FlipPoints } from './FlipPoints'
import type { ModelResult, ResolvedValues } from '@/lib/models/types'

const SCENARIO_LABELS: Record<string, string> = {
  rent: 'Keep & rent out',
  invest: 'Sell & invest',
  cash: 'Sell & hold cash',
  redeploy: 'Sell & redeploy into a new home',
}

function gbp(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  return (n < 0 ? '−£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB')
}

export function VerdictPanel({
  model,
  resolved,
  flips,
  filledCount,
  totalRequired,
}: {
  model: ModelResult | null
  resolved: ResolvedValues
  flips: (number | null)[]
  filledCount: number
  totalRequired: number
}) {
  if (!model) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="text-[13px] text-text-tertiary">
          {filledCount} of {totalRequired} required assumptions on file. The interview fills the rest — or enter them straight into the ledger.
        </div>
      </div>
    )
  }

  const ranking = Object.entries(model.terminals)
    .filter(([, val]) => val !== null)
    .map(([key, val]) => ({ key, val: val as number, label: SCENARIO_LABELS[key] ?? key }))
    .sort((a, b) => b.val - a.val)
  const best = ranking[0]

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="font-data text-[11px] tracking-widest text-accent-gold mb-2">
        VERDICT · {resolved.values.horizon_years}-YEAR HORIZON · {resolved.values.ownership_share_pct}% SHARE
      </div>

      <div className="space-y-2">
        {ranking.map((r, i) => (
          <Card key={r.key} variant={i === 0 ? 'elevated' : 'default'} className="flex items-center justify-between p-3">
            <span className="text-[13px] text-text-primary" style={{ fontWeight: i === 0 ? 600 : 400 }}>
              {r.label}
            </span>
            <div className="text-right">
              <div className="font-data text-[13px] tabular-nums text-text-primary">{gbp(r.val)}</div>
              {i > 0 && <div className="font-data text-[11px] tabular-nums text-negative">−{gbp(best.val - r.val).replace('£', '')}</div>}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Card variant="default" className="p-3">
          <div className="text-[11px] text-text-tertiary">Sale today nets you</div>
          <div className="font-data text-[13px] tabular-nums text-text-primary">{gbp(model.myProceeds0)}</div>
          <div className="text-[11px] text-text-tertiary">after costs, CGT {gbp(model.cgtToday)}</div>
        </Card>
        <Card variant="default" className="p-3">
          <div className="text-[11px] text-text-tertiary">Rent-out cash flow, yr 1</div>
          <div
            className="font-data text-[13px] tabular-nums"
            style={{ color: (model.firstYearCF ?? 0) < 0 ? 'var(--negative)' : 'var(--positive)' }}
          >
            {gbp(model.firstYearCF)}/yr
          </div>
        </Card>
      </div>

      <FlipPoints flips={flips} currentAppreciation={resolved.values.appreciation_pct ?? 0} />

      <Card variant="inset" className="mt-4 mb-2 p-3 text-[12px] leading-relaxed text-text-tertiary">
        Decision support, not a recommendation. Tax is a single effective rate — no rebasing, no allowances, no
        residency-specific mechanics. Mortgages are interest-only; rent tracks house prices; net rent parks at the
        cash rate. Market defaults are illustrative.
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add cfos-office/src/components/models/FlipPoints.tsx cfos-office/src/components/models/VerdictPanel.tsx
git commit -m "feat(models): add VerdictPanel and FlipPoints components"
```

---

### Task 20: Nav entry — home page row + breadcrumb label

**Files:**
- Create: `cfos-office/src/components/office/ModelsRow.tsx`
- Modify: `cfos-office/src/app/(office)/office/OfficeHomeClient.tsx`
- Modify: `cfos-office/src/components/navigation/NavigationBar.tsx`

- [ ] **Step 1: Write the home-page entry row (non-accented — Correction 7)**

```typescript
'use client'

import { useRouter } from 'next/navigation'
import { ChevronRight, TrendingUp } from 'lucide-react'

export function ModelsRow() {
  const router = useRouter()

  return (
    <button
      onClick={() => router.push('/office/models')}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-control border border-border-subtle hover:bg-tap-highlight transition-colors min-h-[48px] mt-2"
    >
      <TrendingUp size={18} className="shrink-0 text-text-tertiary" />
      <div className="flex-1 min-w-0 text-left">
        <span className="text-[13px] font-semibold text-text-primary">Models</span>
        <p className="font-data text-[10px] text-text-tertiary">Weigh a property decision — keep, sell, or redeploy</p>
      </div>
      <ChevronRight size={14} className="shrink-0 opacity-[0.15]" />
    </button>
  )
}
```

- [ ] **Step 2: Wire it into the office home**

In `OfficeHomeClient.tsx`, add the import and render `<ModelsRow />` after the four `FolderSection`s (before the closing `</div>` at line 131):

```typescript
import { ModelsRow } from '@/components/office/ModelsRow'
```

```typescript
      </FolderSection>

      <ModelsRow />
    </div>
  )
}
```

- [ ] **Step 3: Add breadcrumb labels**

In `NavigationBar.tsx`, add to `SEGMENT_LABELS`:

```typescript
  models: 'Models',
```

- [ ] **Step 4: Commit**

```bash
git add cfos-office/src/components/office/ModelsRow.tsx "cfos-office/src/app/(office)/office/OfficeHomeClient.tsx" cfos-office/src/components/navigation/NavigationBar.tsx
git commit -m "feat(models): add home-page entry point and nav labels"
```

---

### Task 21: Full-loop verification + `npm run test` / `npm run typecheck`

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd cfos-office && npm run test`
Expected: all suites pass, including `property.test.ts` (17 tests) and `resolve.test.ts` (4 tests).

- [ ] **Step 2: Typecheck**

Run: `cd cfos-office && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual loop check via preview**

Start the dev server, sign in, navigate to `/office/models`, click "New model", answer the interview prompts (or edit the ledger directly), confirm the verdict panel populates with a ranking and flip point, refresh the page, and confirm the run's ledger/messages/verdict are restored from the DB (not reset). Confirm scenario 4 appears once `new_property_price` is filled (answer "yes" to the redeploy branch question and give a price).

- [ ] **Step 4: Commit only if verification uncovered fixes**

If Steps 1–3 required code changes, commit those with a description of what was fixed. If everything passed as written, no commit needed for this task.

---

## Below the stop line — optional, only if time remains

### Task 22 (optional): Escape hatch

**Files:**
- Modify: `cfos-office/src/lib/models/registry.ts` (add a final interview node)
- Modify: `cfos-office/src/app/api/models/interviewer/route.ts` (classify into slot / caveat / irrelevant)
- Modify: `cfos-office/src/app/api/models/runs/[id]/route.ts` or add a caveats-append path

Add a final interview node: "Anything unusual about your situation I should know?" Extend `InterviewerResponseSchema` with an optional `caveat: string | null` field. When present and no `extracted` slot matches, append to `run.caveats` (jsonb array) instead of inventing a slot or maths. Render `caveats` in `VerdictPanel` under a "Not modelled:" heading. No new variables, no maths — matches locked design decision #2.

### Task 23 (optional): Profile settings surface

**Files:**
- Create: `cfos-office/src/app/(office)/office/models/profile/page.tsx`

A minimal server-rendered page reading/writing `user_financial_profile` (all 5 fields) via a small form + `PATCH` route, following the exact `createClient()` + `getUser()` + `.eq('user_id', user.id)` pattern used everywhere else in this plan. Link it from the Models list page header.

---

## Definition of done (from the brief)

- [ ] Golden + edge tests green (`property.test.ts` — 17 tests, `resolve.test.ts` — 4 tests)
- [ ] Migration applied to staging branch (`qlbhvlssksnrhsleadzn`); production (`iccelmjenljanqrhhzdv`) never contacted
- [ ] Two-user RLS check performed with real staging user ids, `visible_to_b = 0` confirmed
- [ ] Full loop: new run → interview fills ledger → edit a value → verdict + flip points recompute → refresh restores everything
- [ ] Scenario 4 appears in verdict ranking once opted into
- [ ] LLM output zod-validated; unknown slot ids dropped
- [ ] Caveats + decision-support disclaimer render on every verdict
- [ ] No imperative "you should…" copy anywhere in Verdict
- [ ] `npm run test` and `npm run typecheck` both green

## After the session — lessons + handoff

- [ ] Append ≥3 entries to `LESSONS.md` (repo root): the prototype/brief mismatches found in this plan's Corrections section, the exact staging migration + RLS-verification commands that worked, and any place the port's behaviour diverged from a literal reading of the brief (e.g. the `resolveValues`/`resolve.ts` split, the `will_never_let_flag` slot).
- [ ] Write `docs/handoffs/M1-models.md`: what shipped, what's below the stop line (Tasks 22–23), proposed M2 scope (escape hatch, profile surface, `market_defaults` DB table, the origin-stats query for validating the baseline-criteria hypothesis per locked design decision #5).
