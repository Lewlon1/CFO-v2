# Session 14 — Phase 0 Audit (Folder Reframes, Basic)

**Investigation date:** 2026-05-15
**Branch:** `feature/goal-aware-office` (third and final session before combined PR — runs after Sessions 11 + 12)
**Constitution version on disk:** v1.3 (Session 12). Voice rules in §2; goal-awareness in §3; no-goal canonical exchange in §9.I.

## Folder card subtitle state (post-Session-11)

All five folder cards live in [`OfficeHomeClient.tsx`](../cfos-office/src/app/(office)/office/OfficeHomeClient.tsx). Every folder passes a `subtitle` prop into the shared `<FolderSection>` wrapper, which renders it under the label.

| Folder | Subtitle (current) | Source line | Real data on props |
|---|---|---|---|
| Goals | `goalsSubtitle` IIFE — `'Not yet set'` / `${name}` / `${name} · ${pct}%` | 49–55, used at 65 | `primaryGoal: PrimaryGoal \| null` |
| Cash Flow | `${monthLabel} · ${count} transactions` (inline template) | 75 | `summary?.surplus_deficit`, `summary?.month`, `summary?.transaction_count` (from `useDashboardData()`) |
| Values & You | `${archetype?.archetype_name ?? 'Not yet profiled'} · ${Math.round(profileCompleteness)}% profiled` | 90 | `archetype.archetype_name`, `profileCompleteness` |
| Net Worth | `"The big picture"` (static string) | 106 | `totalAssets`, `totalLiabilities` |
| Scenario Planning | `"What if..."` (static string) | 121 | `nextTrip` (only used by ScenariosSection internal rendering) |

**Goals subtitle is goal-aware already (Session 11).** Session 14 leaves it untouched. The other four are either generic month/count, profile-state, or static placeholder strings — none reference the primary goal.

## Goal-state helper (the prop is already wired)

`OfficeHomeClient` already imports `PrimaryGoal` (line 14) and receives `primaryGoal: PrimaryGoal | null` as a prop (line 26). Session 11 plumbed this in for the Goals card. Session 14 reuses the same prop for the four new subtitles — no additional fetch, no new wiring, no risk of drift between surfaces.

`getPrimaryGoal` itself lives at [`cfos-office/src/lib/goals/primary-goal.ts:41-62`](../cfos-office/src/lib/goals/primary-goal.ts) and returns `PrimaryGoal | null`. Session 12's chat-context emits the explicit `"No active goal set."` marker when null. Session 14's UI fallback rule is the inverse of "explicit marker": **silent neutral copy** — no `your goal` reference, no nag. Per the spec: the no-goal prompt is already carried by the Goals card itself and Session 12's CFO behaviour; the four other folders don't pile on.

## Accent colour application (post-Session-11)

| Folder | Token in `tokens.ts` | Applied via | Hex |
|---|---|---|---|
| Goals | `folderColors.goals` (line 44) | **Token reference** at OfficeHomeClient:66 | `#D4A24C` |
| Cash Flow | `folderColors.cashflow` (line 45) | **Inline hex** at OfficeHomeClient:76 | `#22C55E` |
| Values | `folderColors.values` (line 46) | **Inline hex** at OfficeHomeClient:91 | `#E8A84C` |
| Net Worth | `folderColors.networth` (line 47) | **Inline hex** at OfficeHomeClient:107 | `#06B6D4` |
| Scenarios | `folderColors.scenarios` (line 48) | **Inline hex** at OfficeHomeClient:122 | `#F43F5E` |

**Drift:** All five tokens exist in [`tokens.ts:43-49`](../cfos-office/src/lib/tokens.ts), but only Goals references the token. The four originals are still hardcoded inline at the Section 11/12 cutover. Phase 1 migrates them to `folderColors.*` — DRY cleanup, no functional change (values are identical).

## Theme awareness

Folder accents are **single-value, not theme-aware**. `globals.css` exposes theme-aware tokens for things like `--positive`, `--accent-cyan`, etc., but `folderColors` is a flat hex object — accents look the same in light and dark mode, by design. Folder identity is preserved across themes.

## Goals vs Values numerical proximity — VISUAL VERDICT (Phase 1.2)

- Values: `#E8A84C` — RGB(232, 168, 76)
- Goals (provisional Session 11): `#D4A24C` — RGB(212, 162, 76)
- Same hue (37°), Goals 19% lower saturation and 4% lower lightness.

**Side-by-side rendering confirmed: too close.** Both read as the same warm gold/amber at a glance. The user would have to look closely to distinguish them. This was the failure mode the spec anticipated.

## Phase 1 candidate replacements — VERDICT

| Candidate | Hex | Outcome |
|---|---|---|
| **Deeper brass** | **`#9C7B2C`** | **PICKED.** Same hue family as Values, distinctly darker and less saturated. Reads as "the prime/anchor" without leaving the warm CFO palette. |
| Burnished bronze | `#A0673A` | Strong contender — distinctly red-brown, but starts to feel like a different palette tone |
| Walnut accent | `#8B5E34` | Even more anchored, but darker than necessary; trades distinctness for gravity |
| Antique gold | `#B8862B` | Too close to amber under casual viewing — same problem as the original |

**Final Goals accent: `#9C7B2C`** (deeper brass). Verified distinct from Values in both light (`#F6F0E1` vellum) and dark (`#13110D`) themes. All five accents now visually distinct at-a-glance.

## Real data already on props (Phase 2 input)

| Folder | Field | Source |
|---|---|---|
| Cash Flow | `summary.surplus_deficit: number` | `useDashboardData()` → `DashboardSummary` |
| Net Worth | `totalAssets`, `totalLiabilities` (numbers) | Server-side fetch in [`page.tsx`](../cfos-office/src/app/(office)/office/page.tsx) |
| Values | `archetype.archetype_name: string \| null`, `profileCompleteness: number` | Server-side fetch in `page.tsx` |
| Scenarios | (no real-data figure used in subtitle — qualitative copy only) | n/a |

The Cash Flow surplus is the most consequential real number for the goal-aware framing — it's literally the surplus that feeds the goal. Net Worth and Values get their goal connection through framing rather than additional figures.

## Out of scope reminder (Sessions 11/12 own — do not touch)

- `goalsSubtitle` IIFE (OfficeHomeClient:49-55) — Session 11 owns
- `<GoalsSection>` and `<GoalsEmptyState>` (sections directory) — Session 11 owns
- Constitution v1.3 — Session 12 wrote it, Session 14 only reads it
- `getPrimaryGoal` itself, `context-builder.ts`, `BASE_PERSONA` — Session 12 owns
- §9 prompt harness — Session 12 verified 9/9
- Folder *internals* (what's inside each folder, the order of items, click behaviour) — Session 15 (data-deep) territory
