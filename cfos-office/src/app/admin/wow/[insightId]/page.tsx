// Session 32 (C) — Per-insight deep dive.
// Renders the first Read body, the composition metadata that fed it, the
// behavioural event timeline, the user's first follow-up messages, and the
// tools the CFO invoked. This is the view Lewis uses to read a single
// session as a complete story.

import Link from 'next/link';

import { assertAdmin } from '@/lib/admin/assert-admin';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { insightId: string };

type ReadFeedbackRow = {
  id: string;
  body: string;
  citation_set: Array<{ value: number; source: string }> | null;
  read_context: Record<string, unknown> | null;
  read_snapshot: string | null;
  status: string;
  created_at: string;
};

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
      'id, user_id, first_read_message_id, conversation_id, delivered_at, predicted_wow_score, judge_id, realised_wow_score, in_session_score, overnight_score, last_aggregated_at, gap_present, layers_used, features_cited, clusters_referenced',
    )
    .eq('first_read_message_id', insightId)
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

  // Parallel data fetch: profile, admin user record (for email — user_profiles
  // has no email column), insight body, events, follow-up messages.
  const [profile, adminUserResult, insightRow, events, conversationRow, followUps, reportRows] =
    await Promise.all([
    svc
      .from('user_profiles')
      .select('display_name, country, primary_currency')
      .eq('id', assessment.user_id)
      .maybeSingle(),
    svc.auth.admin.getUserById(assessment.user_id),
    svc
      .from('messages')
      .select('id, content, role, created_at, tools_used, actions_created')
      .eq('id', insightId)
      .maybeSingle(),
    svc
      .from('wow_events')
      .select('event_type, metadata, created_at')
      .eq('first_read_message_id', insightId)
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
    svc
      .from('read_feedback')
      .select('id, body, citation_set, read_context, read_snapshot, status, created_at')
      .eq('first_read_message_id', insightId)
      .order('created_at', { ascending: true }),
  ]);

  const insight = insightRow.data;
  const conversation = conversationRow.data;
  const reports = (reportRows.data ?? []) as ReadFeedbackRow[];
  // The Read as it stands NOW. A report's read_snapshot is the Read as it stood
  // when the user complained — recompose can have rewritten it since, which is
  // exactly why the snapshot is stored per report rather than joined.
  const currentReadBody = insight?.content ?? null;
  const userEmail = adminUserResult.data?.user?.email ?? assessment.user_id;
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

      {/* Session 083 — where a report becomes a diff. Each row pairs the user's
          own words with the figures that Read cited and the source that computed
          each one, so "the £340 is wrong" resolves to a bundle, not a guess. */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Error reports ({reports.length})
        </h2>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None. The control is a single tap under the Read — no report means
            either nothing was wrong or nobody looked closely enough to say.
          </p>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => {
              const figures = Array.isArray(r.citation_set) ? r.citation_set : [];
              const staleSnapshot =
                r.read_snapshot != null &&
                currentReadBody != null &&
                r.read_snapshot !== currentReadBody;
              return (
                <div key={r.id} className="border border-destructive/40 rounded-md p-4 bg-card">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <span>{fmtDateTime(r.created_at)}</span>
                    <span>·</span>
                    <span className="uppercase tracking-wide">{r.status}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{r.body}</p>

                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="text-xs text-muted-foreground mb-1">
                      Figures this Read cited ({figures.length})
                    </div>
                    {figures.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        None recorded — composed before migration 083 shipped.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {figures.map((f, i) => (
                          <span
                            key={`${r.id}-fig-${i}`}
                            className="text-xs border border-border rounded px-1.5 py-0.5"
                          >
                            {f.value}{' '}
                            <span className="text-muted-foreground">· {f.source}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-2">
                      Context: {fmtReadContext(r.read_context)}
                    </div>
                  </div>

                  {staleSnapshot && (
                    <details className="mt-3 pt-3 border-t border-border">
                      <summary className="text-xs text-destructive cursor-pointer">
                        The Read has changed since this report — show what they actually saw
                      </summary>
                      <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {r.read_snapshot}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
        Insight id: <code>{assessment.first_read_message_id.slice(0, 8)}</code>
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

/** One-line summary of a report's composition context: how the Read was built. */
function fmtReadContext(context: Record<string, unknown> | null): string {
  if (!context) return '—';
  const parts: string[] = [];
  if (context.mode) parts.push(`mode ${String(context.mode)}`);
  if (context.read_recipe) parts.push(`recipe ${String(context.read_recipe)}`);
  if (Array.isArray(context.layers_used) && context.layers_used.length > 0) {
    parts.push(`layers ${(context.layers_used as unknown[]).join('/')}`);
  }
  if (context.is_recompose) parts.push('recompose');
  return parts.join(' · ') || '—';
}
