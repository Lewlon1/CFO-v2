// Session 32 (C) — Per-insight deep dive.
// Renders the first Read body, the composition metadata that fed it, the
// behavioural event timeline, the user's first follow-up messages, and the
// tools the CFO invoked. This is the view Lewis uses to read a single
// session as a complete story.

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? null;
  const allowed = adminEmails();
  if (!email || !allowed.includes(email)) {
    notFound();
  }
}

type Params = { insightId: string };

export default async function AdminWowDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  await assertAdmin();
  const { insightId } = await params;
  const svc = createServiceClient();

  const { data: assessment, error: assessmentErr } = await svc
    .from('wow_assessments')
    .select(
      'id, user_id, first_insight_message_id, conversation_id, delivered_at, predicted_wow_score, judge_id, realised_wow_score, in_session_score, overnight_score, last_aggregated_at, gap_present, layers_used, features_cited, clusters_referenced',
    )
    .eq('first_insight_message_id', insightId)
    .maybeSingle();

  if (assessmentErr) {
    return (
      <div className="p-6">
        <BackLink />
        <pre className="text-sm text-destructive mt-4">Query failed: {assessmentErr.message}</pre>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="p-6">
        <BackLink />
        <p className="mt-4 text-muted-foreground">
          No assessment found yet for this insight. The nightly aggregator may not have run.
        </p>
      </div>
    );
  }

  // Parallel data fetch: profile, insight body, events, follow-up messages.
  const [profile, insightRow, events, conversationRow, followUps] = await Promise.all([
    svc
      .from('user_profiles')
      .select('email, display_name, country, primary_currency')
      .eq('id', assessment.user_id)
      .maybeSingle(),
    svc
      .from('messages')
      .select('id, content, role, created_at, tools_used, actions_created')
      .eq('id', insightId)
      .maybeSingle(),
    svc
      .from('wow_events')
      .select('event_type, metadata, created_at')
      .eq('first_insight_message_id', insightId)
      .order('created_at', { ascending: true }),
    svc
      .from('conversations')
      .select('id, type, metadata, title, created_at')
      .eq('id', assessment.conversation_id)
      .maybeSingle(),
    svc
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', assessment.conversation_id)
      .eq('role', 'user')
      .gt('created_at', assessment.delivered_at)
      .order('created_at', { ascending: true })
      .limit(3),
  ]);

  const insight = insightRow.data;
  const conversation = conversationRow.data;
  const userEmail = profile.data?.email ?? assessment.user_id;
  const profileLine = profile.data
    ? `${userEmail} · ${profile.data.country ?? '—'} · ${profile.data.primary_currency ?? '—'}`
    : userEmail;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <BackLink />

      <header>
        <h1 className="text-xl font-semibold">First Read · {fmtDateTime(assessment.delivered_at)}</h1>
        <p className="text-sm text-muted-foreground mt-1">{profileLine}</p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Realised" value={fmtScore(assessment.realised_wow_score)} className={realisedClass(assessment.realised_wow_score)} />
        <Metric label="In-session" value={fmtScore(assessment.in_session_score)} />
        <Metric label="Overnight (D2)" value={fmtScore(assessment.overnight_score)} />
        <Metric label="Predicted" value={fmtScore(assessment.predicted_wow_score)} hint={assessment.judge_id ?? 'no judge'} />
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">The Read</h2>
        <div className="border border-border rounded-md p-4 bg-card whitespace-pre-wrap text-sm leading-relaxed">
          {insight?.content ?? '(message body missing — was it deleted?)'}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Composition</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <Kv k="Layers used" v={(assessment.layers_used as string[] ?? []).join(', ') || '—'} />
          <Kv k="Features cited" v={(assessment.features_cited as string[] ?? []).join(', ') || '—'} />
          <Kv k="Clusters referenced" v={(assessment.clusters_referenced as string[] ?? []).join(', ') || '—'} />
          <Kv k="Gap present" v={assessment.gap_present ? 'yes' : 'no'} />
          <Kv k="Conversation type" v={conversation?.type ?? '—'} />
          <Kv k="Layered metadata" v={String((conversation?.metadata as Record<string, unknown> | null)?.layered_read ?? false)} />
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Tools invoked</h2>
        <p className="text-sm">
          {Array.isArray(insight?.tools_used) && insight.tools_used.length > 0
            ? (insight.tools_used as string[]).join(', ')
            : 'none — first Read is a one-shot composition (no tool calls)'}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Event timeline ({events.data?.length ?? 0})
        </h2>
        <div className="border border-border rounded-md divide-y divide-border bg-card">
          {(events.data ?? []).length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No events captured.</p>
          ) : (
            (events.data ?? []).map(
              (e: { event_type: string; metadata: Record<string, unknown> | null; created_at: string }, idx: number) => (
                <div key={`${e.event_type}-${idx}`} className="p-3 text-sm flex items-baseline gap-3">
                  <span className="font-mono text-xs text-muted-foreground tabular-nums shrink-0">
                    {fmtTimeOnly(e.created_at)}
                  </span>
                  <span className="font-medium">{e.event_type}</span>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <span className="text-xs text-muted-foreground truncate">
                      {JSON.stringify(e.metadata)}
                    </span>
                  )}
                </div>
              ),
            )
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          User follow-ups ({followUps.data?.length ?? 0})
        </h2>
        <div className="space-y-2">
          {(followUps.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No follow-up messages.</p>
          ) : (
            (followUps.data ?? []).map(
              (m: { id: string; content: string; created_at: string }) => (
                <div key={m.id} className="border border-border rounded-md p-3 bg-card">
                  <div className="text-xs text-muted-foreground mb-1 tabular-nums">
                    {fmtDateTime(m.created_at)}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{m.content}</div>
                </div>
              ),
            )
          )}
        </div>
      </section>

      <footer className="text-xs text-muted-foreground pt-4 border-t border-border">
        Last aggregated: {assessment.last_aggregated_at ? fmtDateTime(assessment.last_aggregated_at) : 'never'}
        {' · '}
        Conversation id: <code>{assessment.conversation_id.slice(0, 8)}</code>
        {' · '}
        Insight id: <code>{assessment.first_insight_message_id.slice(0, 8)}</code>
      </footer>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link href="/admin/wow" className="text-sm text-primary hover:underline">
      ← All assessments
    </Link>
  );
}

function Metric({
  label,
  value,
  className,
  hint,
}: {
  label: string;
  value: string;
  className?: string;
  hint?: string;
}) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-1 tabular-nums ${className ?? ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="text-sm">{v}</dd>
    </div>
  );
}

function fmtScore(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(3);
}

function realisedClass(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  if (n >= 0.7) return 'text-green-600';
  if (n >= 0.4) return 'text-amber-600';
  return 'text-red-500';
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
