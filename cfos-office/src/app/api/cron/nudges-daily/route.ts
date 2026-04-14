// TODO: Not registered in vercel.json — decide between Vercel cron vs Supabase
// Edge Function + pg_cron. See cfos-office/DEFERRED.md for tracking.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { evaluatePaydaySavings } from '@/lib/nudges/evaluators/payday-savings';
import { evaluateBudgetAlerts } from '@/lib/nudges/evaluators/budget-alert';
import { evaluateBillDue } from '@/lib/nudges/evaluators/bill-due';
import { evaluateContractExpiry } from '@/lib/nudges/evaluators/contract-expiry';
import { evaluateSpendingSpikes } from '@/lib/nudges/evaluators/spending-spike';
import { evaluateValueMapRetake } from '@/lib/nudges/evaluators/value-map-retake';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createServiceClient();
  // Cast to the SupabaseClient type evaluators expect
  const sb = supabase as unknown as SupabaseClient;

  // Get all users who have at least one transaction
  const { data: users } = await supabase
    .from('transactions')
    .select('user_id')
    .limit(1000);

  if (!users || users.length === 0) {
    return NextResponse.json({ users_processed: 0, nudges_created: 0 });
  }

  // Deduplicate user IDs
  const userIds = [...new Set(users.map(u => u.user_id))];

  const errors: string[] = [];
  const beforeCount = await getNudgeCount(supabase);

  for (const userId of userIds) {
    try {
      await Promise.allSettled([
        evaluatePaydaySavings(sb, userId),
        evaluateBudgetAlerts(sb, userId),
        evaluateBillDue(sb, userId),
        evaluateContractExpiry(sb, userId),
        evaluateSpendingSpikes(sb, userId),
        evaluateValueMapRetake(sb, userId),
      ]);
    } catch (err) {
      errors.push(`User ${userId}: ${(err as Error).message}`);
    }
  }

  const afterCount = await getNudgeCount(supabase);

  return NextResponse.json({
    users_processed: userIds.length,
    nudges_created: (afterCount ?? 0) - (beforeCount ?? 0),
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
}

async function getNudgeCount(supabase: ReturnType<typeof createServiceClient>): Promise<number> {
  const { count } = await supabase
    .from('nudges')
    .select('id', { count: 'exact', head: true });
  return count ?? 0;
}
