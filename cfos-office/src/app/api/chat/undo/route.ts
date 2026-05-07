import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { calculateProfileCompleteness } from '@/lib/profiling/engine';

const ALLOWED_PROFILE_FIELDS = new Set([
  'display_name', 'country', 'city', 'primary_currency', 'age_range',
  'employment_status', 'gross_salary', 'net_monthly_income', 'pay_frequency',
  'has_bonus_months', 'bonus_month_details', 'housing_type', 'monthly_rent',
  'relationship_status', 'partner_employment_status', 'partner_monthly_contribution',
  'dependents', 'values_ranking', 'spending_triggers', 'risk_tolerance',
  'financial_awareness', 'advice_style', 'nationality', 'residency_status',
  'tax_residency_country', 'years_in_country',
]);

type Ctx = { supabase: SupabaseClient; userId: string };

// Ignore a list of columns that should never be restored verbatim (generated / managed)
const ASSET_RESTORE_BLACKLIST = new Set(['id', 'user_id', 'created_at']);

function cleanRowForRestore(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (ASSET_RESTORE_BLACKLIST.has(k)) continue;
    clean[k] = v;
  }
  return clean;
}

async function undoCreateActionItem(
  ctx: Ctx,
  payload: Record<string, unknown>,
): Promise<Response> {
  const id = typeof payload.id === 'string' ? payload.id : null;
  if (!id) return Response.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const { data: existing } = await ctx.supabase
    .from('action_items')
    .select('id')
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (!existing) {
    return Response.json({ ok: true, alreadyUndone: true });
  }

  const { error } = await ctx.supabase
    .from('action_items')
    .delete()
    .eq('id', id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('[undo:create_action_item] delete error:', error);
    return Response.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
  revalidatePath('/', 'layout');
  return Response.json({ ok: true });
}

async function undoUpsertAssetOrLiability(
  ctx: Ctx,
  table: 'assets' | 'liabilities',
  payload: Record<string, unknown>,
): Promise<Response> {
  const id = typeof payload.id === 'string' ? payload.id : null;
  const action = payload.action === 'updated' ? 'updated' : 'created';
  if (!id) return Response.json({ ok: false, error: 'missing_id' }, { status: 400 });

  if (action === 'created') {
    const { data: existing } = await ctx.supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (!existing) return Response.json({ ok: true, alreadyUndone: true });

    const { error } = await ctx.supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('user_id', ctx.userId);

    if (error) {
      console.error(`[undo:${table}] delete error:`, error);
      return Response.json({ ok: false, error: 'delete_failed' }, { status: 500 });
    }
  } else {
    // Restore prior row
    const before = payload.before as Record<string, unknown> | null | undefined;
    if (!before || typeof before !== 'object') {
      return Response.json({ ok: false, error: 'missing_before' }, { status: 400 });
    }
    const restoreData = cleanRowForRestore(before as Record<string, unknown>);

    const { error } = await ctx.supabase
      .from(table)
      .update(restoreData)
      .eq('id', id)
      .eq('user_id', ctx.userId);

    if (error) {
      console.error(`[undo:${table}] restore error:`, error);
      return Response.json({ ok: false, error: 'restore_failed' }, { status: 500 });
    }
  }

  // Refresh derived state (portrait + net worth snapshot) — these helpers are
  // idempotent and safe to run after either a delete or a restore.
  try {
    const { updateAssetPortrait } = await import('@/lib/balance-sheet/portrait');
    const { refreshCurrentNetWorthSnapshot } = await import(
      '@/lib/analytics/net-worth-snapshot'
    );
    await updateAssetPortrait({
      supabase: ctx.supabase,
      userId: ctx.userId,
    });
    await refreshCurrentNetWorthSnapshot(ctx.supabase, ctx.userId);
  } catch (err) {
    console.error(`[undo:${table}] portrait/snapshot refresh failed:`, err);
  }

  revalidatePath('/', 'layout');
  return Response.json({ ok: true });
}

async function undoUpdateUserProfile(
  ctx: Ctx,
  payload: Record<string, unknown>,
): Promise<Response> {
  const fields = Array.isArray(payload.fields) ? (payload.fields as string[]) : [];
  const beforeValues =
    (payload.before_values as Record<string, unknown> | undefined) ?? {};

  if (fields.length === 0) {
    return Response.json({ ok: true, alreadyUndone: true });
  }

  const restore: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const field of fields) {
    if (!ALLOWED_PROFILE_FIELDS.has(field)) continue;
    restore[field] = beforeValues[field] ?? null;
  }

  const { error } = await ctx.supabase
    .from('user_profiles')
    .update(restore)
    .eq('id', ctx.userId);

  if (error) {
    console.error('[undo:update_user_profile] restore error:', error);
    return Response.json({ ok: false, error: 'restore_failed' }, { status: 500 });
  }

  // Remove the profiling_queue entries that the chat tool wrote so the system
  // no longer considers these fields "answered via conversation".
  await ctx.supabase
    .from('profiling_queue')
    .delete()
    .eq('user_id', ctx.userId)
    .eq('source', 'conversation')
    .in('field', fields.filter((f) => ALLOWED_PROFILE_FIELDS.has(f)));

  // Recalculate completeness
  const { data: updatedProfile } = await ctx.supabase
    .from('user_profiles')
    .select('*')
    .eq('id', ctx.userId)
    .single();

  if (updatedProfile) {
    const completeness = calculateProfileCompleteness(updatedProfile);
    await ctx.supabase
      .from('user_profiles')
      .update({ profile_completeness: completeness })
      .eq('id', ctx.userId);
  }

  revalidatePath('/', 'layout');
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { toolName?: string; toolCallId?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { toolName, payload } = body;
  if (!toolName || typeof toolName !== 'string' || !payload || typeof payload !== 'object') {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }

  const ctx: Ctx = { supabase, userId: user.id };

  try {
    switch (toolName) {
      case 'create_action_item':
        return await undoCreateActionItem(ctx, payload);
      case 'upsert_asset':
        return await undoUpsertAssetOrLiability(ctx, 'assets', payload);
      case 'upsert_liability':
        return await undoUpsertAssetOrLiability(ctx, 'liabilities', payload);
      case 'update_user_profile':
        return await undoUpdateUserProfile(ctx, payload);
      default:
        return Response.json({ ok: false, error: 'unsupported_tool' }, { status: 400 });
    }
  } catch (err) {
    console.error('[undo] unexpected error:', err);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
