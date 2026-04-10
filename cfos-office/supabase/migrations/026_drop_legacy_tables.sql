-- Session 24, Part 2: Drop legacy MVP tables, triggers, functions

-- 2a. Drop the legacy auth trigger that creates duplicate profile rows (the dual-profile bug)
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.fn_handle_new_user();

-- 2b. Drop all triggers referencing legacy tables
-- cfo_visibility triggers
DROP TRIGGER IF EXISTS trg_visibility_bank_accounts ON public.bank_accounts;
DROP TRIGGER IF EXISTS trg_visibility_transactions ON public.transactions;
DROP TRIGGER IF EXISTS trg_visibility_debts ON public.debts;
DROP TRIGGER IF EXISTS trg_visibility_decisions ON public.decisions;
DROP TRIGGER IF EXISTS trg_visibility_financial_goals ON public.financial_goals;
DROP TRIGGER IF EXISTS trg_visibility_income_sources ON public.income_sources;
DROP TRIGGER IF EXISTS trg_visibility_investment_accounts ON public.investment_accounts;
DROP TRIGGER IF EXISTS trg_visibility_profiles ON public.profiles;
DROP TRIGGER IF EXISTS trg_visibility_user_intelligence ON public.user_intelligence;

-- financial_context triggers
DROP TRIGGER IF EXISTS trg_ctx_bank_accounts ON public.bank_accounts;
DROP TRIGGER IF EXISTS trg_ctx_debts ON public.debts;
DROP TRIGGER IF EXISTS trg_ctx_goals ON public.financial_goals;
DROP TRIGGER IF EXISTS trg_ctx_income ON public.income_sources;
DROP TRIGGER IF EXISTS trg_ctx_investments ON public.investment_accounts;
DROP TRIGGER IF EXISTS trg_ctx_conversations ON public.conversation_summaries;
DROP TRIGGER IF EXISTS trg_ctx_decisions ON public.decisions;

-- user_intelligence trigger
DROP TRIGGER IF EXISTS trg_ensure_user_intelligence ON public.user_events;

-- denormalization triggers
DROP TRIGGER IF EXISTS trg_txn_denorm ON public.transactions;
DROP TRIGGER IF EXISTS trg_budget_cat_denorm ON public.budget_categories;

-- user_id sync trigger (no longer needed after transactions column cleanup)
DROP TRIGGER IF EXISTS trg_sync_transaction_user_id ON public.transactions;

-- updated_at triggers on legacy tables
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
DROP TRIGGER IF EXISTS trg_agents_updated ON public.agents;
DROP TRIGGER IF EXISTS trg_decisions_updated ON public.decisions;
DROP TRIGGER IF EXISTS trg_goals_updated ON public.financial_goals;

-- 2c. Drop legacy functions
DROP FUNCTION IF EXISTS public.trigger_recompute_visibility();
DROP FUNCTION IF EXISTS public.compute_cfo_visibility(uuid);
DROP FUNCTION IF EXISTS public.fn_refresh_financial_context();
DROP FUNCTION IF EXISTS public.fn_ensure_user_intelligence();
DROP FUNCTION IF EXISTS public.fn_denorm_transaction();
DROP FUNCTION IF EXISTS public.fn_denorm_budget_cat();
DROP FUNCTION IF EXISTS public.fn_update_context_decisions();
DROP FUNCTION IF EXISTS public.sync_transaction_user_id();
DROP FUNCTION IF EXISTS public.fn_set_updated_at();
DROP FUNCTION IF EXISTS public.fn_session_feedback();
DROP FUNCTION IF EXISTS public.fn_import_batches();

-- 2d. Drop legacy tables (ordered by FK dependencies)

-- Zero-row infrastructure tables + legacy GDPR machinery we're replacing
DROP TABLE IF EXISTS public.agent_activity_log CASCADE;
DROP TABLE IF EXISTS public.agent_handoffs CASCADE;
DROP TABLE IF EXISTS public.agent_contexts CASCADE;
DROP TABLE IF EXISTS public.agents CASCADE;
DROP TABLE IF EXISTS public.conversation_summaries CASCADE;
DROP TABLE IF EXISTS public.periodic_reviews CASCADE;
DROP TABLE IF EXISTS public.budget_categories CASCADE;
DROP TABLE IF EXISTS public.budgets CASCADE;
DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.decisions CASCADE;
DROP TABLE IF EXISTS public.investment_transactions CASCADE;
DROP TABLE IF EXISTS public.eval_results CASCADE;
DROP TABLE IF EXISTS public.dsar_requests CASCADE;

-- Legacy tables with data (already truncated in 025)
DROP TABLE IF EXISTS public.cfo_visibility_history CASCADE;
DROP TABLE IF EXISTS public.cfo_visibility CASCADE;
DROP TABLE IF EXISTS public.financial_context CASCADE;
DROP TABLE IF EXISTS public.user_intelligence CASCADE;
DROP TABLE IF EXISTS public.onboarding_progress CASCADE;
DROP TABLE IF EXISTS public.insights CASCADE;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- MVP financial tables (replaced by session-built equivalents)
DROP TABLE IF EXISTS public.financial_goals CASCADE;
DROP TABLE IF EXISTS public.income_sources CASCADE;
DROP TABLE IF EXISTS public.investment_accounts CASCADE;
DROP TABLE IF EXISTS public.bank_accounts CASCADE;
DROP TABLE IF EXISTS public.debts CASCADE;

-- GDPR table we're replacing with improved version in 028
DROP TABLE IF EXISTS public.consent_records CASCADE;
