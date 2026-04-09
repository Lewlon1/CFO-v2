-- Session 24, Part 1: Wipe all test data
-- Preserves: categories, benchmarks, savings_tips, merchant_category_map

SET session_replication_role = 'replica';

-- Child tables first (FK dependencies)
TRUNCATE TABLE public.message_feedback CASCADE;
TRUNCATE TABLE public.llm_usage_log CASCADE;
TRUNCATE TABLE public.profiling_queue CASCADE;
TRUNCATE TABLE public.user_merchant_rules CASCADE;

-- Chat system
TRUNCATE TABLE public.messages CASCADE;
TRUNCATE TABLE public.conversations CASCADE;

-- Financial data
TRUNCATE TABLE public.monthly_snapshots CASCADE;
TRUNCATE TABLE public.recurring_expenses CASCADE;
TRUNCATE TABLE public.financial_portrait CASCADE;
TRUNCATE TABLE public.action_items CASCADE;
TRUNCATE TABLE public.nudges CASCADE;
TRUNCATE TABLE public.goals CASCADE;
TRUNCATE TABLE public.trips CASCADE;

-- Value Map
TRUNCATE TABLE public.value_map_results CASCADE;
TRUNCATE TABLE public.value_category_rules CASCADE;
TRUNCATE TABLE public.value_map_sessions CASCADE;

-- Balance sheet
TRUNCATE TABLE public.net_worth_snapshots CASCADE;
TRUNCATE TABLE public.assets CASCADE;
TRUNCATE TABLE public.liabilities CASCADE;
TRUNCATE TABLE public.investment_holdings CASCADE;
TRUNCATE TABLE public.accounts CASCADE;

-- Transactions
TRUNCATE TABLE public.transactions CASCADE;

-- Analytics
TRUNCATE TABLE public.user_events CASCADE;

-- Demo tables
TRUNCATE TABLE public.demo_sessions CASCADE;
TRUNCATE TABLE public.demo_question_responses CASCADE;
TRUNCATE TABLE public.demo_waitlist CASCADE;

-- User profiles (canonical)
TRUNCATE TABLE public.user_profiles CASCADE;

-- Legacy tables (dropped in 026; wiped first for clean FK resolution)
TRUNCATE TABLE public.chat_messages CASCADE;
TRUNCATE TABLE public.cfo_visibility_history CASCADE;
TRUNCATE TABLE public.cfo_visibility CASCADE;
TRUNCATE TABLE public.financial_context CASCADE;
TRUNCATE TABLE public.user_intelligence CASCADE;
TRUNCATE TABLE public.onboarding_progress CASCADE;
TRUNCATE TABLE public.insights CASCADE;
TRUNCATE TABLE public.eval_results CASCADE;
TRUNCATE TABLE public.agent_activity_log CASCADE;
TRUNCATE TABLE public.agent_handoffs CASCADE;
TRUNCATE TABLE public.agent_contexts CASCADE;
TRUNCATE TABLE public.conversation_summaries CASCADE;
TRUNCATE TABLE public.periodic_reviews CASCADE;
TRUNCATE TABLE public.decisions CASCADE;
TRUNCATE TABLE public.investment_transactions CASCADE;
TRUNCATE TABLE public.budget_categories CASCADE;
TRUNCATE TABLE public.budgets CASCADE;
TRUNCATE TABLE public.audit_log CASCADE;
TRUNCATE TABLE public.consent_records CASCADE;
TRUNCATE TABLE public.dsar_requests CASCADE;
TRUNCATE TABLE public.third_party_data_flows CASCADE;
TRUNCATE TABLE public.financial_goals CASCADE;
TRUNCATE TABLE public.income_sources CASCADE;
TRUNCATE TABLE public.debts CASCADE;
TRUNCATE TABLE public.investment_accounts CASCADE;
TRUNCATE TABLE public.bank_accounts CASCADE;
TRUNCATE TABLE public.agents CASCADE;
TRUNCATE TABLE public.profiles CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';
