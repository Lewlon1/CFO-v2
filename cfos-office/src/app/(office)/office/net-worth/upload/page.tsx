import { createClient } from '@/lib/supabase/server'
import { UploadPageClient } from './UploadPageClient'
import type { Category } from '@/lib/parsers/types'

export default async function NetWorthUploadPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Categories list is part of UploadWizard's props even in balance_sheet context;
  // it isn't used for asset/liability categorisation but keeps the component shape consistent.
  const { data: catData } = await supabase
    .from('categories')
    .select('id, name, tier, icon, color, examples, default_value_category')
    .eq('is_active', true)
    .order('name')

  const categories: Category[] = catData ?? []

  return <UploadPageClient categories={categories} />
}
