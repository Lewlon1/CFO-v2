import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function run() {
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, examples')
  
  console.log('Total categories:', categories?.length)
  console.log('\nCategories with examples:')
  categories?.forEach(c => {
    if (c.examples && c.examples.length > 0) {
      console.log(`  ${c.id}: ${c.examples.slice(0, 2).join(', ')}`)
    }
  })
  
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, description, category_id')
    .eq('category_id', null)
    .limit(5)
  
  console.log('\nSample uncategorised transactions:')
  txns?.forEach(t => {
    console.log(`  "${t.description}"`)
  })
}

run()
