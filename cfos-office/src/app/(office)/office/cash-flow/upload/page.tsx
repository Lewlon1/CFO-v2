import { createClient } from '@/lib/supabase/server'
import { UploadPageClient } from './UploadPageClient'
import type { Category } from '@/lib/parsers/types'
import {
  parseDeclaredReadPending,
  DECLARED_READ_PENDING_KEY,
} from '@/lib/insights/first-read-followup'

export default async function CashFlowUploadPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: catData }, { data: profile }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, tier, icon, color, examples, default_value_category')
      .eq('is_active', true)
      .order('name'),
    // Declared-pending check: an import here is a skip-path user's chance at
    // the declared→actual upgrade — the insights CTA must not silently forfeit
    // it (post-upload never recomposes the onboarding Read).
    supabase
      .from('user_profiles')
      .select('onboarding_progress')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  const categories: Category[] = catData ?? []
  const declaredPending = parseDeclaredReadPending(
    ((profile?.onboarding_progress as Record<string, unknown> | null) ?? {})[
      DECLARED_READ_PENDING_KEY
    ],
  )

  return <UploadPageClient categories={categories} declaredPending={declaredPending != null} />
}
