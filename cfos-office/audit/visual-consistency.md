# Visual Consistency Audit

**Run date:** 2026-05-29
**Branch:** `claude/visual-consistency-audit`
**Author:** Claude (Visual Consistency, Phase 0)
**Purpose:** Extend the v2.5 colour-only finding ([`audit/v2.5-component-reuse.md`](v2.5-component-reuse.md) Q3) into a full visual-consistency audit — colour + spacing + radii + typography + primitive/state coverage. **Identification only.** No tokens changed, no drift fixed, no `UI-DIRECTION.md` edits. Feeds the Phase-1 token-consolidation session and seeds the dev-only `/styleguide` regression surface.

> Scope note: this audit reads `tokens.ts`, `globals.css`, `dashboard.ts`, `value-map/constants.ts`, `UI-DIRECTION.md`, the primitives and the office molecules as **inspect-only**. Where it says "stale" or "bug", that is a finding to action in Phase 1+, not something touched here.

---

## Headline counts

Battery run from `cfos-office/`, over `src` (**556** `.ts`/`.tsx` files). Hex/rgba counts exclude the two files allowed to define colour (`tokens.ts`, `globals.css`).

| Metric | Count | Notes |
|---|---:|---|
| Raw hex sites | **197** | top: `api/balance-sheet/route.ts` (15), `dashboard/TrendChart.tsx` (12), `balance-sheet/NetWorthTrendChart.tsx` (12), `value-map/cut-or-keep.tsx` (10), `chat/LabelTransactionsBlock.tsx` (10), `constants/dashboard.ts` (9) |
| Raw rgba sites | **82** | top: `data/DataComponents.tsx` (14), `office/OfficeMonthlyOverview.tsx` (13), `office/OfficeValuesBreakdown.tsx` (10), `office/goals/GoalCard.tsx` (7) |
| Arbitrary TW colour brackets `…-[#` | **37** | |
| Arbitrary spacing/size brackets `…-[N…]` | **260** | top: `upload/HoldingsPreview.tsx` (27), `office/OfficeMonthlyOverview.tsx` (15), `data/DataComponents.tsx` (11), `chat/StructuredInput.tsx` (11), `bills/BillUploadModal.tsx` (11) |
| Arbitrary type/radius brackets `(text\|leading\|tracking\|rounded)-[` | **382** | |
| `var(--…)` arbitrary-bracket reads | **42** | |
| Inline `style={{` | **224** | |
| Distinct `text-[Npx]` sizes | **30** | 7px → 76px, incl. 13.5 / 9.5 / 14.5 / 10.5px |
| Distinct `rounded-[…]` radii | **11** | 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12px + 1 compound |
| Distinct `leading-[]` / `tracking-[]` | 14 / 11 | |
| Files importing `@/components/ui` | **12** | `Button` is the only export |

**One-line read:** ~280 hardcoded colour literals, ~640 arbitrary spacing/type brackets, zero spacing/radii/type token scales, one shared UI primitive — and the nominal source of truth (`tokens.ts`) plus the reference doc (`UI-DIRECTION.md`) are a full palette generation behind the shipped CSS.

---

## Q1 — Token delivery mechanics

Tokens reach components by **three coexisting mechanisms**:

1. **Generated Tailwind utilities via `@theme inline`** — `globals.css:152–213` maps `--color-*` → the raw `--*` vars, producing utilities like `bg-bg-base`, `text-text-primary`, `text-text-tertiary`, `bg-positive`, `border-border`, `bg-primary`. This is the modern, theme-aware, type-checked path. `Button` and `DrillDownRow` use it. Not directly grep-countable (they read as ordinary utilities), but present and correct where adopted.
2. **Inline `style={{}}` — 224 sites (dominant).** Two flavours: **(a) var-read** — `style={{ color: 'var(--text-primary)' }}` (`MetricTile` trend, `Briefing`); **(b) hardcoded literal** — `style={{ color: color || '#F5F5F0' }}` (`MetricTile`), `background: 'rgba(255,255,255,0.025)'` (`Briefing`). Flavour (b) is the drift engine.
3. **Arbitrary `var()` bracket reads — 42 sites.** `bg-[var(--office-bg)]`, `hover:bg-[rgba(255,255,255,0.03)]` (`DrillDownRow`). A bridge between (1) and (2).

**Ratio — inline-style : var-bracket-read ≈ 224 : 42 ≈ 5.3 : 1.** Inline style dominates, and a large share of it carries raw literals (the 197 hex + 82 rgba live overwhelmingly inside `style={{}}` and `-[#…]` brackets).

**The Phase-1 fork (stated, not decided here):**

- **(A) `@theme`-generated utilities** — type-safe, themeable, already wired; right for all static cases.
- **(B) `var(--…)` reads** — needed only where a value is computed at runtime (chart series, dynamic accent passed as a prop).

Whatever the ratification, the 197 hex / 82 rgba / 37 `-[#]` literals must migrate off inline literals. **Recommended lean for Phase 1:** utilities-first; `var()` reads for dynamic only; zero hardcoded literals in `style={{}}`.

**Sub-finding — `.dark` is static.** `layout.tsx` hard-codes `class="dark"` on `<html>`; `ThemeToggle` only flips the `data-theme` attribute (MutationObserver pattern in `components/theme/ThemeToggle.tsx`). The CSS-var layer themes correctly via `:root[data-theme="light"]`, but any `dark:`-prefixed utility will **not** respond to the toggle (the `.dark` class never leaves). Phase 1 should grep for `dark:` utility usage and confirm none depends on the toggle.

---

## Q2 — Colour source-of-truth reconciliation

There are **four colour-defining files** plus the **declared doc**, and they split into two palette generations:

- **"Grey gen" (stale):** `tokens.ts` + `UI-DIRECTION.md` — pure greys: bg `#0F0F0D`, text `#F5F5F0`, white-alpha borders.
- **"Walnut gen" (shipped):** `globals.css` + `layout.tsx` — walnut/vellum: bg `#13110D`, text `#F4EDD9`, vellum-alpha borders.

`globals.css` is what ships. **`tokens.ts` — whose own header reads "Single source of truth. Import from here, never hardcode." — is stale for every neutral.** The walnut retheme landed in `globals.css` and was never propagated back to `tokens.ts` or `UI-DIRECTION.md`. `tokens.ts` is also single-value (no theme awareness), so anything importing `colors.bgBase` gets dark grey **in both themes** — a light-mode correctness bug.

### Matrix A — base palette (dark theme)

| Token | `tokens.ts` | `globals.css` `:root` | `UI-DIRECTION.md` | Agree? |
|---|---|---|---|---|
| bg-base | `#0F0F0D` | `#13110D` | `#0F0F0D` | ✗ globals differs (walnut) |
| bg-elevated | `#111110` | `#1A1610` | `#111110` | ✗ globals differs |
| text-primary | `#F5F5F0` | `#F4EDD9` | `#F5F5F0` | ✗ globals differs (vellum) |
| text-secondary | `rgba(245,245,240,.55)` | `rgba(244,237,217,.55)` | `rgba(245,245,240,.55)` | ✗ base hue differs |
| border-subtle | `rgba(255,255,255,.04)` | `rgba(244,237,217,.04)` | `rgba(255,255,255,.04)` | ✗ white vs vellum |
| accent-gold (dark) | `#E8A84C` | `#E8A84C` | `#E8A84C` | ✓ |
| positive | `#22C55E` | `#22C55E` | `#22C55E` | ✓ |
| negative | `#F43F5E` | `#F43F5E` | `#F43F5E` | ✓ |
| info | `#3B82F6` | `#3B82F6` | `#3B82F6` | ✓ |
| cyan | `#06B6D4` | `#06B6D4` | `#06B6D4` | ✓ |
| purple | `#8B5CF6` (`colors.purple`) | `#9C8B7A` (`--accent-purple`) | `#9C8B7A` | ✗ `colors.purple` is the retired violet |

`tokens.ts` agrees with the shipped CSS **only on the saturated semantics** (gold-dark, positive, negative, info, cyan). Every neutral disagrees. `colors.purple = #8B5CF6` is the old Burden violet that v2.5 already retired to `#9C8B7A` everywhere else.

### Matrix B — folder palette

| Folder | `tokens.ts` `folderColors` | `globals.css` var | `UI-DIRECTION` | Agree? |
|---|---|---|---|---|
| goals | `#9C7B2C` | *(no var)* | `#9C7B2C` | ⚠ value-correct, **no CSS var** |
| cashflow | `#22C55E` | *(no var)* | `#22C55E` | ⚠ no CSS var |
| values | `#7C4D9E` | `--folder-values: #7C4D9E` | `#7C4D9E` | ✓ (only one with a var) |
| networth | `#06B6D4` | *(no var)* | `#06B6D4` | ⚠ no CSS var |

**Folder count = 4, not 5.** (Session plan said "five `folderColors`"; Scenarios was dropped in v2.5 — reality is four.) Only `--folder-values` exists as a CSS var; goals/cashflow/networth live **only** in `tokens.ts` JS, so a component wanting them must import JS — it can't `var()` them. Delivery is split.

### Matrix C — value categories — **THE INVERSION**

| Category | `tokens.ts` `valueCategories` | `globals.css` (semantic) | `dashboard.ts` `VALUE_COLORS` | `value-map` `QUADRANTS` | `UI-DIRECTION` |
|---|---|---|---|---|---|
| **foundation** | **`#22C55E` GREEN** | `--positive #22C55E` (green) | **blue** (`bg-blue-500/10`,`text-blue-400`) | **`#4A90D9` BLUE** | `#22C55E` green |
| **investment** | **`#3B82F6` BLUE** | `--info #3B82F6` (blue) | **green** (`bg-emerald-500/10`,`text-emerald-400`) | **`#48BB78` GREEN** | `#3B82F6` blue |
| leak | `#F43F5E` rose | `--negative #F43F5E` | `red-500/400` (`#EF4444`) | `#E53E3E` vermilion | `#F43F5E` |
| burden | `#9C8B7A` warm grey | `--accent-purple #9C8B7A` | `stone-500/400` (≈`#78716C`) | `#9C8B7A` | `#9C8B7A` |
| unsure / "no idea" | `rgba(232,168,76,.5)` gold, dashed | *(none)* | `gray-500/400` | *(no quadrant)* | `#9CA3AF` |

> **🔴 CONFIRMED BUG — Foundation and Investment are INVERTED between the token layer and the shipped UI.**
>
> - **Declared / token layer** (`tokens.ts` + `globals.css` semantic + `UI-DIRECTION`): **Foundation = GREEN, Investment = BLUE.**
> - **Shipped UI** (`dashboard.ts VALUE_COLORS` + `value-map/constants.ts QUADRANTS`): **Foundation = BLUE, Investment = GREEN.**
>
> **Open UX question — answered.** *Does the Value-Map quadrant render Foundation green or blue?* → **BLUE** (`QUADRANTS.foundation = #4A90D9`), with Investment GREEN (`#48BB78`). The dashboard badges agree (blue/green). **The product the user actually sees says Foundation is blue.** `tokens.ts` / `globals.css` / `UI-DIRECTION` (green) are the inverted, stale side. First logged as v2.5 BACKLOG #8; still open.

Secondary disagreements on the same row set:

- **leak** — three reds: tokens `#F43F5E` (rose), value-map `#E53E3E` (vermilion), dashboard Tailwind `red-500` (`#EF4444`). Same family, three values.
- **burden** — tokens **=** value-map (`#9C8B7A`) ✓ (v2.5 fix landed); dashboard uses Tailwind `stone-*` (≈`#78716C`) — close family, not the token. Down from the v2.5 four-way split to a one-file outlier.
- **unsure** — four treatments: tokens gold-dashed, dashboard grey, value-map absent, UI-DIRECTION `#9CA3AF`.

### A fifth palette — `dashboard.ts CATEGORY_COLORS`

Traditional-category → hex map mirroring DB `categories.color`: `primary #3B82F6`, `success #10B981`, `blue #6366F1`, `gold #F59E0B`, `orange #F97316`, `teal #14B8A6`, `purple #9C8B7A`, `warning #EAB308`, `pink #EC4899`. Note `success #10B981` ≠ semantic `positive #22C55E`; `gold #F59E0B` ≠ accent `gold #E8A84C`. DB-coupled (distinct concern) but semantically overlapping — flag for Phase 1 awareness, not necessarily Phase-1 migration.

### Offender clusters

Charts are the biggest raw-hex cluster (Recharts takes literal colour props): `TrendChart` (12), `NetWorthTrendChart` (12), `ValuesTrendChart` (7), `SpendingChart` (5). Server route `api/balance-sheet/route.ts` (15) hardcodes folder/value hexes for response payloads.

### Decision flagged for Lewis (D1) — inversion direction

The data points one way: **align the token layer to shipped reality (Foundation = blue, Investment = green).** Flipping the shipped value-map + dashboard instead would change live UX (the quadrant colours users already see in the demo). Recommended Phase-1 move: introduce real `--value-foundation` / `--value-investment` / `--value-leak` / `--value-burden` CSS vars, point them at the shipped blue/green, and migrate all four files onto them. Lewis still picks the canonical hue pair — value-map blue `#4A90D9` vs info blue `#3B82F6`; value-map green `#48BB78` vs positive green `#22C55E`.

---

## Q3 — Spacing & radii

**No encoded scale exists.** `globals.css` defines **zero** `--space-*`, `--gap-*`, or `--radius-*` tokens (the only spacing-ish vars are the four `--animate-*` keyframe hooks). `UI-DIRECTION.md` *documents* a scale in prose — `card-radius 14px`, `radius-md 10px`, `radius-sm 8px`, `radius-pill 16–20px`; `gap-tight 3–4px`, `gap-normal 6px`, `gap-section 24px`, `gap-chat 10px`; `tap-min 44px` — but it is never encoded, so components freehand it.

- **260 arbitrary spacing/size brackets.** Top 10: `HoldingsPreview` (27), `OfficeMonthlyOverview` (15), `DataComponents` (11), `StructuredInput` (11), `BillUploadModal` (11), `DataManagement` (10), `ChatSheet` (9), `NetWorthDashboard` (8), `GoalCard` (8), `TransactionPreview` (7).
- **11 distinct `rounded-[…]` radii:** 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12px + the compound `4px_14px_14px_14px` (the folder-tab shape from UI-DIRECTION). Top: `10px` (19), `8px` (9), `6px` (5), `4px` (5). Clusters loosely around UI-DIRECTION's 8/10/14 but with 2.5/3/5/6/7 noise.
- Distinct spacing px values (gap/p/m): `px-14` (8), `mt-2` (7), `mb-10` (6), `py-10`/`px-10` (5), `gap-3` (5), … — no consistent rhythm.

**Phase-1 need:** a radii token scale (proposed `--radius-sm/md/lg/pill` = 8/10/14/999) and a spacing scale, then migrate the 260 sites. Confirmed: **no scale exists today.**

---

## Q4 — Typography

**Fonts actually loaded** (`layout.tsx`, `next/font/google`): **Instrument Serif** (`--font-instrument-serif`, w400, normal+italic), **Instrument Sans** (`--font-instrument-sans`), **Geist Mono** (`--font-geist-mono`).

Roles in shipped CSS:

- **Serif (Instrument Serif):** `h1–h3` default (`globals.css:308`), `.v4-serif`.
- **Sans (Instrument Sans):** body (`globals.css:296`), `--font-ui`.
- **Mono (Geist Mono):** `.eyebrow`, `.v4-eyebrow`, `.v4-mono`, `--font-data`.

**Four stale / broken font references (drift):**

1. **`tokens.ts fonts`** declares `body: 'DM Sans'`, `mono: 'JetBrains Mono'`, `logo: 'Cormorant Garamond'` — **none are loaded.** Dead export.
2. **`UI-DIRECTION.md`** declares `--font-body: 'DM Sans'`, `--font-mono: 'JetBrains Mono'` — stale; matches `tokens.ts`, not reality.
3. **`globals.css` `--font-data` / `--font-ui` fallback chains** reference `--font-jetbrains-mono` / `--font-dm-sans`, which `layout.tsx` never defines → they always fall back to Geist / Instrument. Harmless but misleading.
4. **`Briefing.tsx` sets `fontFamily: 'var(--font-cormorant), Georgia, serif'`** — `--font-cormorant` is **never defined** → the office briefing prose silently renders in **Georgia**. **Real visible bug** (a load-bearing molecule, used by all dashboards).

**No encoded type scale.** `UI-DIRECTION` documents an 11-step scale (`xl 20/800` → `nano 7/mono`). Reality: **30 distinct `text-[Npx]` sizes** from 7px to 76px, including half-pixels (13.5, 9.5, 14.5, 10.5px). Distribution:

| size | count | | size | count |
|---|---:|---|---|---:|
| `11px` | 69 | | `9px` | 14 |
| `10px` | 55 | | `8px` | 13 |
| `13px` | 44 | | `16px` | 13 |
| `12px` | 31 | | `18px` | 10 |
| `15px` | 20 | | …20 more | ≤9 each |

Plus **14 distinct `leading-[]`** (1.04 → 1.7) and **11 distinct `tracking-[]`**. The declared scale and the implemented sizes have fully diverged into free text.

**Phase-1 need:** encode the type scale as utilities/tokens; reconcile the font story (drop the DM Sans / JetBrains / Cormorant references, or actually load them); fix the `Briefing` `--font-cormorant` → `--font-instrument-serif` bug.

---

## Q5 — Primitive coverage

- **Exactly one real shared UI primitive: `ui/button.tsx`.** Variants `default | outline | ghost | link`; sizes `default | sm | lg | icon`. Uses `@theme` utilities correctly (`bg-primary`, `ring-ring`, `border-border`). **No `destructive` / `secondary` variant, no loading state, no `asChild`/Slot.** 12 files import it.
- **Office dashboard molecules (well-adopted — confirmed by v2.5 audit Q1):** `Briefing`, `DetailHeader`, `DrillDownRow`, `DashboardEmptyState`, shared across `CashFlowDashboard` / `NetWorthDashboard` / `ValuesDashboard`.
- **Dead `data/` layer:** `MetricTile`, `ValuePill`, `FolderCard` (+ `FolderMetric`) — **zero consumers outside the `data/` barrel.** (The *other* `DataComponents.tsx` exports — `MonthSelector`, `CategoryBar`, `TransactionRow`, `FilterPills`, `ProvenanceLine`, `FileRow`, `GapCard`, `SectionTitle` — **are** consumed by `TheGapClient` + `OfficeTransactionsClient`, so `DataComponents` itself is live; the three named primitives are dead.) Confirms v2.5 BACKLOG #9. *(After this session the dev-only `/styleguide` imports them for display — that is a regression surface, not a production consumer; the dead-code status stands.)*
- **EmptyState sprawl — 5 implementations, not 3.** `office/dashboards/DashboardEmptyState` (props-driven, office tokens), `dashboard/EmptyState` (variant prop `no_data|no_values`, shadcn tokens), `balance-sheet/EmptyState` (chat-context, `onUploadClick`), `office/sections/GoalsEmptyState`, `office/goals/GoalsEmptyStateCTA`. Two export the *same* name (`EmptyState`). (Plan said "3 competing"; reality is 5 — 3 core + 2 Goals variants.)

**Missing for Phase 1 (no shared primitive exists):** `Card`, `Badge`/`Pill`, `Heading`/`Text` (type), `Input`/`Textarea`, `Dialog`/`Sheet`, `Toast`. These are reimplemented inline everywhere — e.g. every EmptyState rolls its own button markup (`rounded-md bg-primary … px-5 py-2.5`) instead of using `Button`.

---

## Q6 — State coverage gaps

Read-only scan (not exhaustive):

| Surface | hover | focus-visible | disabled | active/pressed | loading | error |
|---|---|---|---|---|---|---|
| `Button` | ✓ per variant | ✓ `ring-2 ring-ring` | ✓ `opacity-50` + `pointer-events-none` | ✗ | ✗ | n/a |
| `DrillDownRow` (Link) | ✓ + `active:` | ✗ (browser default) | n/a | ✓ | n/a | n/a |
| `DetailHeader` back btn | ✗ | ✗ | n/a | ✗ | n/a | n/a |
| `DashboardEmptyState` action | ✗ | ✗ | n/a | ✗ | ✗ | ✗ |
| `dashboard/EmptyState` btns | ✓ (secondary) | ✗ | n/a | ✗ | ✗ | ✗ |

Patterns:

- **No shared focus-visible convention** outside `Button` — most interactive Links/buttons rely on browser defaults (fails the "every tappable" rigour UI-DIRECTION implies).
- **No `active`/pressed treatment on `Button`**, despite UI-DIRECTION's rule "tap states use background shift, not opacity."
- **No `loading` primitive and no `error` primitive** — both are ad-hoc per surface.
- Empty states diverge on whether their CTA even has a hover.

Phase 1 should define a hover / focus-visible / disabled / active / loading / empty / error **matrix** and bake it into the primitive layer.

---

## Q7 — Scoped exceptions (intentional — NOT drift)

**`(public)/v4/v4.css`** is deliberately scoped under `.landing-v4` and **bridges** its `--paper / --ink / --rule / --card / --accent` aliases to the **global** tokens (`var(--background)`, `var(--foreground)`, `var(--primary)`, …) — so it inherits the canonical palette rather than forking it. The only raw hex is the `.v4-invert` always-dark callout (`#1A1610` / `#F4EDD9` / `#E8A84C`), documented inline as an intentional contrast pin (keeps brass ≈9:1 regardless of active theme). Its font utilities (`.v4-serif/sans/mono`) correctly target the loaded Instrument / Geist families. **Out of scope. Intentional. Do not flag.** Ironically, v4 is the most token-correct surface in the app.

---

## Verdict + prioritised Phase-1 fix list

**Verdict.** The design system is real but half-adopted — and the nominal source of truth (`tokens.ts`) and reference doc (`UI-DIRECTION.md`) are a full palette generation behind the shipped CSS (`globals.css`). Five colour-defining surfaces; no spacing / radii / type token scales; ~280 hardcoded colour literals; ~640 arbitrary spacing/type brackets; exactly one shared UI primitive; a confirmed Foundation/Investment inversion the user can see. The good news: `globals.css` + the `@theme` layer already provide a correct, themeable utility surface — **Phase 1 is mostly consolidation onto what already works, not green-field.**

**Phase-1 fix list (priority order):**

1. **Pick ONE colour source of truth.** Recommend the `globals.css` CSS-var layer (shipped, theme-aware) as canonical; regenerate `tokens.ts` *from* it or replace `colors`/`folderColors` exports with var reads. Delete the grey gen.
2. **Resolve the Foundation/Investment inversion** (decision **D1**, Lewis) — align to shipped blue/green; add `--value-*` vars; migrate `dashboard.ts` + `value-map/constants.ts` + `tokens.ts`.
3. **Add the missing token scales** — radii (8/10/14/pill), spacing, and the type scale (encode UI-DIRECTION's 11 steps as utilities); then migrate the 260 spacing + 382 type brackets.
4. **Fix the font story** — drop dead `DM Sans`/`JetBrains Mono`/`Cormorant Garamond` references (or load them); fix `Briefing`'s `--font-cormorant` → `--font-instrument-serif`.
5. **Finish the primitive layer to demand** (≥3-consumer rule): `Card`, `Badge`, `Heading`/`Text`, `Input`, `Dialog`, `Toast`; add `Button` loading + active states.
6. **Delete dead `data/` primitives** (`MetricTile`, `ValuePill`, `FolderCard`/`FolderMetric`).
7. **Collapse the EmptyState set** (5 → 1 parametrised primitive).
8. **Update `UI-DIRECTION.md` to shipped reality** — walnut palette, Instrument/Geist fonts, dual-theme (it currently says "dark theme only — no light mode planned for v1", but a full light theme ships).
9. **(Stretch) ESLint ban** on raw hex / arbitrary colour brackets once 1–8 land (Phase 4 in the roadmap).

**Decisions handed to Lewis:**

- **D1 — Inversion direction.** Foundation = blue / Investment = green (shipped) vs green / blue (declared). **Recommend: align to shipped.** Pick the canonical hue pair.
- **D2 — Token-delivery fork.** `@theme`-generated utilities (recommend — static cases) vs `var(--…)` reads (dynamic only). Eliminate hardcoded `style={{}}` literals under either.

---

## Appendix — battery commands (as run)

Run from `cfos-office/`. Two corrections vs. the session plan's draft: **(1)** zsh requires the `--include` globs to be **quoted** (`--include='*.tsx'`) or it aborts with `no matches found`; **(2)** prefix the script with `unsetopt nomatch` for safety. Counts above are reproducible with these.

```bash
grep -rnE "#[0-9a-fA-F]{3,8}\b" src --include='*.tsx' --include='*.ts' | grep -vE "tokens\.ts|globals\.css" | wc -l   # 197
grep -rnE "rgba?\(" src --include='*.tsx' --include='*.ts' | grep -vE "tokens\.ts|globals\.css" | wc -l               # 82
grep -rnE "(bg|text|border|ring|fill|stroke|from|to|via)-\[#" src --include='*.tsx' | wc -l                            # 37
grep -rnE "(w|h|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|top|left|right|bottom|max-w|max-h|min-h|min-w)-\[[0-9]" src --include='*.tsx' | wc -l   # 260
grep -rnE "(text|leading|tracking|rounded)-\[" src --include='*.tsx' | wc -l                                          # 382
grep -rnE "\[var\(--" src --include='*.tsx' | wc -l                                                                    # 42
grep -rnE "style=\{\{" src --include='*.tsx' | wc -l                                                                   # 224
```
