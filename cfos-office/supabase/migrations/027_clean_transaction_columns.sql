-- Session 24, Part 3: Clean up transactions columns
-- Must drop the transactions_own RLS policy first because it references profile_id.

DROP POLICY IF EXISTS transactions_own ON public.transactions;

-- Drop MVP duplicate columns
ALTER TABLE public.transactions DROP COLUMN IF EXISTS profile_id;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS transaction_date;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS category_name;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS account_name;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS bank_account_id;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS confidence_score;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS user_corrected;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS type;

-- Drop always-null recurrence columns (recurring detection lives in recurring_expenses)
ALTER TABLE public.transactions DROP COLUMN IF EXISTS next_due_date;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS recurrence_end;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS frequency;

-- Drop low-value MVP column
ALTER TABLE public.transactions DROP COLUMN IF EXISTS merchant;

-- Rename external_id to dedupe_hash for clarity
ALTER TABLE public.transactions RENAME COLUMN external_id TO dedupe_hash;

-- Set NOT NULL on user_id and date (safe because table was truncated in 025)
ALTER TABLE public.transactions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN date SET NOT NULL;

-- Recreate the RLS policy using only user_id
CREATE POLICY transactions_own ON public.transactions
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (user_id = auth.uid());
