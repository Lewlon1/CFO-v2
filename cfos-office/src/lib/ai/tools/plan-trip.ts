import { z } from 'zod';
import type { ToolContext } from './types';
import { loadCurrentBudget, loadAverageDiscretionary } from './helpers';

const LONG_TRIP_DAYS = 56; // 8 weeks

export function createPlanTripTool(ctx: ToolContext) {
  return {
    description:
      'Create or update a trip plan with budget breakdown and funding strategy. Call this AFTER you\'ve collected destination, dates, duration, travel style, and companions from the user, and AFTER you\'ve researched costs. Pass in the researched cost estimates.\n\nThis tool is idempotent within a conversation: if a trip already exists for this conversation (or matches the destination), it will be updated rather than duplicated. When the user corrects a date, split, or duration, simply re-call plan_trip with the new values.\n\nAll calculations are server-side — never estimate costs or compute savings yourself.',
    inputSchema: z.object({
      name: z.string().describe('Short trip label, e.g. "Japan Oct 2026"'),
      destination: z.string().describe('Where the user is going'),
      start_date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      end_date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      duration_days: z.number().describe('Number of days'),
      travel_style: z.enum(['budget', 'mid-range', 'luxury']),
      companions: z.enum(['solo', 'partner', 'family', 'friends', 'group']),
      companion_count: z.number().default(1).describe('Total number of people including the user'),
      user_share_percent: z.number().min(0).max(100).optional().describe(
        "User's share of the total cost as a percentage (e.g. 60 means the user pays 60%, partner/group pays 40%). If omitted, defaults to an even split based on companions (50% with partner, 1/N for friends/group, 100% solo). ONLY set this when the user has explicitly stated a non-even split."
      ),
      user_confirmed_long_duration: z.boolean().optional().describe(
        'Set to true ONLY after the user has explicitly confirmed a trip longer than 8 weeks (56 days) in their last message. Required to bypass the long-duration guard. Never set this true without an explicit user statement confirming the duration.'
      ),
      estimated_costs: z.object({
        flights: z.number().describe('Round-trip flight cost total (all travellers)'),
        accommodation: z.number().describe('Total accommodation cost'),
        food: z.number().describe('Total food/dining estimate'),
        activities: z.number().describe('Excursions, entry fees, experiences'),
        local_transport: z.number().describe('Trains, taxis, buses at destination'),
        misc: z.number().describe('Shopping, souvenirs, buffer'),
      }),
      currency: z.string().default('EUR'),
      notes: z.string().optional(),
    }),
    execute: async (input: {
      name: string;
      destination: string;
      start_date?: string;
      end_date?: string;
      duration_days: number;
      travel_style: string;
      companions: string;
      companion_count: number;
      user_share_percent?: number;
      user_confirmed_long_duration?: boolean;
      estimated_costs: {
        flights: number;
        accommodation: number;
        food: number;
        activities: number;
        local_transport: number;
        misc: number;
      };
      currency: string;
      notes?: string;
    }) => {
      try {
        // Long-duration guard: block before any DB read or write.
        if (input.duration_days > LONG_TRIP_DAYS && !input.user_confirmed_long_duration) {
          console.warn('[tool:plan_trip] long-duration guard tripped', {
            userId: ctx.userId,
            conversationId: ctx.conversationId,
            destination: input.destination,
            duration_days: input.duration_days,
          });
          return {
            requires_confirmation: true,
            reason: 'long_duration',
            message: `${input.duration_days} days is over 8 weeks. Confirm with the user that this duration is correct, then re-call plan_trip with user_confirmed_long_duration: true.`,
            echo: { destination: input.destination, duration_days: input.duration_days },
          };
        }

        const costs = input.estimated_costs;
        const totalEstimated = costs.flights + costs.accommodation + costs.food
          + costs.activities + costs.local_transport + costs.misc;

        // Calculate user's share — explicit percent overrides companion-based defaults.
        let userShare: number;
        let splitNote: string | null = null;
        if (input.user_share_percent != null) {
          userShare = totalEstimated * (input.user_share_percent / 100);
          const otherPercent = 100 - input.user_share_percent;
          const counterparty =
            input.companions === 'partner' ? 'partner'
            : input.companions === 'family' ? 'family'
            : input.companions === 'friends' || input.companions === 'group' ? 'others'
            : null;
          splitNote = counterparty
            ? `${input.user_share_percent}/${otherPercent} split with ${counterparty}`
            : `${input.user_share_percent}% user share`;
        } else if (input.companions === 'partner') {
          userShare = totalEstimated / 2;
          splitNote = '50/50 split with partner (default — confirm with user)';
        } else if ((input.companions === 'friends' || input.companions === 'group') && input.companion_count > 1) {
          userShare = totalEstimated / input.companion_count;
          splitNote = `Split ${input.companion_count} ways`;
        } else {
          userShare = totalEstimated;
        }

        // Load financial position
        const [budget, avgDiscretionary] = await Promise.all([
          loadCurrentBudget(ctx),
          loadAverageDiscretionary(ctx),
        ]);

        // Calculate funding plan
        let monthsUntilTrip = 0;
        if (input.start_date) {
          const tripDate = new Date(input.start_date);
          const now = new Date();
          monthsUntilTrip = Math.max(0,
            (tripDate.getFullYear() - now.getFullYear()) * 12
            + (tripDate.getMonth() - now.getMonth())
          );
        }

        const currentSurplus = budget.netIncome
          ? budget.netIncome + budget.partnerContribution - budget.fixedCosts - (avgDiscretionary ?? 0)
          : null;

        const monthlySavingRequired = monthsUntilTrip > 0
          ? userShare / monthsUntilTrip
          : userShare; // Needs immediate funding

        // Feasibility rating
        let feasibilityRating: string;
        let suggestedCuts: Array<{ category: string; current_monthly: number; suggested_reduction: number }> = [];

        if (currentSurplus == null || currentSurplus <= 0) {
          feasibilityRating = 'unrealistic';
        } else {
          const pctOfSurplus = monthlySavingRequired / currentSurplus;
          if (pctOfSurplus <= 0.5) feasibilityRating = 'comfortable';
          else if (pctOfSurplus <= 0.8) feasibilityRating = 'tight';
          else if (pctOfSurplus <= 1.0) feasibilityRating = 'stretch';
          else feasibilityRating = 'unrealistic';

          // If tight or stretch, suggest discretionary cuts
          if (feasibilityRating === 'tight' || feasibilityRating === 'stretch' || feasibilityRating === 'unrealistic') {
            const { data: latestSnapshot } = await ctx.supabase
              .from('monthly_snapshots')
              .select('spending_by_category')
              .eq('user_id', ctx.userId)
              .order('month', { ascending: false })
              .limit(1)
              .single();

            if (latestSnapshot?.spending_by_category) {
              const categories = latestSnapshot.spending_by_category as Record<string, number>;
              // Sort by spend descending, skip fixed categories
              const fixedCategories = new Set(['rent', 'mortgage', 'bills', 'insurance', 'loan']);
              const discretionaryCategories = Object.entries(categories)
                .filter(([cat]) => !fixedCategories.has(cat))
                .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                .slice(0, 3);

              suggestedCuts = discretionaryCategories.map(([cat, amount]) => ({
                category: cat,
                current_monthly: Math.round(Math.abs(amount)),
                suggested_reduction: Math.round(Math.abs(amount) * 0.2), // suggest 20% reduction
              }));
            }
          }
        }

        const fundingPlan = {
          user_share: Math.round(userShare),
          split_note: splitNote,
          months_until_trip: monthsUntilTrip,
          monthly_saving_required: Math.round(monthlySavingRequired),
          current_monthly_surplus: currentSurplus != null ? Math.round(currentSurplus) : null,
          feasibility: feasibilityRating,
          suggested_cuts: suggestedCuts.length > 0 ? suggestedCuts : undefined,
        };

        // Dedup: find an existing trip to update before inserting a new one.
        // Priority 1: same conversation (handles in-conversation refinements).
        // Priority 2: same destination (case-insensitive) in planning/booked status.
        type ExistingTrip = { id: string; goal_id: string | null };
        let existingTrip: ExistingTrip | null = null;

        if (ctx.conversationId) {
          const { data } = await ctx.supabase
            .from('trips')
            .select('id, goal_id')
            .eq('user_id', ctx.userId)
            .eq('conversation_id', ctx.conversationId)
            .in('status', ['planning', 'booked'])
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          existingTrip = data ?? null;
        }

        if (!existingTrip) {
          const { data } = await ctx.supabase
            .from('trips')
            .select('id, goal_id')
            .eq('user_id', ctx.userId)
            .ilike('destination', input.destination.trim())
            .in('status', ['planning', 'booked'])
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          existingTrip = data ?? null;
        }

        const tripPayload = {
          user_id: ctx.userId,
          name: input.name,
          destination: input.destination,
          start_date: input.start_date || null,
          end_date: input.end_date || null,
          duration_days: input.duration_days,
          travel_style: input.travel_style,
          companions: input.companions,
          companion_count: input.companion_count,
          estimated_budget: costs,
          total_estimated: Math.round(totalEstimated),
          funding_plan: fundingPlan,
          conversation_id: ctx.conversationId,
          status: 'planning' as const,
          currency: input.currency,
          notes: input.notes || null,
        };

        const goalPayload = {
          user_id: ctx.userId,
          name: `Trip: ${input.destination}`,
          description: `Savings goal for ${input.name}`,
          target_amount: Math.round(userShare),
          target_date: input.start_date || null,
          monthly_required_saving: Math.round(monthlySavingRequired),
          on_track: feasibilityRating !== 'unrealistic',
          priority: 'medium' as const,
          status: 'active' as const,
        };

        let tripId: string;
        let goalId: string;
        let goalName: string;

        if (existingTrip) {
          // UPDATE the existing trip + its linked goal (preserve goal_id where present).
          if (existingTrip.goal_id) {
            const { data: updatedGoal, error: goalError } = await ctx.supabase
              .from('goals')
              .update(goalPayload)
              .eq('id', existingTrip.goal_id)
              .select('id, name')
              .single();
            if (goalError) {
              console.error('[tool:plan_trip] goal update error:', goalError);
              return { error: 'Failed to update the savings goal. Please try again.' };
            }
            goalId = updatedGoal.id;
            goalName = updatedGoal.name;
          } else {
            const { data: newGoal, error: goalError } = await ctx.supabase
              .from('goals')
              .insert({ ...goalPayload, current_amount: 0 })
              .select('id, name')
              .single();
            if (goalError) {
              console.error('[tool:plan_trip] goal insert error (existing trip without goal):', goalError);
              return { error: 'Failed to create the savings goal. Please try again.' };
            }
            goalId = newGoal.id;
            goalName = newGoal.name;
          }

          const { error: tripError } = await ctx.supabase
            .from('trips')
            .update({ ...tripPayload, goal_id: goalId })
            .eq('id', existingTrip.id);
          if (tripError) {
            console.error('[tool:plan_trip] trip update error:', tripError);
            return { error: 'Trip record failed to save. Please try again.' };
          }
          tripId = existingTrip.id;
        } else {
          // INSERT new goal + new trip.
          const { data: goal, error: goalError } = await ctx.supabase
            .from('goals')
            .insert({ ...goalPayload, current_amount: 0 })
            .select('id, name')
            .single();
          if (goalError) {
            console.error('[tool:plan_trip] goal insert error:', goalError);
            return { error: 'Failed to create the savings goal. Please try again.' };
          }
          goalId = goal.id;
          goalName = goal.name;

          const { data: trip, error: tripError } = await ctx.supabase
            .from('trips')
            .insert({ ...tripPayload, goal_id: goalId })
            .select('id')
            .single();
          if (tripError) {
            console.error('[tool:plan_trip] trip insert error:', tripError);
            return { error: 'Trip record failed to save, but your savings goal was created. Please try again.' };
          }
          tripId = trip.id;
        }

        return {
          type: 'trip_plan',
          trip_id: tripId,
          updated_existing: existingTrip != null,
          name: input.name,
          destination: input.destination,
          dates: input.start_date && input.end_date
            ? `${input.start_date} → ${input.end_date}`
            : `${input.duration_days} days`,
          travel_style: input.travel_style,
          companions: input.companions,
          companion_count: input.companion_count,
          budget: {
            flights: costs.flights,
            accommodation: costs.accommodation,
            food: costs.food,
            activities: costs.activities,
            local_transport: costs.local_transport,
            misc: costs.misc,
            total: Math.round(totalEstimated),
          },
          funding: fundingPlan,
          goal: {
            id: goalId,
            name: goalName,
            target: Math.round(userShare),
            monthly_saving: Math.round(monthlySavingRequired),
          },
          currency: input.currency,
        };
      } catch (err) {
        console.error('[tool:plan_trip] unexpected error:', err);
        return { error: 'Something went wrong creating the trip plan. Please try again.' };
      }
    },
  };
}
