import { createClient } from '@/lib/supabase/server';
import { recordTraitDismissal } from '@/lib/memory/digests';

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

  // Read the row back so the digest refresh knows WHAT was struck out. On a
  // digest the user has taken over we cannot re-render, so the dismissal has to
  // be written as its own line — otherwise the file keeps asserting something
  // the user has just rejected.
  const { data: dismissed, error } = await supabase
    .from('financial_portrait')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', traitId)
    .eq('user_id', user.id)
    .select('trait_type, trait_key, trait_value, confidence')
    .maybeSingle();

  if (error) {
    console.error('Trait dismiss error:', error);
    return Response.json({ error: 'Failed to dismiss' }, { status: 500 });
  }

  if (dismissed) {
    await recordTraitDismissal(supabase, user.id, dismissed);
  }

  return Response.json({ success: true });
}
