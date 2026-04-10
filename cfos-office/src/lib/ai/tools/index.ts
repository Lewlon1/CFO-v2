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
import { createGetValueReviewQueueTool } from './get-value-review-queue';
import { createRecordValueClassificationsTool } from './record-value-classifications';
import { createDeleteValueRuleTool } from './delete-value-rule';
import { createCheckValueCheckinReadyTool } from './check-value-checkin-ready';
import { createSearchBillAlternativesTool } from './search-bill-alternatives';
import { createPlanTripTool } from './plan-trip';
import { createUpsertAssetTool } from './upsert-asset';
import { createUpsertLiabilityTool } from './upsert-liability';
import { createGetBalanceSheetTool } from './get-balance-sheet';
import { createCalculateDebtPayoffTool } from './calculate-debt-payoff';
import { createCalculatePensionProjectionTool } from './calculate-pension-projection';
import { createCalculateEmergencyFundTool } from './calculate-emergency-fund';
import { createGetNetWorthHistoryTool } from './get-net-worth-history';
import { createCreateGoalTool } from './create-goal';

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
    get_value_review_queue: createGetValueReviewQueueTool(ctx),
    record_value_classifications: createRecordValueClassificationsTool(ctx),
    delete_value_rule: createDeleteValueRuleTool(ctx),
    check_value_checkin_ready: createCheckValueCheckinReadyTool(ctx),
    search_bill_alternatives: createSearchBillAlternativesTool(ctx),
    plan_trip: createPlanTripTool(ctx),
    upsert_asset: createUpsertAssetTool(ctx),
    upsert_liability: createUpsertLiabilityTool(ctx),
    get_balance_sheet: createGetBalanceSheetTool(ctx),
    calculate_debt_payoff: createCalculateDebtPayoffTool(ctx),
    calculate_pension_projection: createCalculatePensionProjectionTool(ctx),
    calculate_emergency_fund: createCalculateEmergencyFundTool(ctx),
    get_net_worth_history: createGetNetWorthHistoryTool(ctx),
    create_goal: createCreateGoalTool(ctx),
  };
}
