# Track 7 — Deprecated code and AI slop

## Summary

The codebase is **substantially clean** of the patterns this track targets. Phase A (deprecated/legacy) and Phase B (AI artifacts) yielded only **two HIGH-confidence fixes** between them: deleting one truly dead stub file (`src/lib/chat/persist-messages.ts`, never imported anywhere) and removing one AI-history narrative comment ("// No longer need feedbackTransactions — demo uses its own feedback engine") in `demo-card.tsx`. There are zero `@deprecated` markers in `src/`, zero `if (false)` dead-branch toggles, zero `.bak`/`.old`/`_legacy`/`_v1`-named files (only one migration `026_drop_legacy_tables.sql` which is a permanent historical artifact and must never be deleted), zero commented-out code blocks, and zero "removed/updated/fixed/refactored/now does/was changed" narrative comments. The 6 prior-survey TODOs are all confirmed legitimate (3 cron-route deferred entries documented in DEFERRED.md, 3 `TODO(session-14)` in tools — TECH_DEBT.md #30); none are slop. The three "backwards compat" comments found (`profile/completeness.ts`, `value-categoriser.ts`, `delete-data/route.ts`, `ArchetypeBeat.tsx`) were each verified to describe live, alive paths with real callers — they're documentation of intent, not deletion candidates. The remaining stubs (`rate-limit.ts`, `cost-tracker.ts`, `ai-categorise.ts`) are wired up to live call sites that depend on them returning safe no-op values; they cannot be deleted without coordinated removal of those call sites (out of scope for a low-risk surgical pass). Verification: lint went from 20/36 to **20/35** (one fewer warning because the deleted file's `_params` unused-var warning is gone), build succeeds, tests 58/58 — no regressions.

This is a strong outcome. The prior survey called it correctly: this track produces mostly a written assessment confirming cleanliness, plus one or two micro-deletions. The codebase has a notably disciplined comment culture (numbered-step explanations, "// 1.", "// 2." style) and zero edit-history narration. Whoever's been writing this code didn't leave AI scar tissue behind.

## Phase A — Deprecated/legacy

### HIGH-confidence — implemented

#### A-1. `src/lib/chat/persist-messages.ts` deleted

**File deleted:** `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/lib/chat/persist-messages.ts`

**Original content (12 lines):**
```typescript
// Stub — message persistence will be implemented in Session 2
export async function persistMessages(_params: {
  userId?: string
  profileId?: string
  sessionId?: string
  chatType?: string
  userMessage?: unknown
  messages?: { role: string; content: string }[]
  [key: string]: unknown
}): Promise<void> {
  // no-op
}
```

**Grep evidence — zero call sites:**
```
$ Grep "persistMessages|persist-messages" cfos-office/src
cfos-office/src/lib/chat/persist-messages.ts:2:export async function persistMessages(_params: {
```
The only result is the function's own definition. Zero imports anywhere in `src/`. The "Session 2" promise (chat with persistence) was completed long ago — `app/api/chat/route.ts` is now 652 lines and persists messages directly via `supabase.from('messages').insert(...)` — making this stub permanently orphaned scaffolding.

**Track 3 cross-reference correction:** Track 3 M1 flagged this file as MEDIUM and recommended treating it as a pair with `lib/chat/rate-limit.ts` ("either both go or both stay"). On re-verification that pairing logic is **wrong**: `checkRateLimit` IS called from `app/api/value-map/reveal/route.ts:69` (alive), but `persistMessages` is called from nowhere (dead). They are not symmetric — `persist-messages.ts` can be safely deleted alone. Track 3's caution was over-broad.

**Risk:** zero — there are no consumers to break. Lint dropped one warning (`_params` unused), confirming the file's only contribution to the codebase was a dead stub.

### MEDIUM/LOW — documented

#### A-M1. Three live placeholder stubs left in place

These three files look stub-like but have live consumers that depend on their no-op semantics:

| File | Function | Live caller(s) | Action |
|---|---|---|---|
| `src/lib/chat/rate-limit.ts` | `checkRateLimit` | `app/api/value-map/reveal/route.ts:69` | KEEP — caller relies on always-allowed return until Redis is wired up |
| `src/lib/chat/cost-tracker.ts` | `logChatUsage` | `value-map/regenerate-archetype.ts:224`, `app/api/onboarding/generate-archetype/route.ts:235`, `app/api/value-map/reveal/route.ts:106` | KEEP — three live callers with `.catch(() => {})` already in place per Track 6 LOW-4 |
| `src/lib/categorisation/ai-categorise.ts` | `aiCategoriseBatch` | `components/value-map/value-map-flow.tsx:399` | KEEP — value-map flow depends on the empty-Map return shape |

Each has a "Stub — will be implemented in [Session N]" header comment. These are intentional API placeholders, not dead code: removing them would break the call sites. They are tracked as deferred work in Track 3 M1 and Track 6 MED-4. Future implementation should replace the body, not delete the file.

#### A-M2. "Backwards compatibility" comments — all describe live paths, not deprecation

Four comments mention "backward(s) compat":

1. **`src/lib/profile/completeness.ts:5`** — `/* Re-exports from the profiling engine for backward compatibility. */` — re-exports `calculateProfileCompleteness` as `calculateCompleteness` for one live caller (`src/app/(office)/office/page.tsx:2`). Honest thin-wrapper; the comment slightly mis-describes "compat" (there's only one consumer, no need for symmetry), but the wrapper is alive. Recommendation: leave alone, or in a future pass inline the import directly into `office/page.tsx` and delete this file. Risk: low, but not within scope of a slop-cleanup track.

2. **`src/lib/categorisation/value-categoriser.ts:42`** — describes the optional `signals` parameter being safe to omit ("preview, backwards compat"). Both current callers pass `signals`, but the optional-arg API contract is genuine for preview/test paths. Comment explains intent. KEEP.

3. **`src/lib/categorisation/value-categoriser.ts:219`** — `// For merchant types, use includes (substring match) for backwards compat`. The merchant matching is genuinely substring-based (line 221). The "backwards compat" framing is slightly vague — what it actually does is allow user-saved merchant rules (which might not be perfectly normalised) to still match cleaned merchant strings. Comment could be rewritten for clarity, but the behaviour is intentional. MEDIUM — comment-only rewrite candidate, not deletion.

4. **`src/app/api/profile/delete-data/route.ts:62`** — `// Delegate here for backwards compatibility with any callers still targeting this endpoint.` — verified active. The legacy `/api/profile/delete-data` endpoint with `target: 'everything'` IS still called by `components/profile/DataManagement.tsx:70`, which is mounted on the live `/profile` page (`ProfilePageClient.tsx:11,242`). Meanwhile `AccountDataManagement.tsx` calls the newer `/api/account/delete` from `/settings`. Two parallel surfaces, both alive; the delegation is real and the comment is accurate. KEEP.

5. **`src/components/onboarding/beats/ArchetypeBeat.tsx:97`** — `// Fallback: deterministic display (backwards compat)`. This is the fallback when `archetypeData` is undefined but `personalityType` exists — a real LLM-failure path triggered by network/API errors during onboarding. The "backwards compat" framing is misleading (it's a runtime fallback, not a versioning artifact); a cleaner comment would say `// Fallback: deterministic display when archetype generation didn't return data`. MEDIUM — comment-only rewrite candidate.

**Recommendation:** comment polish on items 3 and 5 in a future docs-only pass; no functional change needed.

#### A-M3. Root-level utility scripts (`apply-migration.ts`, `check-staging{,2,3}.ts`, `test-{normalise,rules}.ts`)

Documented at length in Track 3 M4. Six root-level scripts that look one-off-ish. Track 3 left them alone pending owner sign-off. Same conclusion here — deletion needs owner consent.

#### A-L1. `// Legacy fallback` in `src/lib/ai/context-builder.ts:1241`

```typescript
case 'first_insight':
case 'post_upload': {
  const payload = metadata?.first_insight_payload as InsightPayload | undefined;
  if (!payload) {
    // Legacy fallback: rows without a payload (pre-First-Insight-Engine
    // conversations) still render using the original post-upload prompt.
    return buildPostUploadPrompt(metadata, snapshots, profile);
  }
  ...
```
Genuine schema-evolution backward-compat: pre-FIE conversations stored in the DB still work. KEEP — the fallback protects existing conversation rows from breaking.

#### A-L2. `supabase/migrations/026_drop_legacy_tables.sql`

Migration file. **Never delete migrations.** No action.

#### A-L3. Cron `nudges-{daily,weekly,monthly}/route.ts` files and TODO markers

Per brief and DEFERRED.md, intentionally retained. All three TODOs say `// TODO: Not registered in vercel.json — decide between Vercel cron vs Supabase` — accurate, intentional. KEEP.

#### A-L4. `TODO(session-14)` markers in three tools files

Per TECH_DEBT.md #30, intentional Session-14 deferred work. KEEP.

## Phase B — AI artifacts

### HIGH-confidence — implemented

#### B-1. AI-history narrative comment removed in `src/components/demo/demo-card.tsx:111`

**Before:**
```tsx
const total = transactions.length
const tx = transactions[currentIndex]
const currency = tx.currency

// No longer need feedbackTransactions — demo uses its own feedback engine

// Running totals for the allocation strip
```

**After:** the "// No longer need feedbackTransactions" line is removed.

**Why HIGH:** classic AI-edit narration — the comment describes what *used* to be there ("we no longer need X") rather than what the current code does. A new engineer reading this file would not know what `feedbackTransactions` is or why it's mentioned. It's pure scar tissue from a prior refactor. The `// Running totals for the allocation strip` comment immediately below is the actual useful intent comment for the code that follows. Removal is purely docs-level — no behaviour change, no risk.

### MEDIUM/LOW — documented

#### B-M1. Two "backwards compat" comments worth polishing (functional code is fine)

See A-M2 items 3 and 5 above. Comment-only rewrites; deferred to a docs-polish pass to keep this track risk-free.

#### B-L1. `// Was unmatched by rules, then categorised by LLM` in `categorisation-stats.ts:39`

This narrates the *current* branch logic (which case the `if` branch represents), not edit history. Reads as the kind of guard-rail comment you'd add when stat-counting four mutually-exclusive states. KEEP.

#### B-L2. "Session N" provenance tags

Several files carry `(Session N)` annotations:
- `src/lib/upload/balance-sheet-import.ts:1` — `// Commit step for balance-sheet uploads (Session 19B).`
- `src/components/upload/HoldingsPreview.tsx:3` — `// Preview + confirm UI for balance-sheet uploads (Session 19B).`
- `src/lib/parsers/types.ts:50` — `// Value category rule match types (Session 28 — new schema)`
- `src/app/api/chat/route.ts:471` — `// ── CFO Toolbox (Session 7) ────────────────────────────────────`

These are provenance breadcrumbs — historical context, not slop. Mild noise but informative for someone tracing why a feature exists. KEEP.

#### B-L3. `// no longer considers` in `src/app/api/chat/undo/route.ts:161`

```typescript
// Remove the profiling_queue entries that the chat tool wrote so the system
// no longer considers these fields "answered via conversation".
```
Describes the *current intent* of an undo handler ("we delete this so the system stops treating the field as answered"). Not edit history. KEEP.

#### B-L4. "Will be" / "no longer" / "fallback" / "before/after" survey

A grep across `// will be|will implement|to be implemented|no longer|fallback|before|after|originally|previously|initially|historically|new |added|moved|renamed|extracted|inlined|merged with|in the future|eventually|maybe later|may want|might want|removed|updated|fixed|previously|refactored|now does|was|changed|dead code|unused|TEMP` produced no further candidates beyond the items already named above. The codebase is genuinely clean.

## Verification

| Check | Baseline (post-Track-6) | Post-Track-7 | Delta |
|---|---|---|---|
| `npm run lint` | 20 errors / 36 warnings | **20 errors / 35 warnings** | **-1 warning** |
| `npm run build` | succeeds | **succeeds** | unchanged |
| `npm test` | 58/58 passing | **58/58 passing** | unchanged |

Lint warning count dropped by 1 because `persist-messages.ts` had a `_params` unused-var warning that is now gone with the file.

Commands run, all from `cfos-office/`:
```bash
cd /Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office && npm run lint 2>&1 | tail -5
cd /Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office && npm run build 2>&1 | tail -10
cd /Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office && npm test 2>&1 | tail -10
```

## Files touched

**Deleted (1):**
- `src/lib/chat/persist-messages.ts`

**Modified (1):**
- `src/components/demo/demo-card.tsx` — single-line comment removal at line 111.

Total diff: 13 lines removed (12 from deleted file, 1 from comment removal), 0 lines added. No commit per brief; staged in working tree.

## Out-of-scope / not touched (per brief)

- `app/api/cron/nudges-{daily,weekly,monthly}/route.ts` and their `TODO:` markers — DEFERRED.md.
- `lib/ai/tools/{upsert-asset,upsert-liability,get-balance-sheet}.ts` `TODO(session-14)` markers — TECH_DEBT.md #30.
- `lib/supabase/types.ts` — generated; never edit.
- Demo / value-map flow — product-critical (only one micro-edit was made: a single comment line removed in `demo-card.tsx`, no behaviour change).
- Large file refactors — surgical-only.
- Root-level utility scripts — see Track 3 M4.

## Surprises / notes for next track

1. **Track 3's "treat persist-messages.ts and rate-limit.ts as a pair" rule was incorrect.** The two stubs are not symmetric: `rate-limit.ts` has a live caller, `persist-messages.ts` does not. Future cleanup tracks should not assume sibling-file similarity implies sibling-file usage.

2. **The codebase has a strikingly disciplined comment culture.** Numbered step comments (`// 1. Fetch ALL value category rules`), section dividers (`// ── CFO Toolbox`), and inline rationales for non-obvious branches. There is essentially zero AI-edit narration — the codebase reads as if a human cared about the next reader. This is unusual for a fast-moving early-stage product and worth preserving.

3. **The "(Session N)" provenance tags are an interesting middle ground.** They give historical context but tie comments to a development-process artifact (the session plan in CLAUDE.md). If the session model is permanent, fine. If sessions get renumbered or the plan changes, these tags will become misleading. Worth a future product call: keep them, or drop them in favour of issue-tracker references.

4. **Two "backwards compat" comments deserve a docs polish pass** (`value-categoriser.ts:219`, `ArchetypeBeat.tsx:97`) — the underlying code is correct but the comments mis-describe the intent. Low priority; not a slop concern.

5. **No commits made.** Per brief, changes left staged.
