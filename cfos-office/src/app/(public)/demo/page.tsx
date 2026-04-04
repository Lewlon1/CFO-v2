import { createClient } from '@/lib/supabase/server'
import { DemoFlow } from '@/components/demo/demo-flow'
import { DEMO_COUNTRIES } from '@/lib/demo/transactions'

export default async function DemoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let initialName = ''
  let initialCountry: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, country, primary_currency')
      .eq('id', user.id)
      .single()

    if (profile) {
      if (profile.display_name) initialName = profile.display_name
      // Map profile country to a DEMO_COUNTRIES code
      if (profile.country) {
        const countryUpper = profile.country.toUpperCase()
        const match = DEMO_COUNTRIES.find(
          (c) => c.code === countryUpper || c.name.toLowerCase() === profile.country.toLowerCase()
        )
        if (match) {
          initialCountry = match.code
        } else if (profile.primary_currency) {
          // Fallback: match by currency
          const currencyMatch = DEMO_COUNTRIES.find((c) => c.currency === profile.primary_currency)
          if (currencyMatch) initialCountry = currencyMatch.code
        }
      }
    }
  }

  return (
    <DemoFlow
      initialName={initialName}
      initialCountry={initialCountry}
      isAuthenticated={!!user}
    />
  )
}
