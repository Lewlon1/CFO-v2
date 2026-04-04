import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { traitId } = await req.json();

  if (!traitId) {
    return Response.json({ error: 'Missing traitId' }, { status: 400 });
  }

  const { error } = await supabase
    .from('financial_portrait')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', traitId)
    .eq('user_id', user.id);

  if (error) {
    console.error('Trait dismiss error:', error);
    return Response.json({ error: 'Failed to dismiss' }, { status: 500 });
  }

  return Response.json({ success: true });
}
