# Deferred Items — tracking work intentionally pushed out of Session 26

These items were considered in Session 26 but explicitly deferred. Each should get its own session when the time is right.

---

## Multi-document upload

- **Where:** `cfos-office/src/components/upload/UploadZone.tsx:38-48` — currently only reads `e.target.files?.[0]`, no `multiple` attribute
- **Fix:** add `multiple` attribute, loop through `FileList` calling `/api/upload` once per file, track progress
- **Priority:** P3 — single-file upload works; multi-upload is convenience, not blocking beta
- **Deferred:** Session 26 — by user decision

---

## Cron route registration

- **Where:** `cfos-office/src/app/api/cron/nudges-daily/`, `nudges-weekly/`, `nudges-monthly/`
- **Problem:** These three routes exist but are not registered in `cfos-office/vercel.json` (only `daily-bills` is). They never run.
- **Decision needed:** Vercel cron (simple, but costs per invocation) vs Supabase Edge Functions + pg_cron (free, but more moving parts)
- **Priority:** P2 — affects nudge delivery, which is a planned Session 11 feature

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
