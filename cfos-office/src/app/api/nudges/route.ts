import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? 'all';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);

  let query = supabase
    .from('nudges')
    .select('*')
    .eq('user_id', user.id)
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status === 'pending') {
    query = query.eq('status', 'pending');
  } else if (status === 'read') {
    query = query.eq('status', 'read');
  } else {
    // 'all' — exclude dismissed
    query = query.neq('status', 'dismissed');
  }

  const { data: nudges, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch nudges' }, { status: 500 });
  }

  // Also get unread count
  const { count } = await supabase
    .from('nudges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString());

  return NextResponse.json({ nudges: nudges ?? [], unread_count: count ?? 0 });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const { nudge_ids, action } = body as { nudge_ids: string[]; action: 'read' | 'dismissed' };

  if (!nudge_ids?.length || !['read', 'dismissed'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const updateData: Record<string, string> = { status: action };
  if (action === 'read') {
    updateData.read_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('nudges')
    .update(updateData)
    .eq('user_id', user.id)
    .in('id', nudge_ids);

  if (error) {
    return NextResponse.json({ error: 'Failed to update nudges' }, { status: 500 });
  }

  return NextResponse.json({ updated: nudge_ids.length });
}
