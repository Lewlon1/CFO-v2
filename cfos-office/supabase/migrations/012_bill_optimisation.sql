-- Session 9: Bill Optimisation
-- Adds columns and indexes needed for bill tracking, uploads, and contract monitoring.

-- New columns on recurring_expenses
ALTER TABLE public.recurring_expenses
  ADD COLUMN IF NOT EXISTS bill_uploads jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'detected',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Indexes for cron job queries
CREATE INDEX IF NOT EXISTS idx_recurring_contract_end
  ON public.recurring_expenses (contract_end_date)
  WHERE contract_end_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_optimisation_check
  ON public.recurring_expenses (last_optimisation_check)
  WHERE status = 'tracked';

CREATE INDEX IF NOT EXISTS idx_recurring_user_status
  ON public.recurring_expenses (user_id, status);

-- Supabase Storage bucket for bill documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('bill-documents', 'bill-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for bill-documents bucket
CREATE POLICY "Users can upload their own bills"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bill-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can read their own bills"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bill-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete their own bills"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bill-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
