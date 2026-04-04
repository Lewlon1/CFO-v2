import { z } from 'zod';
import type { ToolContext } from './types';

export function createSuggestValueRecategorisationTool(ctx: ToolContext) {
  return {
    description:
      'Find transactions where the auto-assigned value_category might be wrong based on the user\'s personal context and Value Map responses. Use when the user wants to review their value categorisations or when you notice potential misclassifications.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum suggestions to return. Default: 5.'),
      month: z.string().optional().describe('Month to check in YYYY-MM format. Default: current month.'),
    }),
    execute: async ({ limit, month }: { limit?: number; month?: string }) => {
      try {
        const maxSuggestions = Math.min(limit || 5, 10);
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const startDate = `${targetMonth}-01`;
        const endYear = Number(targetMonth.split('-')[0]);
        const endMonth = Number(targetMonth.split('-')[1]);
        const endDate = new Date(endYear, endMonth, 0).toISOString().slice(0, 10);

        // Fetch user's value category rules
        const { data: rules } = await ctx.supabase
          .from('value_category_rules')
          .select('match_type, match_value, value_category, confidence')
          .eq('user_id', ctx.userId)
          .eq('match_type', 'category_id');

        const ruleMap = new Map<string, string>();
        for (const rule of rules || []) {
          ruleMap.set(rule.match_value, rule.value_category);
        }

        // Fetch transactions with low confidence or unsure value_category
        const { data: transactions, error } = await ctx.supabase
          .from('transactions')
          .select('id, description, amount, date, category_id, value_category, auto_category_confidence, user_confirmed')
          .eq('user_id', ctx.userId)
          .eq('user_confirmed', false)
          .lt('amount', 0)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('amount', { ascending: true }); // largest expenses first

        if (error) {
          console.error('[tool:suggest_value_recategorisation] DB error:', error);
          return { error: 'Could not fetch transactions. Please try again.' };
        }

        if (!transactions || transactions.length === 0) {
          return {
            suggestions: [],
            total_unchecked: 0,
            message: 'No unconfirmed transactions found for this month.',
          };
        }

        const suggestions: Array<{
          transaction_id: string;
          description: string;
          amount: number;
          date: string;
          current_value_category: string;
          suggested_value_category: string;
          reason: string;
          confidence: number;
        }> = [];

        for (const t of transactions) {
          if (suggestions.length >= maxSuggestions) break;

          const currentVc = t.value_category || 'unsure';
          const categoryId = t.category_id;
          const autoConfidence = t.auto_category_confidence ? Number(t.auto_category_confidence) : 1;

          // Check 1: User has a rule for this category but the transaction has a different value_category
          if (categoryId && ruleMap.has(categoryId)) {
            const userPreferred = ruleMap.get(categoryId)!;
            if (currentVc !== userPreferred) {
              suggestions.push({
                transaction_id: t.id,
                description: t.description || 'Unknown',
                amount: Math.abs(Number(t.amount)),
                date: t.date,
                current_value_category: currentVc,
                suggested_value_category: userPreferred,
                reason: `You usually categorise ${categoryId} as ${userPreferred}, but this was tagged as ${currentVc}.`,
                confidence: 0.8,
              });
              continue;
            }
          }

          // Check 2: Low auto-confidence
          if (autoConfidence < 0.7 && currentVc !== 'unsure') {
            suggestions.push({
              transaction_id: t.id,
              description: t.description || 'Unknown',
              amount: Math.abs(Number(t.amount)),
              date: t.date,
              current_value_category: currentVc,
              suggested_value_category: 'unsure',
              reason: `This was auto-categorised as ${currentVc} with low confidence (${Math.round(autoConfidence * 100)}%). Worth reviewing.`,
              confidence: autoConfidence,
            });
            continue;
          }

          // Check 3: Unsure transactions
          if (currentVc === 'unsure' && categoryId && ruleMap.has(categoryId)) {
            suggestions.push({
              transaction_id: t.id,
              description: t.description || 'Unknown',
              amount: Math.abs(Number(t.amount)),
              date: t.date,
              current_value_category: 'unsure',
              suggested_value_category: ruleMap.get(categoryId)!,
              reason: `This is uncategorised but falls under ${categoryId}, which you\'ve classified as ${ruleMap.get(categoryId)}.`,
              confidence: 0.7,
            });
          }
        }

        const totalUnchecked = transactions.filter((t) => !t.user_confirmed).length;

        return {
          suggestions,
          total_unchecked: totalUnchecked,
          month: targetMonth,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:suggest_value_recategorisation] unexpected error:', err);
        return { error: 'Something went wrong checking categorisations. Please try again.' };
      }
    },
  };
}
