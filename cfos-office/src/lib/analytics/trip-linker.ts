import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Link transactions to a trip based on date range and spending patterns.
 * Returns the list of transaction IDs that were linked.
 */
export async function linkTransactionsToTrip(
  supabase: SupabaseClient,
  userId: string,
  tripId: string
): Promise<{ linked: number; total_actual: number }> {
  // Load the trip record
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id, name, start_date, end_date, currency')
    .eq('id', tripId)
    .eq('user_id', userId)
    .single();

  if (tripError || !trip || !trip.start_date || !trip.end_date) {
    return { linked: 0, total_actual: 0 };
  }

  // Buffer: include 2 days after end_date for return travel charges
  const endBuffer = new Date(trip.end_date);
  endBuffer.setDate(endBuffer.getDate() + 2);
  const endDateStr = endBuffer.toISOString().slice(0, 10);

  // Find candidate transactions:
  // 1. In the trip date range
  // 2. Not already linked to another trip
  // 3. Either foreign currency, already flagged as holiday spend,
  //    or in travel-related categories
  const travelCategories = [
    'travel', 'accommodation', 'eat_drinking_out', 'entertainment',
    'transport', 'shopping', 'activities',
  ];

  // Get user's primary currency to identify foreign transactions
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', userId)
    .single();

  const primaryCurrency = profile?.primary_currency || 'EUR';

  // Query transactions in the date range
  const { data: candidates } = await supabase
    .from('transactions')
    .select('id, amount, currency, category_id, is_holiday_spend, trip_id')
    .eq('user_id', userId)
    .gte('date', trip.start_date)
    .lte('date', endDateStr)
    .is('trip_id', null); // Don't overwrite existing trip links

  if (!candidates || candidates.length === 0) {
    return { linked: 0, total_actual: 0 };
  }

  // Filter to likely trip transactions
  const toLink = candidates.filter((txn) => {
    // Already flagged as holiday spend
    if (txn.is_holiday_spend) return true;
    // Foreign currency
    if (txn.currency && txn.currency !== primaryCurrency) return true;
    // Travel-related category
    if (txn.category_id && travelCategories.includes(txn.category_id)) return true;
    return false;
  });

  if (toLink.length === 0) {
    return { linked: 0, total_actual: 0 };
  }

  // Link transactions
  const ids = toLink.map((t) => t.id);
  await supabase
    .from('transactions')
    .update({
      trip_id: tripId,
      trip_name: trip.name,
      is_holiday_spend: true,
    })
    .in('id', ids);

  // Compute total actual spend
  const totalActual = toLink.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // Update the trip record
  await supabase
    .from('trips')
    .update({ total_actual: Math.round(totalActual * 100) / 100 })
    .eq('id', tripId);

  return { linked: toLink.length, total_actual: Math.round(totalActual * 100) / 100 };
}

/**
 * Check all active trips and link any new transactions that fall within their date ranges.
 * Useful to call after a CSV import.
 */
export async function linkTransactionsForActiveTrips(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: trips } = await supabase
    .from('trips')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['booked', 'in_progress', 'completed']);

  if (!trips || trips.length === 0) return;

  for (const trip of trips) {
    await linkTransactionsToTrip(supabase, userId, trip.id);
  }
}
