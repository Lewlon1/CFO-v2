import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function run() {
  // Total count
  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
  
  console.log('Total transactions:', totalCount)
  
  // Uncategorised count
  const { count: uncatCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('category_id', null)
  
  console.log('Uncategorised transactions:', uncatCount)
  
  // Categorised by category
  const { count: categorisedCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('category_id', 'is', null)
  
  console.log('Categorised transactions:', categorisedCount)
  
  console.log(`Coverage: ${categorisedCount}/${totalCount} (${((categorisedCount!/totalCount!) * 100).toFixed(1)}%)`)
}

run()
