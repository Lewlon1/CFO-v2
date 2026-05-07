import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function run() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
  
  console.log('Total transactions:', data?.length)
  
  const { data: uncatCount, error: uncatErr } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('category_id', null)
  
  console.log('Uncategorised transactions:', uncatCount?.length)
  
  const { data: cats } = await supabase
    .from('transactions')
    .select('category_id')
    .not('category_id', 'is', null)
    .limit(500)

  const counts: Record<string, number> = {}
  cats?.forEach(t => { counts[t.category_id] = (counts[t.category_id] || 0) + 1 })

  console.log('Transactions by category:')
  console.log(JSON.stringify(counts, null, 2))
}

run()
