import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function run() {
  try {
    const { error } = await supabase
      .from('categories')
      .upsert({
        id: 'transfers',
        name: 'Transfers & Internal',
        tier: 'financial',
        icon: 'arrow-left-right',
        color: 'muted',
        description: 'Internal transfers, currency exchanges, P2P payments, pot moves',
        examples: ['Bank transfer', 'Currency exchange', 'Pot transfer', 'P2P payment', 'Withdrawal', 'Deposit'],
        default_value_category: null,
        is_holiday_eligible: false,
        sort_order: 155,
      })
      .eq('id', 'transfers')
    
    if (error) {
      console.error('[migration] failed:', error)
      process.exit(1)
    }
    console.log('✓ Transfers category created successfully')
    
    // Verify it was created
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('id', 'transfers')
    
    if (data && data.length > 0) {
      console.log('✓ Verified:', JSON.stringify(data[0], null, 2))
    }
  } catch (e) {
    console.error('[migration] error:', e)
    process.exit(1)
  }
}

run()
