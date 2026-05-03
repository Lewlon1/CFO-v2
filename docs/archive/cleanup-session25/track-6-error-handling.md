# Track 6 — Error handling cleanup

## Summary

Nine HIGH-confidence error-handling fixes implemented across nine files. Net effect: every previously-silent fetch failure or DB-call failure on a real user-action path now writes a `console.error` with a labelled prefix and a non-empty payload. No try/catch was deleted; no observable behaviour for callers was changed (rollbacks, response codes, optimistic UI states all preserved). Three intentional fire-and-forget sites (`MessageFeedback`, `upload route` post-import evaluators, `balance-sheet-pdf` cleanup-finally) had their `silence-is-OK` rationale upgraded from "no comment" or "// ignore" to a real one-line explanation. Build, lint, and tests all match the post-Track-5 baseline (lint 20/36, tests 58/58, build succeeds).

The remaining surface area — context-builder defensive catches, value-map and demo flows, cron route handlers, the LLM JSON-parse cascade, and async function `.catch(() => {})` against stub implementations — is documented in MEDIUM/LOW with rationale for deferral.

## Survey scope

- 76 `catch (...)` blocks across 91 files in `cfos-office/src/` (multi-line form: 126 occurrences across both forms after de-dup).
- 30 `.catch(() => ...)` arrow patterns across 26 files.
- 164 `console.error` occurrences across 82 files (no structured logger).
- Two unconditional `} catch {}` empty bodies pre-track — `lib/supabase/server.ts:17` (intentional, Supabase SSR cookies, kept as-is), `hooks/useOnboarding.ts:241` (silent — fixed in HIGH-3).

The systematic survey ran an awk pass over every catch body to flag any catch that lacks a `console.{error,warn,log}`, `throw`, `sendAlert`, or `return …error…` inside it. Cross-referenced with the `.catch(() => …)` shortlist. The HIGH/MEDIUM/LOW classification below is the result.

## HIGH-confidence — implemented

### HIGH-1. `src/app/(office)/office/cash-flow/transactions/OfficeTransactionsClient.tsx:71-90`

**Before:**
```ts
const handleValueChange = async (txId, newCategory) => {
  try {
    const dbValue = newCategory === 'unsure' ? 'no_idea' : newCategory
    await fetch('/api/corrections/signal', { ... })
  } catch {
    // Silently fail — pill already updated optimistically
  }
}
```

**After:** check `res.ok`, log a `console.error` with txId+status on a non-2xx response, and log the thrown error in the catch. The optimistic UI update is *not* rolled back (the user has moved on); the change just makes the failure visible in logs/console so we can fix it before users start losing categorisations silently.

**Why HIGH:** the user clicked a value-pill on a transaction. The optimistic update means the UI shows it succeeded. If the POST fails, the correction signal is lost — the categorisation never propagates, the rules engine never learns, and there is no trace of the failure anywhere. Adding `console.error` does not change observable behaviour for callers (the pill stays green; the function still returns void), it just stops the failure from being invisible. This was also the *only* catch in the file that swallowed without logging.

### HIGH-2. `src/lib/ai/review-context.ts:159-170`

**Before:**
```ts
try {
  valueShifts = await detectValueShifts(supabase, userId, reviewMonth, prevMonth)
} catch {
  // Non-fatal — continue without shifts
}
```

**After:** `} catch (err) { console.error('[review-context] detectValueShifts failed:', err) }` plus an expanded comment.

**Why HIGH:** `detectValueShifts` is a DB-backed analytics call. If it throws, the monthly review is silently shorter (no shifts section) and we don't know it broke. The change preserves "non-fatal" semantics (the catch still proceeds with `valueShifts: []`); it just puts the error in server logs so a regression here is visible.

### HIGH-3. `src/hooks/useOnboarding.ts:232-248`

**Before:**
```ts
try {
  await fetch('/api/onboarding/complete', { ... })
} catch {}
```

**After:** logs the error with a comment explaining that this is non-blocking but a failed POST means `onboarding_completed_at` is never stamped — which means the modal could re-trigger on the next load. A stuck-loop bug here was previously invisible.

**Why HIGH:** observable behaviour for the user is unchanged (we still call `router.refresh()` and `router.push('/office')`). The change makes a real persistence failure debuggable.

### HIGH-4. `src/lib/parsers/balance-sheet-pdf.ts:48-58`

**Before:**
```ts
finally {
  if (parser) {
    try { await parser.destroy() } catch { /* ignore */ }
  }
}
```

**After:** kept as-is (cleanup-only finally) but expanded the comment to make the silence-is-OK contract explicit (we've already returned a parse result and can't usefully surface a destroy-time failure; leak is bounded to one invocation).

**Why HIGH (comment-only):** intentional silence in a cleanup-only finally — we don't want to convert a successful parse into a failure because cleanup hiccupped. Documenting the rationale matches the "fire-and-forget gets a comment" rule from the brief.

### HIGH-5. `src/components/chat/ChatProvider.tsx:142-163` (initial conversation load)

**Before:**
```ts
fetch('/api/conversations/recent')
  .then(...)
  .catch(() => {
    // Silent — no conversation to load is fine
  })
```

**After:** logs the error. Comment clarifies that "no conversation found" is *already* handled upstream (the `r.ok ? r.json() : null` short-circuit returns `null` on a 4xx, which then falls through). The catch only fires on network or parse failures, which are real problems.

**Why HIGH:** the existing comment was misleading (it conflates "no data" with "fetch failed"). The fix corrects the comment AND surfaces real failures. Observable UI behaviour is unchanged.

### HIGH-6. `src/components/chat/ChatProvider.tsx:272-289` (conversation switch)

**Before:**
```ts
fetch(`/api/conversations/recent?id=${id}`)
  .then(...)
  .catch(() => {})
```

**After:** logs with a comment explaining the UI stays on the previously loaded conversation if the fetch fails.

**Why HIGH:** silent UX failure — user clicks a conversation in the sidebar, nothing happens, no error. The log makes a flaky API debuggable.

### HIGH-7. `src/components/chat/ChatSheet.tsx:95-110`

**Before:**
```ts
fetch('/api/conversations/recent?list=1')
  .then(...)
  .catch(() => {})
```

**After:** logs with a comment explaining the list stays empty on failure.

**Why HIGH:** same reasoning as HIGH-6; an empty list looks like "no conversations" rather than "load failed".

### HIGH-8. `src/components/office/InboxRow.tsx:32-44`

**Before:**
```ts
fetch('/api/nudges?status=pending&limit=5')
  .then(...)
  .catch(() => {})
```

**After:** logs with a comment explaining the inbox row stays hidden on failure (count remains 0).

**Why HIGH:** the inbox UI silently disappears on a failed nudges fetch. Logging makes it visible. Note: the `cron/nudges-{daily,weekly,monthly}` *handlers* are off-limits per `DEFERRED.md`, but the *consumer* UI (this component, plus HIGH-9) is in scope.

### HIGH-9. `src/app/(office)/office/inbox/InboxClient.tsx:64-73`

**Before:**
```ts
await fetch('/api/nudges', { method: 'PATCH', ... }).catch(() => {})
```

**After:** logs the error with a comment. Mark-as-read failure now shows up rather than leaving a nudge stuck unread invisibly.

**Why HIGH:** same family as HIGH-8 — consumer UI for nudges, not the deferred cron route.

### HIGH-10. `src/app/api/upload/route.ts:91-100` (post-import nudge evaluators)

**Before:**
```ts
evaluatePaydaySavings(supabase, user.id).catch(() => {})
evaluateValueMapRetake(supabase, user.id).catch(() => {})
```

**After:** both catches now log with a `[upload] …failed:` prefix. Comment explains fire-and-forget on the response path is intentional but errors should be visible.

**Why HIGH:** the evaluators (`src/lib/nudges/evaluators/payday-savings.ts`, `src/lib/nudges/evaluators/value-map-retake.ts`) have *zero* internal logging or try/catch. Without these site-of-call logs, an evaluator crash was completely invisible.

### HIGH-11. `src/components/chat/MessageFeedback.tsx:30-39` (comment-only)

**Before:** uncommented `.catch(() => {})` on analytics POST.

**After:** comment explains that analytics is best-effort and silent failure is intentional.

**Why HIGH (comment-only):** matches the "fire-and-forget gets a comment" rule. No behaviour change — feedback POST is one of the canonical analytics paths where silence is genuinely correct.

## MEDIUM-confidence — documented, not implemented

### MED-1. `src/lib/ai/context-builder.ts` — five silent catches that return `''`

Locations: `:580`, `:888`, `:983`, `:1030`, `:1061`, `:1126` (six in total — one is the `getNextQuestions` profiling guard which returns `''` after silent catch).

Each is structured as: `try { build a context section } catch { return '' }`. The pattern is deliberate — a defensive boundary so a failing sub-section doesn't break the entire system prompt assembly. The chat continues, just with one fewer context block.

**Why MEDIUM:** adding `console.error` at all six sites is mechanically safe (no behaviour change) and would match HIGH-1/2/3/5/6/7/8/9. But:
1. The brief explicitly lists `lib/ai/context-builder.ts` (1316 lines) on the "minor surgical edits only" list.
2. Six identical edits in one file would meaningfully exceed "minor surgical".
3. A proper fix would centralise the pattern (e.g. a `safeContextBlock(name, fn)` wrapper) — that's the actual right answer and is bigger than this track.

**Recommendation:** dedicated mini-PR that introduces a `safeContextBlock` helper and migrates all six catches at once.

### MED-2. `src/lib/value-map/regenerate-archetype.ts:479,489` — JSON-parse fall-through cascade

The same cascade pattern as `app/api/onboarding/generate-archetype/route.ts:52,59,71`: try `JSON.parse(text)` directly, then try the markdown code-block extraction, then try first-`{` to last-`}` extraction, finally return `null`. Each `} catch { /* fall through */ }` is intentional — the next strategy is the recovery.

**Why MEDIUM:** the catches are intentional and already commented. A theoretical improvement would log when *all three* strategies fail — but that already happens at the call site where the `null` return triggers `getRegenerationFallback(...)` and a `console.warn`. So the silence is correct; only an architectural change would help.

**Recommendation:** none. Leave alone; the cascade is the right shape.

### MED-3. `src/app/api/onboarding/generate-archetype/route.ts:52,59,71` — same JSON cascade

Same pattern as MED-2 in a different file. Same recommendation.

### MED-4. `src/app/api/value-map/reveal/route.ts:115` — best-effort `logChatUsage`

Wraps a `logChatUsage` call inside a `try/catch` with a `// Best-effort logging` comment. The function itself is currently a no-op stub (`src/lib/chat/cost-tracker.ts`) so the catch is unreachable, but when it lands as a real implementation the catch will mask any logging failure.

**Why MEDIUM:** the comment is correct *for now* (cost tracking is best-effort). When `logChatUsage` becomes real, a logging failure should probably show up in server logs rather than silently disappearing. But since the function is a stub, no immediate action is needed.

**Recommendation:** revisit when cost tracking is implemented (out of scope for this track; flagged as a stub in Track 3 M1).

### MED-5. `src/components/value-map/value-map-flow.tsx:88, 142, 168, 242`, `src/components/value-map/value-map-summary.tsx:86`, `src/components/value-map/retake-impact.tsx`, `src/components/demo/*.tsx` — value-map and demo flow catches

Multiple `.catch(() => ({}))` patterns inside the value-map and demo flows. Some log, some don't.

**Why MEDIUM:** these files are explicitly off-limits per the brief ("Demo / value-map flow — product-critical"). Some of these silences are wrong by the same standard as HIGH-1, but a careful pass should be done as a dedicated value-map cleanup PR with the value-map owner reviewing.

**Recommendation:** separate value-map error-handling pass.

### MED-6. `src/app/api/demo/signup/route.ts:76` — silent catch on demo waitlist signup

```ts
} catch {
  return Response.json({ error: 'Failed to process signup' }, { status: 500 })
}
```

The 500 response is fine; the silence is the problem (the `err` variable is dropped, no log).

**Why MEDIUM:** demo flow is on the "do not touch" list per the brief, but this is server-side and a one-line fix (`} catch (err) { console.error('[demo/signup]', err); return ... }`). Holding off pending demo-flow owner review.

**Recommendation:** include in MED-5's separate pass.

### MED-7. Catches inside `lib/parsers/*` that return string-coerced errors

Most parser catches return `{ ok: false, error: <message> }` rather than logging. The error text propagates upstream where the upload route logs it via `sendAlert`. So no silent swallow — the channel is "structured error return + alert at boundary" rather than "log here".

**Why MEDIUM:** the pattern is consistent and works. But the boundary alert at `app/api/upload/route.ts` only fires for `parseResult.ok === false` — if the parser internal *throws* (rather than returning `{ ok: false }`), behaviour depends on the call site. Worth a focused review of every parser to confirm "always return don't throw" is true everywhere.

**Recommendation:** parser-pass code review (separate from this track).

### MED-8. `src/app/api/chat/route.ts:111` — fire-and-forget `analyze-conversation` POST

Already commented (`// Fire-and-forget — don't block conversation creation`). The `analyze-conversation` Edge Function is what extracts behavioural traits from the just-finished conversation. If this fetch fails consistently, the financial portrait would silently stop updating.

**Why MEDIUM:** the fire-and-forget is intentional — but logging the failure (rather than swallowing) would make a regression visible. The brief explicitly endorses this site as one of the known starting points. The hesitation is that `app/api/chat/route.ts` is on the "minor surgical edits only" list (652 lines). A two-line addition is borderline; opting to defer.

**Recommendation:** add `.catch((err) => console.error('[chat] analyze-conversation kickoff failed', err))` in a small focused PR. The change is identical in shape to HIGH-10.

### MED-9. `src/lib/value-map/regenerate-archetype.ts` Bedrock timeout fallback (line 132)

The brief flags this as a known starting point. The actual catch (`} catch (err) { console.error(... ); archetype = getRegenerationFallback(...); usedFallback = true; }`) DOES log. The "fallback that masks a problem" critique is real (the user gets a stale-ish archetype with no UI signal that the LLM call failed) but the *log* is in place. A real fix is product-level (surface "fallback used" in the UI), not error-handling-pass scope.

**Recommendation:** product decision; not an error-handling cleanup.

## LOW-confidence — documented, not implemented

### LOW-1. `src/lib/supabase/server.ts:17` — empty `} catch {}` for cookie setAll

Standard Supabase SSR pattern. The cookies' `setAll` can fail when called from a Server Component (Next.js limitation). Every Supabase Next.js example ships this exact pattern. Do NOT touch.

### LOW-2. `src/lib/value-map/format.ts:17` — date-formatter fallback

```ts
export function formatDate(dateStr: string): string {
  try { ... return d.toLocaleDateString(...) } catch { return dateStr }
}
```

Pure formatter. If `Date` parsing throws, return the raw string. Keep.

### LOW-3. `src/lib/alerts/notify.ts:104, 117` — `.catch(() => {})` on `sendAlert(...)`

Both wrap `sendAlert` calls inside `wrapToolsWithAlerts`. `sendAlert` itself already has internal `console.error('[ALERT SEND FAILED]', ...)` (line 60-62). The `.catch(() => {})` is the canonical "don't let alert-send-failure throw inside the tool wrapper" pattern. Keep — silence is correct because the inner function logs.

### LOW-4. `src/lib/value-map/regenerate-archetype.ts:229`, `src/app/api/onboarding/generate-archetype/route.ts:240` — `logChatUsage(...).catch(() => {})`

`logChatUsage` is currently a no-op stub that cannot throw. The `.catch(() => {})` is harmless and correct anticipation of the eventual implementation. Keep.

### LOW-5. `src/app/api/upload/route.ts:324, 335` — `sendAlert(...).catch(() => {})`

Same reasoning as LOW-3. `sendAlert` logs internally. Keep.

### LOW-6. `src/app/api/review/start/route.ts:74`, `src/app/api/onboarding/generate-archetype/route.ts` — fire-and-forget `analyze-conversation`

Same pattern as MED-8. Documented in MED-8. Listed here for completeness.

### LOW-7. `src/app/api/cron/nudges-{daily,weekly,monthly}/route.ts:51, 37, 37`

Per `DEFERRED.md`, the cron route handlers are intentionally retained but not actively maintained until Session 11 nudge build-out. Their internal try/catch already log via `console.error`. Untouched.

### LOW-8. `lib/ai/tools/*.ts` — every tool has `try { ... } catch (err) { console.error(...); return { error: '...' } }`

Verified across all 23 tool files. Pattern is correct: log + structured error return → caller (`wrapToolsWithAlerts`) inspects the `error` field and fires an alert. Untouched.

### LOW-9. `src/lib/categorisation/llm-categoriser.ts:82-84`, `src/lib/bills/brave-search.ts:60-62`, `src/lib/upload/balance-sheet-import.ts:346-349`, `src/lib/value-map/regenerate-archetype.ts:242-245`, `src/lib/parsers/balance-sheet-pdf.ts:45-47`, etc.

All these top-level catches log via `console.error` AND either return a structured error or `null`. Pattern is sound. Untouched.

### LOW-10. `src/app/(office)/office/values/the-gap/TheGapClient.tsx:25` — JSON parse fallback for Gap analysis trait_value

```ts
try { return JSON.parse(value) ... } catch { return { belief: value, reality: '', status: 'partial' } }
```

The trait_value column stores either JSON or raw text. The catch is the legitimate "raw text" branch of a known-heterogeneous input. Comment is in place. Keep.

## Verification

Run from `cfos-office/`:

| Check | Baseline (post-Track-5) | Post-Track-6 | Delta |
|---|---|---|---|
| `npm run build` | succeeds | succeeds | unchanged |
| `npm run lint` | 20 errors / 36 warnings | 20 errors / 36 warnings | unchanged |
| `npm test` | 58/58 passing | 58/58 passing | unchanged |

No build, lint, or test regression. The lint count is unchanged because:
1. Every change either added a `console.error` (no rule fires) or expanded a comment.
2. No `eslint-disable` directives were added or removed.
3. No `unused-var` warnings were introduced (all new `(err) =>` parameters are used in `console.error`).

## Files touched (9)

- `src/app/(office)/office/cash-flow/transactions/OfficeTransactionsClient.tsx`
- `src/lib/ai/review-context.ts`
- `src/hooks/useOnboarding.ts`
- `src/lib/parsers/balance-sheet-pdf.ts`
- `src/components/chat/ChatProvider.tsx`
- `src/components/chat/ChatSheet.tsx`
- `src/components/office/InboxRow.tsx`
- `src/app/(office)/office/inbox/InboxClient.tsx`
- `src/app/api/upload/route.ts`
- `src/components/chat/MessageFeedback.tsx`

Total: 11 sites edited across 10 files (HIGH-5 and HIGH-6 are both in `ChatProvider.tsx`). All edits add `console.error` to a silent catch or expand an intentional silence's rationale comment.

## Out-of-scope (per brief)

- `lib/ai/context-builder.ts` — minor edits only; the six silent context-section catches need a centralised wrapper rather than six duplicate edits (MED-1).
- `app/api/chat/route.ts` — minor edits only; the analyze-conversation kickoff is a clean two-line fix but flagged in MED-8 for follow-up.
- `app/api/upload/route.ts` — minor edits only; HIGH-10 was a clean one-line addition each, in scope.
- Demo / value-map flows — product-critical (MED-5, MED-6). Several silent catches in this surface area need fixing but a value-map owner should review.
- Cron `nudges-{daily,weekly,monthly}` route handlers — `DEFERRED.md`.
- TODO(session-14) markers in `lib/ai/tools/{upsert-asset,upsert-liability,get-balance-sheet}.ts` — `TECH_DEBT.md` #30.
- `lib/supabase/types.ts` — generated, never edit.

## Surprises / notes for next track

1. **The error-handling discipline is already strong in lib/.** Most `lib/` catches log + return structured errors. The "silent swallow" pattern lives almost entirely in **client-side fetch chains** (`.catch(() => {})`) and a handful of **boundary catches** in API routes that returned generic 500s without logging.

2. **The value-map flow has the worst error-handling hygiene** — many silent catches with no comment. It was a deliberate scope-out for this track, but a focused pass would yield 5-8 more HIGH-confidence wins.

3. **`context-builder.ts` deserves a `safeContextBlock` helper.** The six identical `try { ... } catch { return '' }` patterns scream for centralisation — and centralising would let the helper add `console.error` once instead of six times.

4. **The `wrapToolsWithAlerts` pattern is excellent** — every tool gets observability for free. This is the model the rest of the codebase should follow (alert + log on the boundary where a tool is invoked, not inside each tool).

5. **No structured logger exists yet** — every fix uses `console.error` with a `[component-name]` prefix. When a structured logger lands, a codemod could replace `console.error('[X] message', err)` with `logger.error({ component: 'X', err }, 'message')` mechanically. The prefix discipline introduced by this track makes that codemod safer.
