ALTER TABLE public.recurring_expenses
  ADD CONSTRAINT recurring_expenses_user_name_unique UNIQUE (user_id, name);
