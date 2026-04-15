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
    .select('count(*), category_id')
    .group_by('category_id')
    .limit(20)
  
  console.log('Transactions by category:')
  console.log(JSON.stringify(cats, null, 2))
}

run()
