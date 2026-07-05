// Shared admin gate for /admin/* dashboards. Requires auth + the signed-in
// email to be in ADMIN_EMAILS. On mismatch we return notFound() rather than
// 403 so unauthorised users can't infer the URL exists.

import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function assertAdmin(): Promise<{ email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? null;
  const allowed = adminEmails();
  if (!email || !allowed.includes(email)) {
    notFound();
  }
  return { email };
}
