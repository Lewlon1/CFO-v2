import { z } from 'zod';
import type { ToolContext } from './types';
import { loadCurrentBudget, loadAverageDiscretionary } from './helpers';

export function createPlanTripTool(ctx: ToolContext) {
  return {
    description:
      'Create a trip plan with budget breakdown and funding strategy. Call this AFTER you\'ve collected destination, dates, duration, travel style, and companions from the user, and AFTER you\'ve researched costs. Pass in the researched cost estimates.\n\nAll calculations are server-side — never estimate costs or compute savings yourself.',
    inputSchema: z.object({
      name: z.string().describe('Short trip label, e.g. "Japan Oct 2026"'),
      destination: z.string().describe('Where the user is going'),
      start_date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      end_date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      duration_days: z.number().describe('Number of days'),
      travel_style: z.enum(['budget', 'mid-range', 'luxury']),
      companions: z.enum(['solo', 'partner', 'family', 'friends', 'group']),
      companion_count: z.number().default(1).describe('Total number of people including the user'),
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
        const costs = input.estimated_costs;
        const totalEstimated = costs.flights + costs.accommodation + costs.food
          + costs.activities + costs.local_transport + costs.misc;

        // Calculate user's share based on companions
        let userShare: number;
        let splitNote: string | null = null;
        if (input.companions === 'partner') {
          userShare = totalEstimated / 2;
          splitNote = '50/50 split with partner';
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

        // Create goal
        const { data: goal, error: goalError } = await ctx.supabase
          .from('goals')
          .insert({
            user_id: ctx.userId,
            name: `Trip: ${input.destination}`,
            description: `Savings goal for ${input.name}`,
            target_amount: Math.round(userShare),
            current_amount: 0,
            target_date: input.start_date || null,
            monthly_required_saving: Math.round(monthlySavingRequired),
            on_track: feasibilityRating !== 'unrealistic',
            priority: 'medium',
            status: 'active',
          })
          .select('id, name')
          .single();

        if (goalError) {
          console.error('[tool:plan_trip] goal insert error:', goalError);
          return { error: 'Failed to create the savings goal. Please try again.' };
        }

        // Create/update trip record
        const { data: trip, error: tripError } = await ctx.supabase
          .from('trips')
          .insert({
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
            goal_id: goal.id,
            conversation_id: ctx.conversationId,
            status: 'planning',
            currency: input.currency,
            notes: input.notes || null,
          })
          .select('id')
          .single();

        if (tripError) {
          console.error('[tool:plan_trip] trip insert error:', tripError);
          // Goal was created, trip failed — not ideal but the goal is still useful
          return { error: 'Trip record failed to save, but your savings goal was created. Please try again.' };
        }

        // Link goal back to trip (for reference)
        return {
          type: 'trip_plan',
          trip_id: trip.id,
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
            id: goal.id,
            name: goal.name,
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
