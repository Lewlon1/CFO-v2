import { createClient } from '@/lib/supabase/server'
import { UploadPageClient } from './UploadPageClient'
import type { Category } from '@/lib/parsers/types'

export default async function CashFlowUploadPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: catData } = await supabase
    .from('categories')
    .select('id, name, tier, icon, color, examples, default_value_category')
    .eq('is_active', true)
    .order('name')

  const categories: Category[] = catData ?? []

  return <UploadPageClient categories={categories} />
}
