import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ValueMapFlow } from '@/components/value-map/value-map-flow'

type Mode = 'onboarding' | 'retake' | 'checkin' | 'personal'

export default async function ValueMapPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const rawMode = typeof params.mode === 'string' ? params.mode : 'checkin'
  const mode: Mode =
    rawMode === 'onboarding' ||
    rawMode === 'retake' ||
    rawMode === 'checkin' ||
    rawMode === 'personal'
      ? rawMode
      : 'checkin'

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .single()
  const currency = profile?.primary_currency ?? 'EUR'

  return (
    <div className="h-dvh w-full overflow-hidden bg-background">
      <ValueMapFlow mode={mode} currency={currency} />
    </div>
  )
}
