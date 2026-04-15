import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { inferFrequencyFromDays } from '@/lib/bills/normalise'
import { matchProvider } from '@/lib/bills/provider-registry'

/** Map bill_type from extraction to a valid categories table ID */
function billTypeToCategoryId(billType: string): string | null {
  switch (billType) {
    case 'electricity':
    case 'gas':
    case 'water':
    case 'internet':
    case 'mobile':
    case 'insurance_health':
    case 'insurance_home':
    case 'insurance_car':
      return 'utilities_bills'
    case 'subscription':
      return 'subscriptions'
    default:
      return null
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const {
    bill_id,
    extraction,
  } = body as {
    bill_id: string | null
    extraction: Record<string, unknown>
  }

  if (!extraction || typeof extraction.total_amount !== 'number') {
    return NextResponse.json({ error: 'Invalid extraction data' }, { status: 400 })
  }

  // Build plan details jsonb
  const planDetails: Record<string, unknown> = {
    bill_type: extraction.bill_type,
    consumption_kwh: extraction.consumption_kwh,
    consumption_m3: extraction.consumption_m3,
    tariff_type: extraction.tariff_type,
    power_contracted_kw: extraction.power_contracted_kw,
    plan_name: extraction.plan_name,
    speed_mbps: extraction.speed_mbps,
    data_gb: extraction.data_gb,
    coverage_type: extraction.coverage_type,
    coverage_details: extraction.coverage_details,
    last_bill_period: extraction.billing_period,
    last_bill_amount: extraction.total_amount,
  }

  // Build upload history entry
  const uploadEntry = {
    uploaded_at: new Date().toISOString(),
    period: extraction.billing_period || null,
    amount: extraction.total_amount,
    extraction_confidence: extraction.confidence || 'medium',
  }

  // Infer frequency from billing period
  let inferredFrequency: string | null = null
  const period = extraction.billing_period as { start?: string; end?: string } | null
  if (period?.start && period?.end) {
    const days = Math.round(
      (new Date(period.end).getTime() - new Date(period.start).getTime()) / (1000 * 60 * 60 * 24)
    )
    if (days > 0) inferredFrequency = inferFrequencyFromDays(days)
  }

  // Try to match provider for enrichment
  const providerName = String(extraction.provider || '')
  const providerMatch = matchProvider(providerName)

  if (bill_id) {
    // Update existing recurring_expense
    // First fetch to merge plan details and bill_uploads
    const { data: existing } = await supabase
      .from('recurring_expenses')
      .select('current_plan_details, bill_uploads')
      .eq('id', bill_id)
      .eq('user_id', user.id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    const existingUploads = Array.isArray(existing.bill_uploads) ? existing.bill_uploads : []
    const mergedPlanDetails = { ...(existing.current_plan_details || {}), ...planDetails }

    const updateData: Record<string, unknown> = {
      provider: providerName || undefined,
      amount: extraction.total_amount,
      currency: String(extraction.currency || 'EUR'),
      current_plan_details: mergedPlanDetails,
      bill_uploads: [...existingUploads, uploadEntry],
      contract_end_date: extraction.contract_end_date || undefined,
      has_permanencia: extraction.has_permanencia ?? undefined,
      status: 'tracked',
      updated_at: new Date().toISOString(),
    }

    if (inferredFrequency) updateData.frequency = inferredFrequency
    const catId = billTypeToCategoryId(String(extraction.bill_type || ''))
    if (catId) updateData.category_id = catId

    // Remove undefined values
    for (const key of Object.keys(updateData)) {
      if (updateData[key] === undefined) delete updateData[key]
    }

    const { data, error } = await supabase
      .from('recurring_expenses')
      .update(updateData)
      .eq('id', bill_id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('[bill-confirm] Update error:', error)
      return NextResponse.json({ error: 'Failed to save bill data' }, { status: 500 })
    }

    return NextResponse.json({ bill: data })
  } else {
    const billName = providerName || 'Unknown Bill'

    // If a bill with the same name already exists for this user, update it
    // instead of inserting — re-uploading the same provider's bill refreshes
    // the plan details and appends to the upload history.
    const { data: existingByName } = await supabase
      .from('recurring_expenses')
      .select('id, current_plan_details, bill_uploads')
      .eq('user_id', user.id)
      .eq('name', billName)
      .maybeSingle()

    if (existingByName) {
      const existingUploads = Array.isArray(existingByName.bill_uploads) ? existingByName.bill_uploads : []
      const mergedPlanDetails = { ...(existingByName.current_plan_details || {}), ...planDetails }

      const updateData: Record<string, unknown> = {
        provider: providerName || undefined,
        amount: extraction.total_amount,
        currency: String(extraction.currency || 'EUR'),
        current_plan_details: mergedPlanDetails,
        bill_uploads: [...existingUploads, uploadEntry],
        contract_end_date: extraction.contract_end_date || undefined,
        has_permanencia: extraction.has_permanencia ?? undefined,
        status: 'tracked',
        updated_at: new Date().toISOString(),
      }
      if (inferredFrequency) updateData.frequency = inferredFrequency
      const catId = billTypeToCategoryId(String(extraction.bill_type || ''))
      if (catId) updateData.category_id = catId
      for (const key of Object.keys(updateData)) {
        if (updateData[key] === undefined) delete updateData[key]
      }

      const { data, error } = await supabase
        .from('recurring_expenses')
        .update(updateData)
        .eq('id', existingByName.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) {
        console.error('[bill-confirm] Update-by-name error:', error)
        return NextResponse.json({ error: 'Failed to save bill data' }, { status: 500 })
      }
      return NextResponse.json({ bill: data })
    }

    const newBill = {
      user_id: user.id,
      name: billName,
      provider: providerName || null,
      amount: extraction.total_amount as number,
      currency: String(extraction.currency || 'EUR'),
      frequency: inferredFrequency || 'monthly',
      current_plan_details: planDetails,
      bill_uploads: [uploadEntry],
      contract_end_date: (extraction.contract_end_date as string) || null,
      has_permanencia: (extraction.has_permanencia as boolean) ?? false,
      status: 'tracked',
      category_id: billTypeToCategoryId(String(extraction.bill_type || '')),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('recurring_expenses')
      .insert(newBill)
      .select()
      .single()

    if (error) {
      console.error('[bill-confirm] Insert error:', error)
      return NextResponse.json({ error: 'Failed to create bill' }, { status: 500 })
    }

    return NextResponse.json({ bill: data })
  }
}
