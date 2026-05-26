// Session 32 (C) — Admin dashboard index for first-Read measurement.
// Lists every wow_assessment row, sortable by delivered_at. Headline stats
// at the top sanity-check the rollup; each row links to a single-session
// deep-dive at /admin/wow/[insightId].
//
// Access control: requires auth + the signed-in email to be in ADMIN_EMAILS.
// On mismatch we return notFound() rather than 403 so unauthorised users
// can't infer the URL exists.

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

async function assertAdmin(): Promise<{ email: string }> {
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

type AssessmentRow = {
  id: string;
  user_id: string;
  first_insight_message_id: string;
  conversation_id: string;
  delivered_at: string;
  predicted_wow_score: number | null;
  realised_wow_score: number | null;
  in_session_score: number | null;
  overnight_score: number | null;
  gap_present: boolean;
  layers_used: string[];
  features_cited: string[];
  clusters_referenced: string[];
  last_aggregated_at: string | null;
};

type EventCounts = {
  replied_substantively: boolean;
  chip_tapped: boolean;
  scrolled_to_bottom: boolean;
  returned_d2: boolean;
  resonance_tap_positive: boolean;
  resonance_tap_negative: boolean;
};

export default async function AdminWowIndexPage() {
  await assertAdmin();
  const svc = createServiceClient();

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data: assessments, error } = await svc
    .from('wow_assessments')
    .select(
      'id, user_id, first_insight_message_id, conversation_id, delivered_at, predicted_wow_score, realised_wow_score, in_session_score, overnight_score, gap_present, layers_used, features_cited, clusters_referenced, last_aggregated_at',
    )
    .gte('delivered_at', since)
    .order('delivered_at', { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Wow Measurement</h1>
        <pre className="text-sm text-destructive">Query failed: {error.message}</pre>
      </div>
    );
  }

  const rows = (assessments ?? []) as AssessmentRow[];

  // Lookup emails for each user_id in one round-trip.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await svc
      .from('user_profiles')
      .select('id, email')
      .in('id', userIds);
    for (const p of (profiles ?? []) as Array<{ id: string; email: string | null }>) {
      if (p.email) emailByUserId.set(p.id, p.email);
    }
  }

  // Fetch the union of relevant wow_events so we can render per-row signal
  // icons without N+1 queries.
  const insightIds = rows.map((r) => r.first_insight_message_id);
  const eventsByInsight = new Map<string, EventCounts>();
  if (insightIds.length > 0) {
    const { data: events } = await svc
      .from('wow_events')
      .select('first_insight_message_id, event_type')
      .in('first_insight_message_id', insightIds);
    for (const e of (events ?? []) as Array<{
      first_insight_message_id: string;
      event_type: keyof EventCounts;
    }>) {
      const existing = eventsByInsight.get(e.first_insight_message_id) ?? {
        replied_substantively: false,
        chip_tapped: false,
        scrolled_to_bottom: false,
        returned_d2: false,
        resonance_tap_positive: false,
        resonance_tap_negative: false,
      };
      existing[e.event_type] = true;
      eventsByInsight.set(e.first_insight_message_id, existing);
    }
  }

  // Headline stats — derived from rows with a realised score (i.e. cron has
  // touched them at least once).
  const scored = rows.filter((r) => r.realised_wow_score != null);
  const meanRealised =
    scored.length > 0
      ? scored.reduce((a, r) => a + (r.realised_wow_score ?? 0), 0) / scored.length
      : null;
  const wowCount = scored.filter((r) => (r.realised_wow_score ?? 0) >= 0.7).length;
  const meanPredicted =
    scored.filter((r) => r.predicted_wow_score != null).length > 0
      ? scored
          .filter((r) => r.predicted_wow_score != null)
          .reduce((a, r) => a + (r.predicted_wow_score ?? 0), 0) /
        scored.filter((r) => r.predicted_wow_score != null).length
      : null;
  const calibrationDelta =
    meanPredicted != null && meanRealised != null ? meanPredicted - meanRealised : null;
  const d2Returns = scored.filter((r) => (r.overnight_score ?? 0) === 1).length;
  const d2Rate = scored.length > 0 ? d2Returns / scored.length : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Wow Measurement</h1>
        <p className="text-sm text-muted-foreground mt-1">
          n={rows.length} first Reads delivered in the last 30 days · {scored.length} with
          realised scores
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Mean realised"
          value={fmtScore(meanRealised)}
          hint="0.7 = engagement bar"
        />
        <StatCard
          label="≥ 0.7 hits"
          value={wowCount.toString()}
          hint={`${scored.length === 0 ? '0%' : Math.round((wowCount / scored.length) * 100) + '%'} of scored`}
        />
        <StatCard
          label="Calibration delta"
          value={calibrationDelta == null ? '—' : signed3(calibrationDelta)}
          hint="predicted − realised"
        />
        <StatCard
          label="D2 return rate"
          value={d2Rate == null ? '—' : Math.round(d2Rate * 100) + '%'}
          hint={`${d2Returns} of ${scored.length}`}
        />
      </section>

      <div className="overflow-x-auto border border-border rounded-md">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <Th>Delivered</Th>
              <Th>User</Th>
              <Th>Predicted</Th>
              <Th>Realised</Th>
              <Th>Signals</Th>
              <Th>Layers</Th>
              <Th>Features</Th>
              <Th>Gap?</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const events = eventsByInsight.get(r.first_insight_message_id);
              return (
                <tr key={r.id} className="hover:bg-muted/30">
                  <Td>{fmtDateTime(r.delivered_at)}</Td>
                  <Td>{emailByUserId.get(r.user_id) ?? shortId(r.user_id)}</Td>
                  <Td>{fmtScore(r.predicted_wow_score)}</Td>
                  <Td className={realisedClass(r.realised_wow_score)}>
                    {fmtScore(r.realised_wow_score)}
                  </Td>
                  <Td>
                    <SignalIcons events={events} />
                  </Td>
                  <Td>{(r.layers_used ?? []).join(', ') || '—'}</Td>
                  <Td>{(r.features_cited ?? []).join(', ') || '—'}</Td>
                  <Td>{r.gap_present ? '✓' : '—'}</Td>
                  <Td>
                    <Link
                      href={`/admin/wow/${r.first_insight_message_id}`}
                      className="text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </Td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-muted-foreground">
                  No first Reads in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Cell helpers ───────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className ?? ''}`}>{children}</td>;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function SignalIcons({ events }: { events: EventCounts | undefined }) {
  if (!events) return <span className="text-muted-foreground">—</span>;
  const parts: string[] = [];
  if (events.replied_substantively) parts.push('💬');
  if (events.chip_tapped) parts.push('👆');
  if (events.scrolled_to_bottom) parts.push('⏬');
  if (events.returned_d2) parts.push('🌅');
  if (events.resonance_tap_positive) parts.push('👍');
  if (events.resonance_tap_negative) parts.push('👎');
  return <span>{parts.join(' ') || '—'}</span>;
}

function fmtScore(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(3);
}

function signed3(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(3);
}

function realisedClass(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  if (n >= 0.7) return 'text-green-600 font-medium';
  if (n >= 0.4) return 'text-amber-600';
  return 'text-red-500';
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
