# Deferred Items — tracking work intentionally pushed out of Session 26

> Last reviewed: 2026-05-03 (Session 27 — doc cleanup).

These items were considered in Session 26 but explicitly deferred. Each should get its own session when the time is right.

---

## ✅ RESOLVED — Multi-document upload

`UploadZone.tsx` now has `multiple` on the file input (line 62) and uses `Array.from(e.target.files ?? [])` / `Array.from(e.dataTransfer.files)` so both drag-and-drop and the file picker hand a `File[]` to `onFiles`. Resolved between Session 26 and 2026-05-03.

---

## ✅ RESOLVED — Cron route registration

`vercel.json` now registers all four cron entries: `daily-bills`, `nudges-daily`, `nudges-weekly`, `nudges-monthly`. Resolved by **Session C1, commit `4b32367`** (2026-05-01). Decision taken: Vercel cron (not Supabase pg_cron). All four handlers validate `CRON_SECRET`. Note from C1: routes won't fire until the next scheduled UTC tick — confirm on the Vercel dashboard after deploy.

---

## Bill extraction pipeline

- **Where:** `BillsClient` has upload UI + `BillUploadModal`, but the extraction pipeline (Bedrock vision → structured data → user-confirmation → `recurring_expenses` upsert) may be partial
- **Verify:** upload a bill image end-to-end before assuming this is complete
- **If incomplete:** schedule a session for the vision+confirm flow
- **Priority:** P2

---

## Large purchase research tool

- **What:** Claude tool to research a major purchase decision (e.g. car, laptop) with web search + pros/cons
- **Why deferred:** new feature, needs its own design session with tool-calling architecture
- **Priority:** P3

---

## Wedding / party planning scenario

- **What:** Extend the scenario model to cover one-time large events beyond the standard "salary change / property / children" set
- **Priority:** P3 — the new "Something else" What If card covers this via chat in the short term

---

## Screenshot upload reliability

- **What:** Bedrock vision accuracy varies on bank statement screenshots; investigate common failure modes, tune prompts, add user correction UI
- **Priority:** P2 — impacts trust

---

## Android testing

- **What:** Full QA pass on Android Chrome / Samsung Internet
- **Priority:** P3 — defer until iOS is stable
