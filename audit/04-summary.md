# Phase 4 — AI Tools & Edge Functions Summary

## Tools registry vs disk

- **23 tool implementations** on disk under `cfos-office/src/lib/ai/tools/` (excluding `index.ts`, `helpers.ts`, `types.ts`).
- **23 tools registered** in `cfos-office/src/lib/ai/tools/index.ts::createToolbox`.
- **Perfect 1:1 mapping. No orphan tools, no missing registrations.**

Full registered toolbox (snake_case key → file):

| Tool key | File |
|---|---|
| `get_spending_summary` | `get-spending-summary.ts` |
| `compare_months` | `compare-months.ts` |
| `get_value_breakdown` | `get-value-breakdown.ts` |
| `calculate_monthly_budget` | `calculate-monthly-budget.ts` |
| `get_action_items` | `get-action-items.ts` |
| `create_action_item` | `create-action-item.ts` |
| `model_scenario` | `model-scenario.ts` |
| `analyse_gap` | `analyse-gap.ts` |
| `suggest_value_recategorisation` | `suggest-value-recategorisation.ts` |
| `get_value_review_queue` | `get-value-review-queue.ts` |
| `record_value_classifications` | `record-value-classifications.ts` |
| `delete_value_rule` | `delete-value-rule.ts` |
| `check_value_checkin_ready` | `check-value-checkin-ready.ts` |
| `search_bill_alternatives` | `search-bill-alternatives.ts` |
| `plan_trip` | `plan-trip.ts` |
| `upsert_asset` | `upsert-asset.ts` |
| `upsert_liability` | `upsert-liability.ts` |
| `get_balance_sheet` | `get-balance-sheet.ts` |
| `calculate_debt_payoff` | `calculate-debt-payoff.ts` |
| `calculate_pension_projection` | `calculate-pension-projection.ts` |
| `calculate_emergency_fund` | `calculate-emergency-fund.ts` |
| `get_net_worth_history` | `get-net-worth-history.ts` |
| `create_goal` | `create-goal.ts` |

## Schema integrity

- **Every tool defines a Zod `inputSchema`** that matches its `execute({...})` destructuring signature. The Vercel AI SDK enforces this at compile time, so input-side drift cannot accumulate silently.
- **No tool defines an `outputSchema`**. Tool return shapes are implicit — whatever `execute` returns is what the LLM sees. This is a design choice (no runtime contract on output), not drift.
- **Verdict: no schema drift bugs identified.** A separate audit pass would be needed to check whether each tool's `description` field still accurately describes the behaviour of `execute` (semantic drift), but that's prompt-quality work, not schema work.

## Production tool-call observability — critical finding

**Symptom:** I cannot tell from production telemetry whether any of the 23 tools are actually being invoked end-to-end.

**Evidence:**

1. `llm_usage_log` table (project `iccelmjenljanqrhhzdv`) has **13 rows total**, with the following `call_type` distribution:
   - `screenshot_parse` — 5
   - `pdf_transaction_parse` — 5
   - `value_map_reading` — 2
   - `format_detection` — 1
   - **`chat` / `tool_call` / `post_conversation_analysis`** — **0 rows**

2. `messages` table has **146 assistant messages**, but **0 of them have a non-empty `tools_used` array**. The most recent assistant message is **2026-04-24** (~3 weeks before today's date 2026-05-13).

3. CLAUDE.md "Known data limitations" states `tools_used` is populated forward-only from the S-W1.5-10 deploy. The cutoff in CLAUDE.md is **2026-05-03**. Every assistant message in production predates that cutoff, so it's expected they're empty — but the more concerning observation is the **3-week production silence on the chat route**.

4. CLAUDE.md "Operational alarm" section explicitly flags this: zero `post_conversation_analysis` entries in `llm_usage_log` despite 28+ completed conversations was the failure mode of S-W1.5-11. The current state (0 such entries; 40 conversations in `conversations`) suggests **the post-conversation extraction pipeline may still be silently failing**.

**Recommendation for cleanup session:** Before pruning any "stale" tool, instrument production with proper tool-call logging (write each tool invocation to `llm_usage_log` with `call_type = 'tool_call'` and `metadata.tool_name`). Without it, "is this tool used?" is unanswerable from data.

## Edge Functions

- **`list_edge_functions` returned `[]`** for project `iccelmjenljanqrhhzdv`. **No Edge Functions deployed.**
- This conflicts with `CLAUDE.md` architecture description: *"Background: Supabase Edge Functions + pg_cron"*.
- The actual background-work path appears to be **Vercel cron** hitting `/api/cron/*` routes (the codebase has cron handlers under `src/app/api/cron/`). The CLAUDE.md description is stale — should say "Vercel cron + pg_cron" not "Supabase Edge Functions + pg_cron".
- **Not a bug** — just documentation drift. Constitution-level fix: update CLAUDE.md.

## Verdict

| Risk | Status |
|---|---|
| Orphan tools (disk-only) | ✅ None |
| Stale tools (registered, never built) | ✅ None |
| Schema drift (Zod vs implementation) | ✅ None (input side enforced; no output schemas to drift) |
| Production observability | ⚠️ **Insufficient** — chat-route tool calls are not being logged anywhere durable |
| Edge Functions | ✅ Zero on remote; intended cron path is Vercel `/api/cron/*` |
| Documentation drift | ⚠️ CLAUDE.md describes Edge Functions but they don't exist on this project |
