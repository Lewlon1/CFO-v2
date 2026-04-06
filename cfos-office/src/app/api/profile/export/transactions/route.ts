import { createClient } from '@/lib/supabase/server'

function friendlySource(source: string | null): string {
  if (!source) return ''
  if (source.startsWith('csv')) return 'Bank statement'
  if (source === 'screenshot') return 'Screenshot'
  if (source === 'manual') return 'Manual entry'
  return 'Imported'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // Only export raw data + traditional category name
  // Deliberately excluded: value_category, auto_category_confidence,
  // is_holiday_spend, is_shared_expense, raw_description, import_batch_id
  const { data: transactions } = await supabase
    .from('transactions')
    .select(`
      date,
      description,
      amount,
      currency,
      category:categories(name),
      is_recurring,
      source
    `)
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (!transactions || transactions.length === 0) {
    return new Response('No transactions found', { status: 404 })
  }

  await supabase.from('user_events').insert({
    user_id: user.id,
    event_name: 'export_requested',
    metadata: { format: 'csv', type: 'transactions' },
  })

  const headers = ['Date', 'Description', 'Amount', 'Currency', 'Category', 'Recurring', 'Source']
  const rows = transactions.map(t => [
    t.date,
    `"${(t.description ?? '').replace(/"/g, '""')}"`,
    t.amount,
    t.currency,
    (t.category as unknown as { name: string } | null)?.name ?? '',
    t.is_recurring ? 'Yes' : 'No',
    friendlySource(t.source),
  ])

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="cfos-office-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
