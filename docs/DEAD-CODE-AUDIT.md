# Dead Code Audit
> Generated: 2026-05-01 | Branch: `claude/prepare-beta-v2-O1zeV` | Tip: `df90c91`

## Summary

- `prompt-buttons.ts`: **Tier 1 DEAD** (zero references anywhere; consts orphaned by `/chat` → `/office` migration)
- Orphan API routes verified: **3 DEAD, 0 WIRED, 1 FLAG-FOR-LEWIS**
- Cron routes to register: **3** (`nudges-daily` / `-weekly` / `-monthly`) — all already enforce `CRON_SECRET`
- CRON_SECRET gaps found: **0** (all four cron handlers validate before doing work)
- Dependency dead weight: **0 removable** (per V2-AUDIT.md §7 — `react-dom` peer-only, no truly orphan runtime deps)

---

## 1. Lib orphan: `src/lib/chat/prompt-buttons.ts`

| Check | Result |
|---|---|
| File-path references (`prompt-buttons`) | **0** in `src/`, `tests/`, `scripts/` (only docs and the file itself) |
| Named-export references (`NEW_USER_PROMPTS`, `RETURNING_USER_PROMPTS`, `PromptButton`, `PromptConversationType`, `PromptButtons`, `promptButtons`) | **0** outside the file |
| Dynamic imports of `prompt-buttons` | **0** |
| Re-exports from any `index.ts` under `src/lib/` or `src/lib/chat/` | **0** (no barrel files exist there) |

**Source.** Two const arrays (`NEW_USER_PROMPTS`, `RETURNING_USER_PROMPTS`) of 6 prompt buttons each, plus a `PromptButton` interface and `PromptConversationType` union. Comments describe the chat-welcome-screen button bar — a v1 surface that was replaced when the chat moved into `/office` (chat is now embedded as a sheet inside the dashboard, not a standalone welcome screen).

The existing dead-code track doc (`cfos-office/docs/cleanup/track-3-dead-code.md`) already flagged `NEW_USER_PROMPTS` as unused via Knip and recommended the file as a "binary dead vs alive" candidate.

- **Verdict:** **Tier 1 DEAD**
- **C1 action:** delete `src/lib/chat/prompt-buttons.ts`

---

## 2. Orphan API route verification

### `/api/transactions/recategorise`

| Check | Result |
|---|---|
| Frontend grep (`/api/transactions/recategorise` literal) | **0 hits** outside the route file |
| `fetch(...)` callers | **0**. The transactions page (`OfficeTransactionsClient.tsx:74`) uses `/api/corrections/signal` instead. |
| `app/api/tools/[tool]/route.ts` dispatch | **N/A** — no `app/api/tools/` directory exists in this repo. Tool dispatch is in-process via `lib/ai/tools/index.ts createToolbox()`. |
| Edge Function callers | **N/A** — `supabase/functions/` does not exist. |
| Tool-definition references | The string `recategoris` matches only the in-process `suggest_value_recategorisation` Claude tool (which queries the DB directly via Supabase, never via this HTTP route). |
| `vercel.json` cron registration | None. |

**Source notes.** Comment header: `// POST /api/transactions/recategorise`. Body shape `{ transactionId, field, newValue, applyToSimilar?, description? }`. Handles BOTH `field === 'category_id'` and `field === 'value_category'`. Functionally redundant: `/api/corrections/signal` is the production path for value-category corrections, and there is no UI surface today that mutates `category_id` (no traditional-category edit UI exists in the office layout).

The underlying `applyValueClassification(...)` library function this route wraps **is** still used (`value-map/checkin/save`, `record-value-classifications` tool) — only the HTTP wrapper is orphaned.

- **Verdict:** **DEAD**
- **C1 action:** delete `src/app/api/transactions/recategorise/route.ts`

---

### `/api/transactions/low-confidence-count`

| Check | Result |
|---|---|
| Frontend grep (`low-confidence-count` literal) | **0 hits** anywhere |
| `fetch(...)` callers | **0**. The only `low-confidence` string is a code *comment* in `value-map/value-map-flow.tsx:165` — the actual fetch on the next line targets `/api/value-map/personal`, not this route. |
| `app/api/tools` dispatch | N/A |
| Edge Function callers | N/A |
| Tool-definition references | None. |
| `vercel.json` cron registration | None. |

**Source notes.** Single 17-line GET handler that returns `{ count: number }` of the user's transactions with `auto_category_confidence < 0.8 AND user_confirmed = false`. No comments suggesting a planned consumer. Likely supported a "low-confidence badge" in a UI surface that no longer exists (or is now derived server-side in the page loader).

- **Verdict:** **DEAD**
- **C1 action:** delete `src/app/api/transactions/low-confidence-count/route.ts`

---

### `/api/nudges/count`

| Check | Result |
|---|---|
| Frontend grep (`/api/nudges/count` literal) | **0 hits** |
| `fetch(...)` callers | **0**. The two `/api/nudges` callers in the codebase (`InboxRow.tsx:33`, `InboxClient.tsx:66`) hit `/api/nudges?status=pending&limit=5` — the count is derived client-side from the returned list length, not fetched separately. |
| `app/api/tools` dispatch | N/A |
| Edge Function callers | N/A |
| Tool-definition references | None. |
| `vercel.json` cron registration | None. |

**Source notes.** 16-line GET handler returning `{ count: number }` of pending nudges due now. A separate count endpoint would make sense for a "badge in nav with unread count" pattern, but the current navigation does not show a nudge badge — `NavigationBar.tsx` does not import this route. Likely planned and never wired.

- **Verdict:** **DEAD**
- **C1 action:** delete `src/app/api/nudges/count/route.ts`

---

### `/api/value-map/regenerate`

| Check | Result |
|---|---|
| Frontend grep (`value-map/regenerate` literal) | **2 hits** — both *server-only* sources: `app/api/value-map/regenerate/route.ts` (the route itself) and `app/api/value-map/personal/route.ts`. |
| `fetch(...)` callers | **0**. |
| Server-to-server import of `regenerateArchetype` (the function this HTTP route wraps) | **2** — `app/api/value-map/personal/route.ts:8` imports it and calls it directly (line 304) with reason `'retake_complete'`; the regenerate route calls the same function with reason `'manual'`. The HTTP route is *not* invoked over the wire from `personal/route.ts` — both routes invoke the lib function in-process. |
| `app/api/tools` dispatch | N/A |
| Edge Function callers | N/A |
| Tool-definition references | None. |

**Source notes.** 16-line POST handler. No body. Calls `regenerateArchetype(supabase, user.id, 'manual')`. The reason `'manual'` strongly implies an intended "user clicks Regenerate my archetype" UI button. **No such button exists today** in `ArchetypePageClient.tsx` (which only polls for an in-flight regen via `pendingRegen` — set when a fresh `personal` retake row exists without an archetype yet, expiring after 10 minutes; the regen itself is kicked off from inside `value-map/personal` POST, not by user click).

The endpoint is functionally an orphan, but its existence is a deliberate seam for a planned manual-regenerate button. Two reasonable reads:

1. **DEAD:** Lewis can rebuild it in a half-hour if the manual button ever ships.
2. **PLANNED:** The seam is harmless to keep, the cost of deleting + recreating later is low but non-zero.

I recommend FLAGGING this one for Lewis rather than auto-deleting. The other three routes have no such "designed for a future button" signal.

- **Verdict:** **FLAG-FOR-LEWIS** (lean DEAD, but defer to Lewis)
- **C1 action:** Lewis decides — delete with the others, or hold until the manual-regenerate button is on the roadmap.

---

## 3. Cron registration plan

### Current `cfos-office/vercel.json` cron block

```json
{
  "regions": ["dub1"],
  "crons": [
    {
      "path": "/api/cron/daily-bills",
      "schedule": "0 8 * * *"
    }
  ]
}
```

### Proposed updated cron block

```json
{
  "regions": ["dub1"],
  "crons": [
    {
      "path": "/api/cron/daily-bills",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/nudges-daily",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/cron/nudges-weekly",
      "schedule": "0 8 * * 1"
    },
    {
      "path": "/api/cron/nudges-monthly",
      "schedule": "0 8 1 * *"
    }
  ]
}
```

Rationale:

- **`nudges-daily`** at `0 7 * * *` UTC (07:00) — 08:00 London / 09:00 Madrid. Runs before `daily-bills` (which is at 08:00 UTC) so the day's bill-due nudges are queued before the bill expiry check overlaps.
- **`nudges-weekly`** at `0 8 * * 1` (Monday 08:00 UTC) — 09:00 London / 10:00 Madrid Monday. Action-item reminders + goal milestones land in the inbox at the start of the working week.
- **`nudges-monthly`** at `0 8 1 * *` (1st of month, 08:00 UTC) — monthly review prompt + upload reminder fire on the 1st, when the previous month's data is complete.

All schedules are UTC per Vercel cron semantics. Adjust London/Madrid offsets seasonally only if Lewis wants quiet-hour behaviour to track DST exactly — Vercel doesn't support TZ in cron expressions, so this is the cleanest baseline.

### CRON_SECRET usage check

| Route handler | Validates `CRON_SECRET`? | Line |
|---|---|---|
| `app/api/cron/daily-bills/route.ts` | ✅ yes | 6–7 |
| `app/api/cron/nudges-daily/route.ts` | ✅ yes | 16–17 |
| `app/api/cron/nudges-weekly/route.ts` | ✅ yes | 12–13 |
| `app/api/cron/nudges-monthly/route.ts` | ✅ yes | 12–13 |

Pattern in all four: `if (authHeader !== \`Bearer ${process.env.CRON_SECRET}\`) return 401`. **No security gap.** C1 can add the schedule entries without touching the route handlers.

Note: each of the three nudge routes still carries a `// TODO: Not registered in vercel.json` comment header — these can be removed in the same C1 commit that registers them.

### Open questions for Lewis

1. **Schedule sanity.** The proposed UTC times are reasonable defaults. If Lewis prefers a different quiet hour (e.g. early morning Madrid, late evening UK), say so before C1.
2. **Vercel cron vs Supabase pg_cron.** `DEFERRED.md` flagged this as an open architectural decision (Vercel = simpler/per-invocation cost; Supabase Edge Function + pg_cron = free, more moving parts). The proposal above assumes Vercel cron because the route handlers already exist as Next.js routes. Switching to Supabase Edge Functions later is non-trivial. Confirm Vercel before C1 ships.
3. **`/api/value-map/regenerate`.** Delete with the other three orphan routes, or keep as the seam for a planned manual-regenerate button?

---

## 4. Dependency dead weight

V2-AUDIT.md §7 found **none**. Of 22 runtime dependencies, every one is either statically imported, dynamically imported (`html2canvas`), TS-resolved (`@types/papaparse`), or a framework peer (`react-dom`).

`react-dom` was confirmed not used as a build-config plugin (`next.config.ts`, `postcss.config.mjs`, `tailwind.config.*` if present, `tsconfig.json` — none reference it directly). It is required by Next.js + React's renderer; removing it would break the build.

No dep changes proposed for C1.

---

## 5. Recommended C1 PR scope

Default proposal — single PR, 4 commits, all small:

- **Commit 1 — `chore: delete orphan prompt-buttons module`**
  Delete `cfos-office/src/lib/chat/prompt-buttons.ts` (130 LOC). No other file changes.

- **Commit 2 — `chore: delete orphan transaction/nudges API routes`**
  Delete:
    - `cfos-office/src/app/api/transactions/recategorise/route.ts`
    - `cfos-office/src/app/api/transactions/low-confidence-count/route.ts`
    - `cfos-office/src/app/api/nudges/count/route.ts`
  *(Optionally also `cfos-office/src/app/api/value-map/regenerate/route.ts` if Lewis confirms.)*

- **Commit 3 — `chore(cron): register nudge cron routes + drop TODO headers`**
  - `cfos-office/vercel.json`: add the three nudge cron entries.
  - Remove the `// TODO: Not registered in vercel.json` comment from each of the three `nudges-*/route.ts` handlers.

- **Commit 4 — `docs(claude): document undocumented env vars`**
  Append to `cfos-office/CLAUDE.md` env var section:
    - `BEDROCK_OPUS_MODEL` (used by `value-map/reveal`)
    - `BRAVE_SEARCH_API_KEY` (used by `lib/bills/brave-search.ts`)
    - `CRON_SECRET` (gates all four cron routes)
    - `RESEND_API_KEY` (alerting)
    - `ALERT_EMAIL` (alerting)
    - `ALERT_WEBHOOK_URL` (alerting)

Net change: **~165 LOC removed**, ~12 LOC added (cron entries + 6 env doc lines). Comfortably under 500 LOC. No code-path semantics change.

If Lewis defers `/api/value-map/regenerate`, drop it from Commit 2 — total still well under 500 LOC.

A C1b commit for "remove zero-import deps" is **not needed** — none exist.

---

## What this audit did NOT cover

- Component consolidation — owned by Session A3 (parallel track).
- Schema drift — already known; migrations 031–036 to apply Friday per existing plan.
- Test coverage gaps — deferred post-v2 per `LESSONS-LEARNED 2026-04-29`.
- Knip's other unused-export findings (in `cfos-office/docs/cleanup/track-3-dead-code.md`) — those are intra-file edits, separate ratchet.
