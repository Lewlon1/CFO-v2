'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function formatCurrency(amount: number, currency?: string): string {
  const c = currency || 'EUR';
  const symbol = c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'USD' ? '$' : c;
  return `${symbol}${Math.abs(amount).toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

const STATUS_STYLES: Record<string, string> = {
  planning: 'bg-blue-500/20 text-blue-400',
  booked: 'bg-emerald-500/20 text-emerald-400',
  in_progress: 'bg-amber-500/20 text-amber-400',
  completed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-500/20 text-red-400',
};

interface Trip {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  total_estimated: number | null;
  total_actual: number | null;
  status: string;
  currency: string;
  goal_id: string | null;
  conversation_id: string | null;
  funding_plan: { feasibility?: string } | null;
}

interface GoalProgress {
  current_amount: number;
  target_amount: number;
}

export function TripsClient({
  trips,
  goals,
}: {
  trips: Trip[];
  goals: Record<string, GoalProgress>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handlePlanTrip() {
    if (loading) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('conversations')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('status', 'active');

      const { data: conv } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          title: 'Trip planning',
          type: 'trip_planning',
        })
        .select('id')
        .single();

      if (conv) {
        router.push(`/chat/${conv.id}?starter=${encodeURIComponent('Help me plan a trip')}`);
      }
    } catch (err) {
      console.error('Error starting trip planning:', err);
    } finally {
      setLoading(false);
    }
  }

  const activeTrips = trips.filter(t => t.status === 'planning' || t.status === 'booked' || t.status === 'in_progress');
  const pastTrips = trips.filter(t => t.status === 'completed' || t.status === 'cancelled');

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Your Trips</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Plan, budget, and track your travels</p>
        </div>
        <button
          onClick={handlePlanTrip}
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Starting...' : '+ Plan a trip'}
        </button>
      </div>

      {trips.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-3xl mb-3">✈️</p>
          <p className="text-sm text-muted-foreground mb-4">No trips planned yet</p>
          <button
            onClick={handlePlanTrip}
            disabled={loading}
            className="text-sm text-primary hover:underline"
          >
            Plan your first trip
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {activeTrips.length > 0 && (
            <div className="space-y-3">
              {activeTrips.map((trip) => (
                <TripCard key={trip.id} trip={trip} goal={trip.goal_id ? goals[trip.goal_id] : undefined} />
              ))}
            </div>
          )}

          {pastTrips.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Past trips</h2>
              <div className="space-y-2">
                {pastTrips.map((trip) => (
                  <TripCard key={trip.id} trip={trip} goal={trip.goal_id ? goals[trip.goal_id] : undefined} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TripCard({ trip, goal }: { trip: Trip; goal?: GoalProgress }) {
  const router = useRouter();
  const fundingPct = goal && goal.target_amount > 0
    ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
    : null;

  return (
    <button
      onClick={() => {
        if (trip.conversation_id) {
          router.push(`/chat/${trip.conversation_id}`);
        }
      }}
      className="w-full text-left bg-card border border-border rounded-xl p-4 hover:bg-accent transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{trip.name}</p>
          {trip.start_date && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(trip.start_date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })}
              {trip.end_date && ` — ${new Date(trip.end_date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`}
            </p>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLES[trip.status] || 'bg-muted text-muted-foreground'}`}>
          {trip.status.replace('_', ' ')}
        </span>
      </div>

      {/* Budget line */}
      {trip.status === 'completed' && trip.total_actual != null ? (
        <div className="flex items-center justify-between text-xs mt-2">
          <span className="text-muted-foreground">
            Budget: {formatCurrency(trip.total_estimated || 0, trip.currency)}
          </span>
          <span className={trip.total_actual <= (trip.total_estimated || 0) ? 'text-emerald-400' : 'text-red-400'}>
            Actual: {formatCurrency(trip.total_actual, trip.currency)}
            {trip.total_estimated ? ` (${Math.round(((trip.total_estimated - trip.total_actual) / trip.total_estimated) * 100)}% ${trip.total_actual <= trip.total_estimated ? 'under' : 'over'})` : ''}
          </span>
        </div>
      ) : trip.total_estimated ? (
        <p className="text-xs text-muted-foreground mt-1">
          Budget: {formatCurrency(trip.total_estimated, trip.currency)}
        </p>
      ) : null}

      {/* Funding progress bar */}
      {fundingPct != null && trip.status !== 'completed' && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Funded</span>
            <span className="text-foreground">{fundingPct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${fundingPct}%` }}
            />
          </div>
        </div>
      )}
    </button>
  );
}
