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
import { createPlanEventTool } from './plan-event';
import { createUpsertAssetTool } from './upsert-asset';
import { createUpsertLiabilityTool } from './upsert-liability';
import { createGetBalanceSheetTool } from './get-balance-sheet';
import { createCalculateDebtPayoffTool } from './calculate-debt-payoff';
import { createCalculatePensionProjectionTool } from './calculate-pension-projection';
import { createCalculateEmergencyFundTool } from './calculate-emergency-fund';
import { createGetNetWorthHistoryTool } from './get-net-worth-history';
import { createCreateGoalTool } from './create-goal';
import { createLogContributionTool } from './log-contribution';
import { createComputeGoalPaceTool } from './compute-goal-pace';
import { createComputePeriodAverageTool } from './compute-period-average';
import { createCompareMonthToGoalTool } from './compare-month-to-goal';
// Session v2.2 — Chat Intelligence tools.
import { createGetTransactionsTool } from './get-transactions';
import { createGetTopMerchantsTool } from './get-top-merchants';
import { createFindMoneyClustersTool } from './find-money-clusters';
import { createFindTemporalSignalsTool } from './find-temporal-signals';
import { createFindTrendChangesTool } from './find-trend-changes';
import { createFindOutliersTool } from './find-outliers';
import { createFindValueGapsTool } from './find-value-gaps';
import { createLabelTransactionsTool } from './label-transactions';
// Session v2.3 — Experiment Engine.
import { createProposeCatalogExperimentTool } from './propose-catalog-experiment';
import { createAcceptExperimentTool } from './accept-experiment';
import { createDeclineExperimentTool } from './decline-experiment';
import { createRecordExperimentOutcomeTool } from './record-experiment-outcome';
import { createListActiveExperimentsTool } from './list-active-experiments';
// Structured action emission — replaces the legacy <ACTION:…> text-token mechanism.
import { createEmitActionTool } from './emit-action';
// Session 32 (A) — Layer 3 + Layer 4 tools.
import { createGetClusterBehaviourTool } from './get-cluster-behaviour';
import { createGetConversationSignalsTool } from './get-conversation-signals';

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
    plan_event: createPlanEventTool(ctx),
    upsert_asset: createUpsertAssetTool(ctx),
    upsert_liability: createUpsertLiabilityTool(ctx),
    get_balance_sheet: createGetBalanceSheetTool(ctx),
    calculate_debt_payoff: createCalculateDebtPayoffTool(ctx),
    calculate_pension_projection: createCalculatePensionProjectionTool(ctx),
    calculate_emergency_fund: createCalculateEmergencyFundTool(ctx),
    get_net_worth_history: createGetNetWorthHistoryTool(ctx),
    create_goal: createCreateGoalTool(ctx),
    log_contribution: createLogContributionTool(ctx),
    compute_goal_pace: createComputeGoalPaceTool(ctx),
    compute_period_average: createComputePeriodAverageTool(ctx),
    compare_month_to_goal: createCompareMonthToGoalTool(ctx),
    // Session v2.2 — Chat Intelligence tools
    get_transactions: createGetTransactionsTool(ctx),
    get_top_merchants: createGetTopMerchantsTool(ctx),
    find_money_clusters: createFindMoneyClustersTool(ctx),
    find_temporal_signals: createFindTemporalSignalsTool(ctx),
    find_trend_changes: createFindTrendChangesTool(ctx),
    find_outliers: createFindOutliersTool(ctx),
    find_value_gaps: createFindValueGapsTool(ctx),
    label_transactions: createLabelTransactionsTool(ctx),
    // Session v2.3 — Experiment Engine
    propose_catalog_experiment: createProposeCatalogExperimentTool(ctx),
    accept_experiment: createAcceptExperimentTool(ctx),
    decline_experiment: createDeclineExperimentTool(ctx),
    record_experiment_outcome: createRecordExperimentOutcomeTool(ctx),
    list_active_experiments: createListActiveExperimentsTool(ctx),
    // Structured action emission
    emit_action: createEmitActionTool(ctx),
    // Session 32 (A) — Layer 3 / Layer 4 tools.
    get_cluster_behaviour: createGetClusterBehaviourTool(ctx),
    get_conversation_signals: createGetConversationSignalsTool(ctx),
  };
}
