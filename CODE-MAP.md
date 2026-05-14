# Code Map — May 2026

*A truthful read of the codebase before the next refactor lands. Read-only audit, 2026-05-13. All paths are relative to repo root unless noted; source code lives in `cfos-office/`.*

Per-phase detail lives under `audit/0X-*.md`. This document is the synthesis.

---

## Summary

| Surface | Headline |
|---|---|
| **Routes** | 98 files, 79 live · 14 orphan · 0 ambiguous. 1 orphan page (`/v4`); 13 orphan API endpoints. |
| **Components** | 113 files. ~19 truly orphan; ~44 are feature-local (relative imports — healthy). 3 EmptyState variants is the only real duplicate cluster. v2.4 data primitives layer was built but never adopted. |
| **AI Tools** | 23 implementations, 23 registered. **Zero orphans. Zero schema drift.** Production has no tool-call observability — `llm_usage_log` only captures parsing, not chat. |
| **Edge Functions** | None deployed. CLAUDE.md describes "Supabase Edge Functions + pg_cron"; actual path is Vercel cron via `/api/cron/*`. Documentation drift. |
| **Schema** | 37 public tables. **4 dead** (`active_experiments`, `dsar_requests`, `savings_tips`, `third_party_data_flows`). 1 likely-dead (`merchant_category_map`, superseded by `user_merchant_rules`). 4 scaffolded-but-dormant. No structural drift. |
| **Prompts** | 9 prompt-bearing files. 4 read fully; 5 time-boxed. **7 contradictions in BASE_PERSONA alone**, 8 constitution gaps. The "— C." sign-off rule is absent everywhere. |
| **Branches** | 4 local, all touched in the last 7 days. No stale branches. |
| **Migrations** | 41 on-disk files. Latest 4 (`038`–`041`) are applied to production but not tracked in `supabase_migrations.schema_migrations`. |
| **Dead code** | 30 "unused files" per knip (≈14 false positives — test files). 6 root-level debug scripts are obvious deletions. ~12 unused functions in `analytics/pattern-detectors.ts`. |

---

## Verdict — rebuild vs refactor

**Refactor, not rebuild.** The bones are clean: schema discipline shows, AI tools are perfectly aligned with their registry, and branch hygiene is excellent. The mess is concentrated in three places: prompt drift (which is structural but localised to ~9 files), an unadopted primitives layer in `components/data/`, and ~14 orphan routes from v1 onboarding and old dashboard endpoints. None of these warrant starting over. The biggest single-file lever is `cfos-office/src/lib/ai/system-prompt.ts` — a 101-line rewrite that re-derives BASE_PERSONA from the constitution would resolve most of the persona drift across all 18 system-prompt layers because they all build on top of it.

Unexpected finding worth flagging: production has been quiet for ~3 weeks (last assistant message 2026-04-24) and chat-route tool calls are not being logged anywhere durable. Before doing any "is this tool used?" analysis in the cleanup session, instrument `llm_usage_log` to write a row per tool invocation. Without it, usage is unanswerable from data.

---

## Cleanup plan

Ordered safest-first. Each item is independently shippable.

### Safety tier 1 — pure deletion (no judgment calls)

1. **Delete 6 root-level debug scripts** in `cfos-office/`: `apply-migration.ts`, `check-staging.ts`, `check-staging2.ts`, `check-staging3.ts`, `test-normalise.ts`, `test-rules.ts`.
2. **Delete unused v2.4 primitives** — `cfos-office/src/components/data/MetricTile.tsx`, `data/ValuePill.tsx`, `data/FolderCard.tsx`. Zero consumers each.
3. **Delete 4 dead tables** (after Lewis sign-off): `active_experiments`, `dsar_requests`, `savings_tips`, `third_party_data_flows`. None have application-code references; `savings_tips` and `third_party_data_flows` have seed data but no consumer.
4. **Delete `claude/nervous-shannon-750502` branch.** Identical head to `claude/audit-codebase-map-6NrOr`. Pure duplicate.
5. **Delete orphan API route `POST /api/onboarding/complete`** — superseded by `/onboarding-v2/*` flow; zero callers.
6. **Delete page `/v4`** — likely an old demo/landing route; zero inbound references.

### Safety tier 2 — short cleanup with light verification

7. **Delete `analytics/pattern-detectors.ts` exports that nothing imports** (12 functions: `merchantFragmentation`, `transactionSizeDistribution`, `categoryConcentration`, `spendingVelocity`, `recurringExpenseTotal`, `dayOfWeekSkew`, `convenienceVsPlanned`, `incomeDetected`, `valueMapGap`, `geographicSpendingModes`, `monthOverMonthTrend`, `balanceTrajectory`). Verify they aren't dynamically dispatched by string in `insight-engine.ts` before deleting.
8. **Delete `analytics/onboarding-events.ts`** — knip flags whole file; cross-check the React `useTrackOnboarding` hook isn't lazy-imported.
9. **Delete `merchant_category_map` write site at `components/value-map/value-map-flow.tsx:357` and drop the table.** It's superseded by `user_merchant_rules` (58 rows, healthy).
10. **Consolidate three EmptyState variants** (`balance-sheet/EmptyState.tsx`, `dashboard/EmptyState.tsx`, `office/dashboards/DashboardEmptyState.tsx`) onto the office one. Lift to `components/data/` if a primitive seems durable.
11. **Delete orphan API routes** `GET /api/dashboard/summary`, `GET /api/dashboard/trends`, `GET /api/bills/history`, `POST /api/analyze-conversation`, `POST /api/value-map/regenerate`, `GET /api/value-map/personal/impact`, `GET /api/balance-sheet`, `GET /api/balance-sheet/holdings`, `GET /api/profile/export/profile`, `GET /api/profile/export/transactions`. Each needs a 1-line "anything in production hits this?" check (none should).

### Safety tier 3 — code health, not deletion

12. **Backfill `supabase_migrations.schema_migrations`** with entries for migrations 038/039/040/041 so a clean staging rebuild from tracked migrations works.
13. **Update CLAUDE.md** to reflect actual architecture: 18 system-prompt layers (not 7), Vercel cron (not Supabase Edge Functions).
14. **Instrument `llm_usage_log`** with `call_type = 'tool_call'` writes on every tool invocation in the chat route. Required before any future "which tools are used?" analysis.
15. **Standardise component export style** in `office/dashboards/*.tsx` and `office/sections/*.tsx` — pick `export default` *or* `export function`, not both. knip flagged 17 such duplicates.

---

## Reconciliation plan — decisions needed before changes

These items need a Lewis call before code moves:

1. **`/chat` route resolution.** Multiple files redirect to `/chat` but no `app/chat/page.tsx` exists. Is this handled by middleware rewrite, by `chat/[id]/page.tsx`, or is it a broken redirect? Decide before touching the route table.
2. **`/transactions` and `/bills` link paths.** Some components link to `/transactions`; actual page is `/office/cash-flow/transactions`. Either fix the links or add the rewrites; pick one.
3. **Dormant scaffolded tables** (`nudges`, `correction_signals`, `investment_holdings`, `accounts`). Code paths exist but tables are empty. Decide per-table: enable the feature (build the consumer) or remove the table and the code paths.
4. **Voice tunability** — the `gentle` style modifier ("Be encouraging while still being truthful") edges into flattery, which constitution §1 forbids. Decide: keep `gentle` and update §1, or drop the tunability.
5. **Archetype fallback subtitles** — phrases like "Your money moves without a plan" (drifter) and "safety can become its own kind of cage" (fortress) edge into roasting/lecturing, which §1 forbids. Decide: keep the poetic edge or tighten the subtitles.
6. **Third-party signposting** in `ADVISORY_BOUNDARIES` (MoneySavingExpert, Finanztest, NerdWallet). Constitution §4 prohibits commercial interest. Naming third-party comparison services is borderline. Decide: keep or drop.

---

## Constitution updates required

Things the prompt audit revealed that should be added to or clarified in `CFO-CONSTITUTION.md`:

1. **"Honour the user's exact terms"** — splits, dates, and amounts the user provides are authoritative. Belongs in §5 or §6.
2. **"Never use 'advice' or 'advise'"** — say "guidance", "suggestion", or just what you'd do. Belongs in §2 (phrases the CFO never uses).
3. **Tangible-comparison framing** ("that's a weekend in Porto every month") — currently in `BASE_PERSONA` and CLAUDE.md but absent from the constitution. Decide: voice rule or copywriting flourish. If the former, lift into §2.
4. **Clarify pushback vs correction.** §7 says "the CFO does not capitulate to social pressure". The prompt's "user's most recent message overrides everything" rule needs the constitution to explicitly distinguish *user-data corrections* (override) from *analytical disputes* (re-state basis).
5. **Voice tunability** — is `blunt | direct | gentle` a constitutional thing? If yes, codify in §2 with the rules for each. If no, drop the `gentle` modifier.
6. **Decide on first-person rule.** Constitution §2: prefer "your CFO" except for direct opinion. `BASE_PERSONA`: "First person singular. Always." These cannot both stand.
7. **Discipline-score-based tone bands** — `buildFirstInsightContext` adjusts framing for >70 / 40–70 / <40 score tiers. Worth lifting as a §6 principle ("calibration to user state") or keeping prompt-side. Decide.

---

## What stays

These parts came out clean and don't need touching in the next cleanup:

- **Schema** — 37 tables, no structural drift, RLS enabled on every table. The discipline shows.
- **AI tools** — 23 implementations and 23 registrations are in perfect 1:1 alignment. No orphans, no missing registrations. Every tool has a Zod `inputSchema` enforced at compile time. No schema drift bugs.
- **The Gap analytical move** — `buildPortraitContext`, `buildValueMapCompletePrompt`, and the post-upload "Path A" prompt enforce §5 consistently and well. The "name the gap, lead with a number" rule in `buildPostUploadPrompt` directly matches canonical exchange §9.E.
- **Anti-hallucination quotable-facts whitelist** in `buildFirstInsightContext` — strictest enforcement of §5 "When data is missing" in the codebase. Keep as-is.
- **Boundary enforcement** — the "no product recommendations" rule is consistently applied across `BASE_PERSONA` (lines 17–20) and `ADVISORY_BOUNDARIES` (1100s). §4 is upheld.
- **Branch hygiene** — no stale branches, no abandoned WIP. Pattern is healthy.
- **Test layout** — `tests/onboarding/` is appropriately scoped and excluded from auto-discovery; the false positives from knip don't reflect a real problem.
- **Component patterns by feature folder** — `landing/`, `navigation/`, `onboarding-v2/`, `brand/`, `theme/`, `trips/`, `scenarios/`, `settings/`, `ui/`, `values/` are 100% live. The mess is concentrated, not spread.

---

## Audit hygiene

- **Phases completed:** 8 / 8. No phases marked incomplete.
- **Phase 6 time-boxing:** 4 of 9 prompt files were read end-to-end (the highest-priority ones); 5 are queued for a follow-up pass. Sufficient to ground every finding in real text, but a future pass on `regenerate-archetype-prompt.ts`, `demo/reading/route.ts`, `value-map/reveal/route.ts`, and inline fragments in `chat/route.ts` is recommended before the prompt rewrite session.
- **Read-only verified:** `git diff main..audit/codebase-map-2026-05` shows changes only under `audit/` and the addition of `CODE-MAP.md`. No application code touched. No Supabase writes performed (queries: `SELECT` and `information_schema` only against project `iccelmjenljanqrhhzdv`).

---

*Run before the cleanup. The map comes first.*
