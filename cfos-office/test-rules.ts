import { createClient } from '@supabase/supabase-js'
import { categoriseByRules } from './src/lib/categorisation/rules-engine'
import type { Category } from './src/lib/parsers/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function run() {
  // Get categories
  const { data: categories } = await supabase
    .from('categories')
    .select('*')
  
  // Get some uncategorised transactions
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, description')
    .is('category_id', null)
    .limit(10)
  
  console.log('Testing rules engine on sample transactions:\n')
  
  if (txns && categories) {
    for (const t of txns) {
      const result = categoriseByRules(t.description, { 
        categories: categories as Category[],
      })
      console.log(`"${t.description}"`)
      console.log(`  → ${result.categoryId || 'UNCATEGORISED'} (confidence: ${result.confidence})`)
    }
  }
}

run()
