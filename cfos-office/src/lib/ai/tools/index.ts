import type { ToolContext } from './types';
import { createGetSpendingSummaryTool } from './get-spending-summary';
import { createCompareMonthsTool } from './compare-months';
import { createGetValueBreakdownTool } from './get-value-breakdown';
import { createCalculateMonthlyBudgetTool } from './calculate-monthly-budget';
import { createGetActionItemsTool } from './get-action-items';
import { createCreateActionItemTool } from './create-action-item';
import { createModelScenarioTool } from './model-scenario';
import { createAnalyseGapTool } from './analyse-gap';
import { createSuggestValueRecategorisationTool } from './suggest-value-recategorisation';
import { createSearchBillAlternativesTool } from './search-bill-alternatives';

export type { ToolContext } from './types';

export function createToolbox(ctx: ToolContext) {
  return {
    get_spending_summary: createGetSpendingSummaryTool(ctx),
    compare_months: createCompareMonthsTool(ctx),
    get_value_breakdown: createGetValueBreakdownTool(ctx),
    calculate_monthly_budget: createCalculateMonthlyBudgetTool(ctx),
    get_action_items: createGetActionItemsTool(ctx),
    create_action_item: createCreateActionItemTool(ctx),
    model_scenario: createModelScenarioTool(ctx),
    analyse_gap: createAnalyseGapTool(ctx),
    suggest_value_recategorisation: createSuggestValueRecategorisationTool(ctx),
    search_bill_alternatives: createSearchBillAlternativesTool(ctx),
  };
}
