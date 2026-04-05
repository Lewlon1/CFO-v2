import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { evaluateMonthlyReview } from '@/lib/nudges/evaluators/monthly-review';
import { evaluateUploadReminder } from '@/lib/nudges/evaluators/upload-reminder';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createServiceClient();
  const sb = supabase as unknown as SupabaseClient;

  const { data: users } = await supabase
    .from('user_profiles')
    .select('id');

  if (!users || users.length === 0) {
    return NextResponse.json({ users_processed: 0, nudges_created: 0 });
  }

  const errors: string[] = [];
  const beforeCount = await getNudgeCount(supabase);

  for (const user of users) {
    try {
      await Promise.allSettled([
        evaluateMonthlyReview(sb, user.id),
        evaluateUploadReminder(sb, user.id),
      ]);
    } catch (err) {
      errors.push(`User ${user.id}: ${(err as Error).message}`);
    }
  }

  const afterCount = await getNudgeCount(supabase);

  return NextResponse.json({
    users_processed: users.length,
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
