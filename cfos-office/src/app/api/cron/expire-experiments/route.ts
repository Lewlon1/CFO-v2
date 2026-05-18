import { NextRequest, NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';
import { sendAlert } from '@/lib/alerts/notify';

export const maxDuration = 60;

const GHOST_DAYS = 7;
const EXPIRE_GRACE_DAYS = 14;

// Daily cron — keep proposed_experiments tidy.
//
// 1. Ghost cleanup: proposals that have sat untouched for >GHOST_DAYS days
//    are auto-declined. A note is appended to user_note so the row is
//    distinguishable from a user-initiated decline.
// 2. Auto-expire: experiments still in status=active/accepted whose
//    ends_at is more than EXPIRE_GRACE_DAYS in the past without an outcome
//    are moved to status='expired'. Expired rows are explicitly excluded
//    from the completion-rate window in lib/experiments/limit.ts.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createServiceClient();
  const ghostCutoff = new Date(Date.now() - GHOST_DAYS * 86400_000).toISOString();
  const expireCutoff = new Date(Date.now() - EXPIRE_GRACE_DAYS * 86400_000).toISOString();
  const errors: string[] = [];

  // 1. Ghost cleanup.
  const { data: ghosts, error: ghostError } = await supabase
    .from('proposed_experiments')
    .update({
      status: 'declined',
      responded_at: new Date().toISOString(),
      user_note: '[auto-declined: untouched 7d]',
    })
    .eq('status', 'proposed')
    .lt('proposed_at', ghostCutoff)
    .is('deleted_at', null)
    .select('id');

  if (ghostError) {
    errors.push(`ghost: ${ghostError.message}`);
    console.error('[cron/expire-experiments] ghost cleanup failed:', ghostError.message);
  }

  // 2. Auto-expire.
  const { data: expired, error: expireError } = await supabase
    .from('proposed_experiments')
    .update({ status: 'expired' })
    .in('status', ['active', 'accepted'])
    .lt('ends_at', expireCutoff)
    .is('outcome_reported_at', null)
    .is('deleted_at', null)
    .select('id');

  if (expireError) {
    errors.push(`expire: ${expireError.message}`);
    console.error('[cron/expire-experiments] expire failed:', expireError.message);
  }

  if (errors.length > 0) {
    void sendAlert({
      severity: 'warning',
      event: 'cron_expire_experiments_failed',
      details: `expire-experiments cron hit ${errors.length} error(s).`,
      metadata: { errors },
    });
  }

  return NextResponse.json({
    ghost_declined: ghosts?.length ?? 0,
    expired: expired?.length ?? 0,
    errors: errors.length,
    timestamp: new Date().toISOString(),
  });
}
