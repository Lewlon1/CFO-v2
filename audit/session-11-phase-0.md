# Session 11 — Phase 0 Audit (Home Goals Surface)

**Investigation date:** 2026-05-14
**Branch:** `feature/goal-aware-office` (shared with Sessions 12 + 14)

## Home structure

- Server page: `cfos-office/src/app/(office)/office/page.tsx` — runs 7-way `Promise.all` of parallel queries, then passes data to `<OnboardingBanner />` + `<OfficeHomeClient>`.
- Client renderer: `cfos-office/src/app/(office)/office/OfficeHomeClient.tsx` — four `<FolderSection>` cards in hardcoded JSX order (lines 49–106): Cash Flow (`$`, `#22C55E`), Values & You (`◈`, `#E8A84C`), Net Worth (`≡`, `#06B6D4`), Scenario Planning (`⊕`, `#F43F5E`). Order is determined by JSX position, not by any config or sort.
- Folder card shell: `cfos-office/src/components/office/FolderSection.tsx` — accepts `icon`, `label`, `subtitle`, `fileCount?`, `accentColor`, `openHref`, `children`. Renders the floating tab + body + open link with `color-mix()` accent tints applied via inline `style`.
- Section preview components live at `cfos-office/src/components/office/sections/*.tsx` and follow a 3-state pattern: loading skeleton, empty (CTA), data. Each accepts pre-fetched data as props.
- Chat bar: persistent in `(office)/layout.tsx:150` (`<ChatBar />`), sits above the main scroll area — not affected by this session.

## Goal/progress reads (Sessions 09/10 output)

- Table: `public.goals` — 14 columns; key fields `current_amount`, `target_amount`, `target_date`, `monthly_required_saving`, `on_track`, `priority` (TEXT, validated lowercase via `create-goal.ts:30` zod enum `['high', 'medium', 'low']`), `status`, `created_at`, `deleted_at`.
- Progress is kept fresh by `recomputeIfStale(supabase, userId, lastSyncedIso)` (`cfos-office/src/lib/goals/recompute.ts`) — fired in `(office)/layout.tsx:102–113` via Next `after()`, 30-min TTL. Recompute is non-blocking and runs after the response is sent.
- No `is_primary` flag exists on `goals`. No schema change is in scope for this session.
- **Primary-goal rule for Session 11:** sort active non-deleted goals by priority enum (`high < medium < low < null`) then by `created_at DESC`, take the first. Implemented as a single shared helper at `cfos-office/src/lib/goals/primary-goal.ts` so Session 12 can import the same signal for CFO prompt context — do not duplicate the check.
- "No goal" = zero rows where `status = 'active' AND deleted_at IS NULL`.

## Routing

- Existing detail view: `cfos-office/src/app/(office)/office/scenarios/goals/page.tsx` — lists active + completed goals via `<GoalCard>` (per-goal progress bar, contribution form, delete button) and `<GoalsEmptyStateCTA>` for the empty state. Session 11 links the new Goals folder card here directly; the route URL `/office/scenarios/goals` is unchanged. Session 14 may relocate.
- The existing `<GoalsEmptyStateCTA>` (`scenarios/goals/GoalsEmptyStateCTA.tsx`) sets chat input to `"I'd like to set a financial goal"` and opens the chat sheet. This is the established pattern for goal creation outside onboarding and is reused as-is on the home empty state — single source of truth.

## Microcopy / icon decisions (locked here so implementation doesn't relitigate)

- Folder icon: `◎` (concentric circles — matches the existing goals empty-state glyph at `scenarios/goals/page.tsx:28`).
- Folder accent: `#D4A24C` (provisional brass; Session 14 to validate the full five-colour palette and resolve any clash with Values' `#E8A84C`).
- No-goal subtitle: `"Not yet set"` (parity with Values' `"Not yet profiled"`).
- No-goal headline (in card body): `No goal set.`
- No-goal body line: `Your CFO can't advise on a destination you haven't named.`
- No-goal CTA label: `Chat with your CFO` (reused from `GoalsEmptyStateCTA`).
- Goal-exists subtitle: `${goal.name} · ${progressPct}%` (NaN-safe; falls back to just `${goal.name}` when `target_amount` is null or ≤0).
- Goal-exists body: `current` (large numeric, tabular-nums) `of target`, percentage right-aligned, then a secondary line with the on/off-track pill and `${monthly_required_saving}/mo needed` when present.

## Risks documented (not blocking — Session 12 may revisit)

- **R1 — First-render staleness window:** `recomputeIfStale` runs in `after()`, so the very first render after a long-idle session reads pre-recompute numbers. Constitution accepts up-to-one-session staleness; the Goals card is now the most visible surface where this will show. No fix in this session.
- **R2 — Priority laxness:** `goals.priority` is TEXT with no DB CHECK constraint. `create_goal` validates via zod enum (lowercase only), so the chat write path is safe; a direct DB write could insert anything. The `rankOf` function defaults unknown values to rank 3 (lowest) — defensive behaviour is correct.
- **R3 — Onboarding overlap:** users mid-onboarding see both `<OnboardingBanner>` at the top of the page and the no-goal card below. Two parallel surfaces to the same outcome. Not a bug; Session 12 owns the handoff polish.
- **R4 — Completed-only goals:** a user whose only goal is `status='completed'` sees the no-goal state on home. Intentional — the home card is for active intent. The detail view still lists completed goals under its own section.
- **R5 — Theme contrast:** light mode exists (`data-theme="light"` in `globals.css:81`). Verify `#D4A24C` text contrast in both modes during Phase 3 verification.

## Files Sessions 11 touches (manifest)

**New:**
- `cfos-office/src/lib/goals/primary-goal.ts`
- `cfos-office/src/lib/goals/primary-goal.test.ts`
- `cfos-office/src/components/office/sections/GoalsSection.tsx`
- `cfos-office/src/components/office/sections/GoalsEmptyState.tsx`
- `audit/session-11-phase-0.md` (this file)

**Modified:**
- `cfos-office/src/app/(office)/office/page.tsx`
- `cfos-office/src/app/(office)/office/OfficeHomeClient.tsx`
- `cfos-office/src/lib/tokens.ts` (extend `folderColors` only)
- `cfos-office/SESSION-LOG.md`

**Does NOT touch:** any prompt file, any of the four existing folders' internal content, any schema/migration, the Constitution, the existing `/office/scenarios/goals` route or its components (`GoalCard`, `GoalsEmptyStateCTA` are reused as-is).
