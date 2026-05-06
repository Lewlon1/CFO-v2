# UI-DIRECTION.md — The CFO's Office

> Reference file for Claude Code. Read this before any UI work.
> This is the single source of truth for visual language, component conventions, and interaction patterns.

---

## Identity

**Product:** The CFO's Office
**Metaphor:** Walking into a startup CFO's office for a chat about your personal finances. The interface is the office — folders on the desk, files in drawers, a CFO sitting across from you ready to talk.
**Platform:** Mobile-first (iPhone Safari is the launch target). Desktop is a later concern.
**Framework:** Next.js App Router, Tailwind CSS, Recharts for charts.

---

## Aesthetic Direction

**Dark, warm, monospaced authority.** Not a banking app. Not a budgeting toy. Think: a private terminal for someone who takes their money seriously but doesn't want to be lectured.

- Dark backgrounds with warm undertones (not cold blue-black)
- Amber/gold as the signature accent — the CFO's colour
- Monospaced type for data, humanist sans for prose
- Generous negative space; density only where data demands it
- No gradients, no gloss, no shadows heavier than `0.04` opacity
- Motion is subtle and purposeful — easing, not bouncing

**Anti-patterns to avoid:**
- Rounded-everything bubbly fintech aesthetic
- Neon colours or saturated gradients
- Card-heavy layouts with uniform spacing
- Generic dashboard grid with equal-weight tiles
- Skeleton loaders that feel clinical

---

## Colour Tokens

```
/* === Backgrounds === */
--bg-base:        #0F0F0D       /* Primary surface */
--bg-elevated:    #111110       /* Chat bar, modals, sheets */
--bg-card:        rgba(255,255,255,0.015)   /* Folder cards, content areas */
--bg-inset:       rgba(0,0,0,0.15)          /* Recessed panels inside cards */
--bg-deep:        rgba(0,0,0,0.2)           /* Metric tiles, sparkline bg */

/* === Text === */
--text-primary:   #F5F5F0       /* Headings, key numbers */
--text-secondary: rgba(245,245,240,0.55)    /* Body prose, chat messages */
--text-tertiary:  rgba(245,245,240,0.3)     /* Labels, subtitles */
--text-muted:     rgba(245,245,240,0.18)    /* Provenance lines, footnotes */
--text-ghost:     rgba(245,245,240,0.12)    /* Structural separators, dots */

/* === Accent — The CFO === */
--accent-gold:    #E8A84C       /* CFO avatar, send button, archetype badge */
--accent-gold-soft: rgba(232,168,76,0.5)    /* Confidence flags, muted gold text */
--accent-gold-bg: rgba(232,168,76,0.06)     /* Gold surface backgrounds */
--accent-gold-border: rgba(232,168,76,0.12) /* Gold dashed borders */

/* === Semantic — Financial === */
--positive:       #22C55E       /* Income, surplus, Foundation, aligned, online dot */
--negative:       #F43F5E       /* Spending (in context), Leak, misaligned, unread badge */
--info:           #3B82F6       /* Investment category, secondary charts */
--accent-cyan:    #06B6D4       /* Net Worth folder, balance sheet */
--accent-purple:  #8B5CF6       /* Burden category */

/* === Borders === */
--border-subtle:  rgba(255,255,255,0.04)    /* Card edges, dividers */
--border-medium:  rgba(255,255,255,0.06)    /* Input fields, suggestion pills */
--border-visible: rgba(255,255,255,0.07)    /* Active inputs */

/* === Interactive === */
--tap-highlight:  rgba(255,255,255,0.03)    /* Hover/tap state background */
```

### Folder Colours

Each folder has a signature colour used for its tab, icon, border-left, "Open" text, and child file accents:

| Folder            | Colour    | Token               |
|-------------------|-----------|----------------------|
| Cash Flow           | `#22C55E` | `--folder-cashflow`  |
| Financial Portrait  | `#E8A84C` | `--folder-portrait`  |
| Net Worth           | `#06B6D4` | `--folder-networth`  |
| Scenario Planning   | `#F43F5E` | `--folder-scenarios` |

### Value Category Colours

| Category    | Colour    | Usage                        |
|-------------|-----------|------------------------------|
| Foundation  | `#22C55E` | Bar segments, badges, labels |
| Investment  | `#3B82F6` | Bar segments, badges, labels |
| Leak        | `#F43F5E` | Bar segments, badges, labels |
| Burden      | `#8B5CF6` | Bar segments, badges, labels |
| No Idea     | `#9CA3AF` | Bar segments, badges, labels |

**"No Idea" intent:** This is not a passive bucket for uncategorised leftovers. It's an active awareness nudge. The user *should* be able to recall what they spent money on. "No Idea" names the gap honestly and surfaces items for the user to resolve. The UI should present No Idea items as questions to answer, not noise to ignore.

---

## Typography

```
/* === Font Stack === */
--font-body:  'DM Sans', sans-serif      /* All prose, headings, UI labels */
--font-mono:  'JetBrains Mono', monospace /* Numbers, data labels, provenance, timestamps, tags */

/* === Scale === */
--text-xl:    20px / weight 800 / tracking -0.03em   /* Page title ("The CFO's Office") */
--text-lg:    18px / weight 800 / tracking -0.02em   /* Folder detail heading */
--text-hero:  16px / weight 800 / tracking -0.03em   /* Metric values (euro1,640) — mono */
--text-md:    15px / weight 700                       /* Chat header name */
--text-body:  13px / weight 400 / line-height 1.55    /* Chat messages, file row labels */
--text-sm:    12px / weight 400-700                   /* Inbox preview, chat greeting */
--text-label: 11px / weight 600                       /* Suggestion pills, folder "Open" */
--text-xs:    10px                                    /* Folder subtitle, file type */
--text-tag:   9px / mono                              /* Provenance, timestamps, data labels */
--text-micro: 8px / mono                              /* Category bar labels, footnotes */
--text-nano:  7px / mono / uppercase / tracking 0.06em /* Gap status badges (ON TRACK / GAP) */
```

### Typography Rules

- **Numbers are always mono.** Currency amounts, percentages, dates, counts — all `--font-mono`.
- **Prose is always DM Sans.** Chat messages, descriptions, headings.
- **Never bold mono text** unless it's a primary metric value.
- **Letter-spacing on uppercase mono** is always `0.06em`.
- **Currency format:** `en-IE` locale, EUR, no decimals -> `euro1,640` not `euro1,640.00`.

---

## Spacing & Layout

```
/* === Page structure === */
--page-max-width: 430px         /* Mobile frame — centred on desktop */
--page-padding-x: 16-18px       /* Horizontal page margins */
--header-padding: 14px 18px 10px
--breadcrumb-height: 34px       /* min-height for tap target */

/* === Cards & Containers === */
--card-radius:    14px           /* Folder cards (with 4px top-left for tab shape) */
--card-padding:   14px
--radius-md:      10px           /* File rows, inbox, modals */
--radius-sm:      8px            /* Metric tiles, inset panels, archetype badge */
--radius-pill:    16-20px        /* Suggestion pills, chat bubbles */

/* === Gaps === */
--gap-tight:      3-4px          /* Between category bars, inline elements */
--gap-normal:     6px            /* Between file rows, gap cards */
--gap-section:    24px           /* Between folder sections on home */
--gap-chat:       10px           /* Between avatar and chat bubble */

/* === Touch targets === */
--tap-min:        44px           /* Minimum height for any tappable element (Apple HIG) */
--tap-comfortable: 48px          /* Preferred — file rows, inbox row */
```

### Safe Area

Always account for iPhone notch/home indicator:
```css
padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
```

---

## Component Conventions

### Trust Atoms

These micro-elements communicate data provenance and system confidence. They're core to the product's trust architecture.

**ProvenanceLine:**
- 8px mono, ghost opacity (16%), preceded by a 3px dot
- Shows data source and freshness: "47 transactions . Revolut . uploaded 3 Apr"
- Placed directly below the metric(s) it describes
- This is the primary trust signal — it tells the user where the numbers came from

**ConfidenceFlag:**
- 8px mono, gold at 50% opacity, dashed gold border
- Preceded by tilde `~`
- Used when auto-categorisation needs human confirmation: "3 auto-sorted — tap to check"

### Folder Sections (Home Screen)

Structure: tab sits above the card (absolutely positioned, -28px top). Card has `4px 14px 14px 14px` border-radius to create the tab-folder illusion.

- Tab contains: coloured icon (20x20, radius 5) + label (13px, weight 700, folder colour)
- "Open ->" aligned right in the tab area
- Card body: subtitle (10px, tertiary) -> content preview -> "Open [Folder]" tap target at bottom (min-height 44px, separated by a 1px border-top in folder colour at 10% opacity)
- The entire card is informational; only explicit tap targets navigate

### File Rows (Folder Detail)

- 10px radius, subtle border, 14px padding, min-height 48px
- Left: icon (13px, folder colour, 18px width, centred)
- Middle: label (13px, weight 600, primary) + type below (9px, mono, muted)
- Right: arrow -> at 15% opacity
- Staggered entrance: each row fades in 60ms after the previous (translateY 6px -> 0, opacity 0 -> 1, cubic-bezier 0.16,1,0.3,1)

### Chat Bar (Two-State)

**State 1 — Expanded greeting (initial load, user hasn't scrolled):**
- Full CFO avatar (42px) with green online dot
- Chat bubble: 12px prose, warm background, rounded `12px 12px 12px 4px`
- Suggestion pills below (10px mono, 28px min-height, pill radius 16px)
- Input row at bottom: "Ask your CFO..." placeholder + gold send button (40x40, radius 10)

**State 2 — Collapsed (user has scrolled > 30px):**
- Compact row: small avatar (38px) + input field + send button
- Greeting and pills hidden

**State 3 — Expanded sheet (tapped to open):**
- Full-screen overlay with `rgba(0,0,0,0.55)` backdrop
- Bottom sheet with `20px 20px 0 0` radius, max-height `85dvh`
- Drag handle: 36x4px, radius 2, 10% opacity
- Header: avatar (44px) + "Your CFO" + "Observes . Calculates . Educates" tagline + close button
- Scrollable chat area with suggestion pills
- Input row pinned to bottom

**Transition:** Sheet slides up with `cubic-bezier(0.16, 1, 0.3, 1)`, backdrop fades in 200ms.

### Inbox Row

- Single row on home screen, 48px min-height, 10px radius
- Left: small CFO avatar (28px) with red unread badge (14px circle, 8px bold text)
- Middle: "Inbox" label + timestamp right-aligned, preview text below (10px mono, truncated)
- Right: arrow

### Metric Tiles

- Grid layout (typically 3-col for income/spending/surplus)
- Deep background (`rgba(0,0,0,0.2)`), 8px radius
- Label: 8px mono uppercase, tracking 0.06em, tertiary colour
- Value: 16px mono weight 800, tracking -0.03em, semantic colour

### Mini Bars (Category Breakdown)

- 5px height, 3px radius, track at `rgba(255,255,255,0.04)`
- Fill at 60% opacity of category colour
- Width proportional to `pct / maxPct * 100%`

### Daily Spend Sparkline

- Flex row, items aligned to bottom, 2px gap
- Each bar: flex 1, variable height as percentage, 1.5px top radius
- Default: `rgba(255,255,255,0.07)` — last 5 bars highlighted in gold at 45%

### Value Split Bar

- Single horizontal bar, 7px height, 4px radius, `overflow: hidden`
- Segments placed side by side, each at its percentage width, 65% opacity
- Legend below: 5x5 squares (1.5px radius) at 70% opacity + `9px mono` labels

### Gap Cards

- 7px radius, inset background, `border-left: 2px solid` (green for aligned, red for misaligned)
- Belief label: 10px mono, secondary opacity
- Status badge: 7px mono uppercase, tracking 0.06em, coloured text

---

## Motion Principles

1. **Enter from below, fade in.** Default entrance: `translateY(6px) -> 0` + `opacity: 0 -> 1`.
2. **Stagger siblings.** Delay each item 40-60ms after the previous.
3. **Ease with spring feel.** Use `cubic-bezier(0.16, 1, 0.3, 1)` — fast start, gentle settle.
4. **Sheets slide, overlays fade.** Bottom sheets use `translateY(100%) -> 0`. Backdrops fade `opacity: 0 -> 1` in 200ms.
5. **No motion for data changes.** Numbers update instantly. Don't animate counters or bars filling up — it implies the data is still loading.
6. **Scroll-driven state.** Chat bar collapse at 30px scroll threshold. No animation on the collapse itself — just a state swap.

---

## CFO Avatar

The avatar is an SVG character: gold background (#E8A84C), rounded rectangle base (rx 22), face with oversized glasses (dark frames), subtle smile, dark suit/collar detail.

**Three sizes:**
| Context                  | Size  | Radius multiplier |
|--------------------------|-------|--------------------|
| Chat bar header/greeting | 42-46px | 0.22 x size      |
| Expanded sheet header    | 44px  | 0.22 x size        |
| Inline (message, inbox)  | 26-28px | 0.22 x size      |

**Online indicator:** 10-12px green circle (`#22C55E`), positioned bottom-right with 2px `--bg-elevated` border.

---

## Interaction Rules

1. **Every tappable element >= 44px tall.** No exceptions. Suggestion pills, file rows, folder open targets, close buttons — all must meet this.
2. **Tap states use background shift,** not opacity change. Darken slightly on press.
3. **No hover-only interactions.** Everything must work on touch. Hover enhancements are fine on desktop but never required.
4. **Scrollable areas need `min-height: 0`** on their flex parent. This is a Safari requirement — without it, flex children won't scroll.
5. **Text truncation uses `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`** — never let text wrap into a second line in compact components (inbox preview, file rows).

---

## Chat Message Formatting

- **Assistant messages:** Left-aligned, small avatar (26px) + bubble. Bubble has subtle background and border, radius `14px 14px 14px 4px` (sharp bottom-left, towards avatar).
- **User messages:** Right-aligned, no avatar, gold-tinted bubble, radius `14px 14px 4px 14px`.
- **Inline numbers** in chat are coloured semantically: green for income/surplus, red for spending concerns, gold for the CFO's emphasis.
- **Suggestion pills** appear after assistant messages: mono text, pill-shaped, subtle border, spaced in a flex-wrap row.
- **Tool results** (charts, tables) render inline in the message flow — never in a separate panel.

---

## Known Issues & Constraints (for Claude Code)

- **Safari input zoom:** Safari auto-zooms when an input has `font-size` below 16px. Two defences: (1) all `<input>` and `<textarea>` elements must use `font-size: 16px` minimum (`text-base` in Tailwind), and (2) the viewport meta tag locks scale:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  ```
  This is safe because there is no pinch-to-zoom use case in this app. iOS accessibility text scaling still works independently of this setting. On Android, Chrome ignores `maximum-scale=1` but also doesn't have the auto-zoom bug, so no action needed.
- **Safari flex height chain:** Any scrollable container nested in a flex layout needs `min-height: 0` on every flex ancestor. Without this, Safari renders the container at full content height and disables scroll.
- **`prose-invert`:** The Tailwind `prose-invert` class forces white text regardless of element styling. Don't apply it to containers with coloured child elements.
- **`env(safe-area-inset-bottom)`:** Must be applied to the bottommost fixed element (chat bar). Use `calc()` to add it to existing padding.
- **Feature visibility:** If something is hidden on mobile with `md:flex` / `hidden md:block`, there must be an explicit mobile alternative. Never hide features without replacement.

---

## File Naming Convention

Components live in `/components/` with feature-based grouping:
```
/components
  /chat
    ChatBar.tsx
    ChatSheet.tsx
    MessageBubble.tsx
    SuggestionPills.tsx
  /home
    FolderSection.tsx
    InboxRow.tsx
    Header.tsx
    Breadcrumb.tsx
  /folders
    FolderDetail.tsx
    FileRow.tsx
  /atoms
    ProvenanceLine.tsx
    ConfidenceFlag.tsx
    MiniBar.tsx
    CFOAvatar.tsx
  /dashboard
    MetricTile.tsx
    SparklineBar.tsx
    ValueSplitBar.tsx
    GapCard.tsx
```

---

## What Not to Change Without Discussion

These are deliberate design decisions, not accidents:

1. **The file system metaphor** — folders and files, not cards and widgets
2. **Provenance lines on computed data** — every system-generated number shows its data source
3. **Chat as bottom sheet, not full page** — the office (dashboard) is primary, chat is the advisor sitting in it
4. **Folder colour coding** — each folder's colour is its identity
5. **Monospaced numbers, humanist prose** — the dual-font system is intentional
6. **Dark theme only** — no light mode planned for v1
7. **430px max-width** — this is a phone app that happens to work in a browser
