import type { SupabaseClient } from '@supabase/supabase-js'

export type PredictionMetrics = {
  total_transactions: number
  confirmed_count: number
  predicted_count: number
  uncategorised_count: number
  avg_confidence: number
  high_confidence_pct: number
  low_confidence_pct: number
  rules_count: number
  merchants_learned: number
}

export async function getPredictionMetrics(
  supabase: SupabaseClient,
  userId: string
): Promise<PredictionMetrics> {
  const [txnResult, rulesResult, merchantsResult] = await Promise.all([
    supabase.rpc('prediction_metrics_txn', { p_user_id: userId }).single(),
    supabase
      .from('value_category_rules')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('value_category_rules')
      .select('match_value')
      .eq('user_id', userId)
      .eq('match_type', 'merchant'),
  ])

  type TxnMetrics = {
    total: number; confirmed: number; predicted: number; uncategorised: number
    avg_confidence: number; high_confidence_pct: number; low_confidence_pct: number
  }

  // If the RPC doesn't exist yet, fall back to defaults
  const txnData: TxnMetrics = (txnResult.data as TxnMetrics) ?? {
    total: 0, confirmed: 0, predicted: 0, uncategorised: 0,
    avg_confidence: 0, high_confidence_pct: 0, low_confidence_pct: 0,
  }

  const distinctMerchants = new Set(
    (merchantsResult.data ?? []).map((r: { match_value: string }) => r.match_value)
  )

  return {
    total_transactions: txnData.total ?? 0,
    confirmed_count: txnData.confirmed ?? 0,
    predicted_count: txnData.predicted ?? 0,
    uncategorised_count: txnData.uncategorised ?? 0,
    avg_confidence: Math.round((txnData.avg_confidence ?? 0) * 100) / 100,
    high_confidence_pct: Math.round((txnData.high_confidence_pct ?? 0) * 100) / 100,
    low_confidence_pct: Math.round((txnData.low_confidence_pct ?? 0) * 100) / 100,
    rules_count: rulesResult.count ?? 0,
    merchants_learned: distinctMerchants.size,
  }
}
