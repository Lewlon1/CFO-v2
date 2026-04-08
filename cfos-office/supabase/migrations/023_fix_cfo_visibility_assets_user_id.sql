-- Fix compute_cfo_visibility for the Session 19A balance-sheet schema.
--
-- The legacy function references `assets.profile_id`, but the new `assets`
-- and `liabilities` tables introduced in 022_balance_sheet.sql key on
-- `user_id`. Every analytics event insert hits this function via the
-- fn_ensure_user_intelligence trigger chain and 500s with:
--   ERROR: 42703: column "profile_id" does not exist
--   QUERY: EXISTS (SELECT 1 FROM assets WHERE profile_id = p_id)
--
-- This migration patches the assets check to use user_id and adds a
-- parallel check for the new liabilities table (also keyed on user_id),
-- falling back to the legacy `debts` table when liabilities is absent.

CREATE OR REPLACE FUNCTION public.compute_cfo_visibility(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cashflow      numeric := 0;
  v_balance       numeric := 0;
  v_goals         numeric := 0;
  v_identity      numeric := 0;
  v_behaviour     numeric := 0;
  v_overall       numeric := 0;

  v_tx_months         integer := 0;
  v_tx_count          integer := 0;
  v_tx_cat_pct        numeric := 0;
  v_last_tx_days      integer := 999;
  v_goals_count       integer := 0;
  v_decisions_count   integer := 0;

  v_tier          text;
  v_prev_tier     text;
  v_message       text;
  v_priority_gap  text;
  v_lowest_score  numeric;

  v_cashflow_visible    text[] := '{}';
  v_cashflow_gaps       text[] := '{}';
  v_balance_visible     text[] := '{}';
  v_balance_gaps        text[] := '{}';
  v_goals_visible       text[] := '{}';
  v_goals_gaps          text[] := '{}';
  v_identity_visible    text[] := '{}';
  v_identity_gaps       text[] := '{}';
  v_behaviour_visible   text[] := '{}';
  v_behaviour_gaps      text[] := '{}';

  v_cashflow_impact     text;
  v_balance_impact      text;
  v_goals_impact        text;
  v_identity_impact     text;
  v_behaviour_impact    text;

  v_next_question       text;
  v_question_queue      text[] := '{}';
  v_signals             jsonb := '{}';

BEGIN

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_id) THEN
    RETURN;
  END IF;

  SELECT narrative_tier INTO v_prev_tier FROM cfo_visibility WHERE profile_id = p_id;

  -- SECTION 1: CASHFLOW
  SELECT COALESCE(EXTRACT(MONTH FROM AGE(MAX(transaction_date), MIN(transaction_date)))::integer, 0)
  INTO v_tx_months FROM transactions WHERE profile_id = p_id AND deleted_at IS NULL;

  v_cashflow := v_cashflow + CASE
    WHEN v_tx_months >= 12 THEN 30 WHEN v_tx_months >= 6 THEN 22
    WHEN v_tx_months >= 3  THEN 15 WHEN v_tx_months >= 1 THEN 8 ELSE 0 END;

  IF v_tx_months >= 1 THEN
    v_cashflow_visible := array_append(v_cashflow_visible, v_tx_months || ' month(s) of transaction history');
  ELSE
    v_cashflow_gaps := array_append(v_cashflow_gaps, 'No transaction history uploaded');
    v_question_queue := array_append(v_question_queue, 'Would you like to upload your bank statements? Even 1 month of transactions helps me give you personalised advice.');
  END IF;

  SELECT COUNT(*), ROUND(100.0 * COUNT(category_id)::numeric / NULLIF(COUNT(*),0), 1)
  INTO v_tx_count, v_tx_cat_pct FROM transactions WHERE profile_id = p_id AND deleted_at IS NULL;

  v_cashflow := v_cashflow + LEAST(20, (v_tx_cat_pct / 100.0) * 20);

  IF v_tx_cat_pct >= 90 THEN
    v_cashflow_visible := array_append(v_cashflow_visible, 'Spending fully categorised');
  ELSIF v_tx_cat_pct > 0 THEN
    v_cashflow_gaps := array_append(v_cashflow_gaps, ROUND(100 - v_tx_cat_pct)::text || '% of transactions need categories');
  END IF;

  IF EXISTS (SELECT 1 FROM income_sources WHERE profile_id = p_id AND is_active = true) THEN
    v_cashflow := v_cashflow + 15;
    v_cashflow_visible := array_append(v_cashflow_visible, 'Income source(s) declared');
  ELSE
    v_cashflow_gaps := array_append(v_cashflow_gaps, 'No income source declared');
    v_question_queue := array_append(v_question_queue, 'To give you accurate savings and budget advice, I need to know your income. What''s your approximate monthly take-home pay?');
  END IF;

  SELECT COALESCE(EXTRACT(DAY FROM NOW() - MAX(transaction_date))::integer, 999)
  INTO v_last_tx_days FROM transactions WHERE profile_id = p_id AND deleted_at IS NULL;

  v_cashflow := v_cashflow + CASE
    WHEN v_last_tx_days <= 7  THEN 20 WHEN v_last_tx_days <= 30 THEN 15
    WHEN v_last_tx_days <= 60 THEN 8  WHEN v_last_tx_days <= 90 THEN 3 ELSE 0 END;

  IF v_last_tx_days > 30 THEN
    v_cashflow_gaps := array_append(v_cashflow_gaps, 'Transactions not updated in ' || v_last_tx_days || ' days');
    v_question_queue := array_append(v_question_queue, 'Your transactions haven''t been updated in a while — want to upload a recent statement so I''m working with current numbers?');
  ELSE
    v_cashflow_visible := array_append(v_cashflow_visible, 'Transactions up to date');
  END IF;

  IF EXISTS (SELECT 1 FROM transactions WHERE profile_id = p_id AND is_recurring = true AND deleted_at IS NULL) THEN
    v_cashflow := v_cashflow + 15;
    v_cashflow_visible := array_append(v_cashflow_visible, 'Recurring payments identified');
  ELSE
    v_cashflow_gaps := array_append(v_cashflow_gaps, 'No recurring payments identified');
  END IF;

  v_cashflow := LEAST(100, v_cashflow);
  v_cashflow_impact := 'Cashflow visibility lets me compare your spending against benchmarks and spot savings opportunities automatically.';
  v_signals := v_signals || jsonb_build_object('tx_months', v_tx_months, 'tx_count', v_tx_count, 'tx_cat_pct', v_tx_cat_pct, 'last_tx_days', v_last_tx_days);

  -- SECTION 2: BALANCE SHEET
  IF EXISTS (SELECT 1 FROM investment_accounts WHERE profile_id = p_id AND deleted_at IS NULL) THEN
    v_balance := v_balance + 25; v_balance_visible := array_append(v_balance_visible, 'Investment accounts');
  ELSE
    v_balance_gaps := array_append(v_balance_gaps, 'No investment accounts');
    v_question_queue := array_append(v_question_queue, 'Do you have any investments — stocks, ISAs, crypto, or a trading account? Even a rough total helps me assess your overall wealth picture.');
  END IF;

  -- Session 19A liabilities table uses user_id; fall back to legacy debts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'liabilities') THEN
    IF EXISTS (SELECT 1 FROM liabilities WHERE user_id = p_id) THEN
      v_balance := v_balance + 25; v_balance_visible := array_append(v_balance_visible, 'Debts and liabilities');
    ELSE
      v_balance_gaps := array_append(v_balance_gaps, 'Debts not declared (or confirmed as zero)');
      v_question_queue := array_append(v_question_queue, 'Do you have any outstanding debts — loans, credit cards, or a mortgage? If not, just let me know and I''ll note it.');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM debts WHERE profile_id = p_id AND is_active = true AND deleted_at IS NULL) THEN
    v_balance := v_balance + 25; v_balance_visible := array_append(v_balance_visible, 'Debts and liabilities');
  ELSE
    v_balance_gaps := array_append(v_balance_gaps, 'Debts not declared (or confirmed as zero)');
    v_question_queue := array_append(v_question_queue, 'Do you have any outstanding debts — loans, credit cards, or a mortgage? If not, just let me know and I''ll note it.');
  END IF;

  IF EXISTS (SELECT 1 FROM bank_accounts WHERE profile_id = p_id AND is_active = true AND deleted_at IS NULL) THEN
    v_balance := v_balance + 25; v_balance_visible := array_append(v_balance_visible, 'Bank account balances');
  ELSE
    v_balance_gaps := array_append(v_balance_gaps, 'No bank accounts linked');
  END IF;

  -- Session 19A assets table uses user_id (was profile_id in legacy schema)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assets') THEN
    IF EXISTS (SELECT 1 FROM assets WHERE user_id = p_id) THEN
      v_balance := v_balance + 25; v_balance_visible := array_append(v_balance_visible, 'Property and other assets');
    ELSE
      v_balance_gaps := array_append(v_balance_gaps, 'Property, pension, and other assets unknown');
      v_question_queue := array_append(v_question_queue, 'Do you own property or have a pension? These are often the biggest parts of someone''s net worth — I''d like to include them.');
    END IF;
  ELSE
    v_balance_gaps := array_append(v_balance_gaps, 'Property and pension not yet trackable');
  END IF;

  v_balance := LEAST(100, v_balance);
  v_balance_impact := 'Knowing your full balance sheet lets me calculate your true net worth and give you a complete financial health picture.';

  -- SECTION 3: GOALS & LIFE PLAN
  SELECT COUNT(*) INTO v_goals_count FROM financial_goals WHERE profile_id = p_id AND status = 'active' AND deleted_at IS NULL;

  IF v_goals_count >= 1 THEN
    v_goals := v_goals + 30; v_goals_visible := array_append(v_goals_visible, v_goals_count || ' active goal(s)');
  ELSE
    v_goals_gaps := array_append(v_goals_gaps, 'No goals defined');
    v_question_queue := array_append(v_question_queue, 'What''s the one financial thing you most want to achieve in the next 12 months? Setting a goal gives me a direction to aim all my advice.');
  END IF;

  IF EXISTS (SELECT 1 FROM financial_goals WHERE profile_id = p_id AND target_amount IS NOT NULL AND target_date IS NOT NULL AND deleted_at IS NULL) THEN
    v_goals := v_goals + 25; v_goals_visible := array_append(v_goals_visible, 'Goals with amounts and deadlines');
  ELSIF v_goals_count > 0 THEN
    v_goals_gaps := array_append(v_goals_gaps, 'Some goals missing target amounts or dates');
  END IF;

  IF (
    EXISTS (SELECT 1 FROM financial_goals WHERE profile_id = p_id AND deleted_at IS NULL AND target_date IS NOT NULL AND target_date <= (now() + interval '2 years')::date) AND
    EXISTS (SELECT 1 FROM financial_goals WHERE profile_id = p_id AND deleted_at IS NULL AND (target_date IS NULL OR target_date > (now() + interval '2 years')::date))
  ) THEN
    v_goals := v_goals + 25; v_goals_visible := array_append(v_goals_visible, 'Short and long-term goals');
  ELSIF v_goals_count > 0 THEN
    v_goals_gaps := array_append(v_goals_gaps, 'Only one time horizon covered');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'life_events') THEN
    IF EXISTS (SELECT 1 FROM life_events WHERE profile_id = p_id) THEN
      v_goals := v_goals + 20; v_goals_visible := array_append(v_goals_visible, 'Life events planned');
    ELSE
      v_goals_gaps := array_append(v_goals_gaps, 'No upcoming life events declared');
      v_question_queue := array_append(v_question_queue, 'Are there any big life events coming up in the next few years — moving house, having children, changing jobs, or retiring?');
    END IF;
  ELSE
    v_goals_gaps := array_append(v_goals_gaps, 'Life event planning not yet available');
  END IF;

  v_goals := LEAST(100, v_goals);
  v_goals_impact := 'Goals give me a direction — without them I''m giving general advice rather than advice specific to your life.';

  -- SECTION 4: IDENTITY & CONTEXT
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND country IS NOT NULL) THEN
    v_identity := v_identity + 15; v_identity_visible := array_append(v_identity_visible, 'Country');
  ELSE v_identity_gaps := array_append(v_identity_gaps, 'Country unknown'); END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND risk_tolerance IS NOT NULL) THEN
    v_identity := v_identity + 15; v_identity_visible := array_append(v_identity_visible, 'Risk tolerance');
  ELSE
    v_identity_gaps := array_append(v_identity_gaps, 'Risk tolerance not set');
    v_question_queue := array_append(v_question_queue, 'How do you feel about financial risk? Are you comfortable with volatility for higher returns, or do you prefer stability?');
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND tax_bracket IS NOT NULL) THEN
    v_identity := v_identity + 20; v_identity_visible := array_append(v_identity_visible, 'Tax bracket');
  ELSE
    v_identity_gaps := array_append(v_identity_gaps, 'Tax bracket unknown');
    v_question_queue := array_append(v_question_queue, 'Do you know roughly which income tax band you''re in? This lets me flag tax-saving opportunities like ISA or pension allowances.');
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND date_of_birth IS NOT NULL) THEN
    v_identity := v_identity + 20; v_identity_visible := array_append(v_identity_visible, 'Age and life stage');
  ELSE v_identity_gaps := array_append(v_identity_gaps, 'Age not provided'); END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND household_size IS NOT NULL) THEN
    v_identity := v_identity + 30; v_identity_visible := array_append(v_identity_visible, 'Household size and dependents');
  ELSE
    v_identity_gaps := array_append(v_identity_gaps, 'Household size unknown');
    v_question_queue := array_append(v_question_queue, 'How many people are in your household? This affects how I benchmark your spending and assess what''s reasonable.');
  END IF;

  v_identity := LEAST(100, v_identity);
  v_identity_impact := 'Knowing who you are lets me apply the right benchmarks — a single person and a family of four have very different financial norms.';

  -- SECTION 5: FINANCIAL BEHAVIOUR
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND debt_payoff_philosophy IS NOT NULL) THEN
    v_behaviour := v_behaviour + 25; v_behaviour_visible := array_append(v_behaviour_visible, 'Debt payoff preference');
  ELSE
    v_behaviour_gaps := array_append(v_behaviour_gaps, 'Debt payoff philosophy unknown');
    v_question_queue := array_append(v_question_queue, 'If you had spare cash to pay down debt, would you prefer to clear the smallest balance first, or attack the highest interest rate?');
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND provider_switch_open IS NOT NULL) THEN
    v_behaviour := v_behaviour + 20; v_behaviour_visible := array_append(v_behaviour_visible, 'Provider switching preference');
  ELSE
    v_behaviour_gaps := array_append(v_behaviour_gaps, 'Provider preferences unknown');
    v_question_queue := array_append(v_question_queue, 'Are you generally open to switching banks, utilities, or insurers to save money, or do you prefer to stick with what you have?');
  END IF;

  IF v_tx_months >= 3 AND v_tx_count >= 30 THEN
    v_behaviour := v_behaviour + 30; v_behaviour_visible := array_append(v_behaviour_visible, 'Spending patterns (inferred from transactions)');
  ELSIF v_tx_months >= 1 THEN
    v_behaviour := v_behaviour + 10; v_behaviour_visible := array_append(v_behaviour_visible, 'Some spending patterns (limited data)');
    v_behaviour_gaps := array_append(v_behaviour_gaps, 'More transaction history needed for full pattern analysis');
  ELSE
    v_behaviour_gaps := array_append(v_behaviour_gaps, 'No spending pattern data available');
  END IF;

  SELECT COUNT(*) INTO v_decisions_count FROM decisions WHERE profile_id = p_id AND status IN ('accepted', 'completed');

  IF v_decisions_count >= 5 THEN
    v_behaviour := v_behaviour + 25; v_behaviour_visible := array_append(v_behaviour_visible, 'Decision-making patterns established');
  ELSIF v_decisions_count >= 1 THEN
    v_behaviour := v_behaviour + 10; v_behaviour_visible := array_append(v_behaviour_visible, 'Some decision history');
  ELSE
    v_behaviour_gaps := array_append(v_behaviour_gaps, 'No decision history yet');
  END IF;

  v_behaviour := LEAST(100, v_behaviour);
  v_behaviour_impact := 'Understanding how you think about money lets me tailor advice to your style — not generic best practice.';

  -- COMPUTE OVERALL & NARRATIVE
  v_overall := ROUND((v_cashflow * 0.25) + (v_balance * 0.25) + (v_goals * 0.20) + (v_identity * 0.15) + (v_behaviour * 0.15), 1);

  v_tier := CASE
    WHEN v_overall >= 91 THEN 'full'   WHEN v_overall >= 76 THEN 'strong'
    WHEN v_overall >= 56 THEN 'good'   WHEN v_overall >= 31 THEN 'basic'
    ELSE 'low' END;

  v_message := CASE v_tier
    WHEN 'full'   THEN 'Full visibility. I''m advising on your complete financial picture.'
    WHEN 'strong' THEN 'Strong visibility. A few fine details would make this sharper.'
    WHEN 'good'   THEN 'I can see most of your picture. A few gaps are limiting my advice.'
    WHEN 'basic'  THEN 'I can see the basics — but key areas are still dark.'
    ELSE 'I''m working with very little to go on. Let''s fix that.' END;

  v_lowest_score := LEAST(v_cashflow, v_balance, v_goals, v_identity, v_behaviour);
  v_priority_gap := CASE v_lowest_score
    WHEN v_cashflow  THEN 'Cashflow'       WHEN v_balance   THEN 'Balance Sheet'
    WHEN v_goals     THEN 'Goals & Life Plan' WHEN v_identity THEN 'Identity & Context'
    ELSE 'Financial Behaviour' END;

  IF array_length(v_question_queue, 1) > 0 THEN
    v_next_question := v_question_queue[1];
    v_question_queue := v_question_queue[2:];
  END IF;

  INSERT INTO cfo_visibility (
    profile_id, overall_pct, narrative_tier, headline_message, priority_gap_section,
    cashflow_score, balance_sheet_score, goals_score, identity_score, behaviour_score,
    cashflow_visible, balance_sheet_visible, goals_visible, identity_visible, behaviour_visible,
    cashflow_gaps, balance_sheet_gaps, goals_gaps, identity_gaps, behaviour_gaps,
    cashflow_impact, balance_sheet_impact, goals_impact, identity_impact, behaviour_impact,
    next_visibility_question, visibility_queue, signals, computed_at
  ) VALUES (
    p_id, v_overall, v_tier, v_message, v_priority_gap,
    v_cashflow, v_balance, v_goals, v_identity, v_behaviour,
    v_cashflow_visible, v_balance_visible, v_goals_visible, v_identity_visible, v_behaviour_visible,
    v_cashflow_gaps, v_balance_gaps, v_goals_gaps, v_identity_gaps, v_behaviour_gaps,
    v_cashflow_impact, v_balance_impact, v_goals_impact, v_identity_impact, v_behaviour_impact,
    v_next_question, v_question_queue, v_signals, now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    overall_pct = EXCLUDED.overall_pct, narrative_tier = EXCLUDED.narrative_tier,
    headline_message = EXCLUDED.headline_message, priority_gap_section = EXCLUDED.priority_gap_section,
    cashflow_score = EXCLUDED.cashflow_score, balance_sheet_score = EXCLUDED.balance_sheet_score,
    goals_score = EXCLUDED.goals_score, identity_score = EXCLUDED.identity_score, behaviour_score = EXCLUDED.behaviour_score,
    cashflow_visible = EXCLUDED.cashflow_visible, balance_sheet_visible = EXCLUDED.balance_sheet_visible,
    goals_visible = EXCLUDED.goals_visible, identity_visible = EXCLUDED.identity_visible, behaviour_visible = EXCLUDED.behaviour_visible,
    cashflow_gaps = EXCLUDED.cashflow_gaps, balance_sheet_gaps = EXCLUDED.balance_sheet_gaps,
    goals_gaps = EXCLUDED.goals_gaps, identity_gaps = EXCLUDED.identity_gaps, behaviour_gaps = EXCLUDED.behaviour_gaps,
    cashflow_impact = EXCLUDED.cashflow_impact, balance_sheet_impact = EXCLUDED.balance_sheet_impact,
    goals_impact = EXCLUDED.goals_impact, identity_impact = EXCLUDED.identity_impact, behaviour_impact = EXCLUDED.behaviour_impact,
    next_visibility_question = EXCLUDED.next_visibility_question, visibility_queue = EXCLUDED.visibility_queue,
    signals = EXCLUDED.signals, computed_at = EXCLUDED.computed_at;

  INSERT INTO cfo_visibility_history (profile_id, overall_pct, cashflow_score, balance_sheet_score, goals_score, identity_score, behaviour_score, snapshot_month)
  SELECT p_id, v_overall, v_cashflow, v_balance, v_goals, v_identity, v_behaviour, date_trunc('month', now())::date
  WHERE NOT EXISTS (SELECT 1 FROM cfo_visibility_history WHERE profile_id = p_id AND snapshot_month = date_trunc('month', now())::date);

  IF v_prev_tier IS NOT NULL AND v_tier != v_prev_tier THEN
    IF (v_tier = 'basic'  AND v_prev_tier = 'low') OR
       (v_tier = 'good'   AND v_prev_tier IN ('low', 'basic')) OR
       (v_tier = 'strong' AND v_prev_tier IN ('low', 'basic', 'good')) OR
       (v_tier = 'full'   AND v_prev_tier != 'full') THEN
      INSERT INTO insights (profile_id, type, severity, title, body, is_read)
      VALUES (
        p_id, 'milestone', 'info',
        'Your CFO''s visibility just improved',
        'Visibility reached ' || v_overall || '% — ' || v_message,
        false
      );
    END IF;
  END IF;

END;
$function$;
