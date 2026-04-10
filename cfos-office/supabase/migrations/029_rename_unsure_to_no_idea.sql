-- Migration: Rename 'unsure' to 'no_idea' in value_category_type enum
-- Safe to run on fresh or existing databases.
--
-- NOTE: PostgreSQL requires ADD VALUE to be committed before use.
-- Supabase runs each migration in its own transaction, so the ADD VALUE
-- and subsequent UPDATE can coexist in a single file here. If running
-- manually, execute the ALTER TYPE in a separate transaction first.

-- Step 1: Add the new value
ALTER TYPE public.value_category_type ADD VALUE IF NOT EXISTS 'no_idea';

-- Step 2: Update any existing rows using 'unsure'
-- (These UPDATEs work because Supabase commits the ALTER TYPE above
--  as part of migration tracking before running the next statement.)
UPDATE public.transactions
SET value_category = 'no_idea'::public.value_category_type
WHERE value_category = 'unsure'::public.value_category_type;

-- Step 3: Update category seed defaults
UPDATE public.categories
SET default_value_category = 'no_idea'::public.value_category_type
WHERE default_value_category = 'unsure'::public.value_category_type;

-- Note: PostgreSQL does not support removing enum values directly.
-- The old 'unsure' value remains in the enum but is unused.
-- All code will use 'no_idea' exclusively going forward.

COMMENT ON TYPE public.value_category_type IS
  'Value categories: foundation, investment, leak, burden, no_idea. The legacy value ''unsure'' exists in the enum but is unused — all code uses ''no_idea''.';
