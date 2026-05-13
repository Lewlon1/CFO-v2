# Knip report

## Unused files (30)

| Name                                                        | Location                                                    | Severity |
| :---------------------------------------------------------- | :---------------------------------------------------------- | :------- |
| src/lib/ai/__tests__/context-builder-quotable-facts.test.ts | src/lib/ai/__tests__/context-builder-quotable-facts.test.ts | error    |
| src/lib/analytics/__tests__/resolve-user-currency.test.ts   | src/lib/analytics/__tests__/resolve-user-currency.test.ts   | error    |
| src/lib/value-map/__tests__/retake-candidates.test.ts       | src/lib/value-map/__tests__/retake-candidates.test.ts       | error    |
| src/lib/prediction/__tests__/learning-engine.test.ts        | src/lib/prediction/__tests__/learning-engine.test.ts        | error    |
| tests/onboarding/unit/calculate-personality.test.ts         | tests/onboarding/unit/calculate-personality.test.ts         | error    |
| src/lib/parsers/__tests__/universal-csv.test.ts             | src/lib/parsers/__tests__/universal-csv.test.ts             | error    |
| src/lib/prediction/__tests__/confidence.test.ts             | src/lib/prediction/__tests__/confidence.test.ts             | error    |
| src/lib/prediction/__tests__/predictor.test.ts              | src/lib/prediction/__tests__/predictor.test.ts              | error    |
| src/lib/categorisation/categorisation.test.ts               | src/lib/categorisation/categorisation.test.ts               | error    |
| src/lib/parsers/__tests__/fingerprint.test.ts               | src/lib/parsers/__tests__/fingerprint.test.ts               | error    |
| tests/onboarding/unit/csv-summariser.test.ts                | tests/onboarding/unit/csv-summariser.test.ts                | error    |
| tests/onboarding/unit/preflight.test.ts                     | tests/onboarding/unit/preflight.test.ts                     | error    |
| src/lib/csv/__tests__/transform.test.ts                     | src/lib/csv/__tests__/transform.test.ts                     | error    |
| src/lib/analytics/onboarding-events.ts                      | src/lib/analytics/onboarding-events.ts                      | error    |
| src/lib/parsers/__tests__/ofx.test.ts                       | src/lib/parsers/__tests__/ofx.test.ts                       | error    |
| src/lib/parsers/__tests__/qif.test.ts                       | src/lib/parsers/__tests__/qif.test.ts                       | error    |
| src/lib/ai/insight-validator.test.ts                        | src/lib/ai/insight-validator.test.ts                        | error    |
| tests/onboarding/unit/args.test.ts                          | tests/onboarding/unit/args.test.ts                          | error    |
| scripts/verify-first-insight.ts                             | scripts/verify-first-insight.ts                             | error    |
| scripts/backfill-categories.ts                              | scripts/backfill-categories.ts                              | error    |
| src/lib/ai/audit-trail.test.ts                              | src/lib/ai/audit-trail.test.ts                              | error    |
| scripts/_stub-next-headers.ts                               | scripts/_stub-next-headers.ts                               | error    |
| scripts/reextract-portrait.ts                               | scripts/reextract-portrait.ts                               | error    |
| src/lib/csv/transform.ts                                    | src/lib/csv/transform.ts                                    | error    |
| apply-migration.ts                                          | apply-migration.ts                                          | error    |
| check-staging2.ts                                           | check-staging2.ts                                           | error    |
| check-staging3.ts                                           | check-staging3.ts                                           | error    |
| test-normalise.ts                                           | test-normalise.ts                                           | error    |
| check-staging.ts                                            | check-staging.ts                                            | error    |
| test-rules.ts                                               | test-rules.ts                                               | error    |

## Unused dependencies (1)

| Name      | Location          | Severity |
| :-------- | :---------------- | :------- |
| react-dom | package.json:32:6 | error    |

## Unused devDependencies (2)

| Name             | Location          | Severity |
| :--------------- | :---------------- | :------- |
| @types/react-dom | package.json:46:6 | error    |
| tsx              | package.json:51:6 | error    |

## Unlisted binaries (4)

| Name   | Location     | Severity |
| :----- | :----------- | :------- |
| eslint | package.json | error    |
| vitest | package.json | error    |
| next   | package.json | error    |
| tsx    | package.json | error    |

## Unused exports (79)

| Name                            | Location                                                       | Severity |
| :------------------------------ | :------------------------------------------------------------- | :------- |
| default                         | src/components/office/dashboards/ScenariosDashboard.tsx:312:16 | error    |
| default                         | src/components/office/dashboards/CashFlowDashboard.tsx:325:16  | error    |
| default                         | src/components/office/dashboards/NetWorthDashboard.tsx:345:16  | error    |
| default                         | src/components/office/dashboards/ValuesDashboard.tsx:289:16    | error    |
| default                         | src/components/office/sections/ScenariosSection.tsx:43:16      | error    |
| default                         | src/components/office/sections/CashFlowSection.tsx:70:16       | error    |
| default                         | src/components/office/sections/NetWorthSection.tsx:51:16       | error    |
| default                         | src/components/office/dashboards/DetailHeader.tsx:44:16        | error    |
| default                         | src/components/office/dashboards/DrillDownRow.tsx:37:16        | error    |
| default                         | src/components/office/sections/ValuesSection.tsx:74:16         | error    |
| default                         | src/app/(office)/office/OfficeHomeClient.tsx:111:16            | error    |
| default                         | src/components/office/dashboards/Briefing.tsx:43:16            | error    |
| getMerchantKey                  | src/lib/categorisation/normalise-merchant.ts:88:14             | error    |
| default                         | src/components/navigation/NavigationBar.tsx:101:16             | error    |
| default                         | src/components/office/UserAvatarMenu.tsx:21:16                 | error    |
| transactionSizeDistribution     | src/lib/analytics/pattern-detectors.ts:128:14                  | error    |
| computeNetWorthSnapshot         | src/lib/analytics/net-worth-snapshot.ts:31:23                  | error    |
| geographicSpendingModes         | src/lib/analytics/pattern-detectors.ts:643:14                  | error    |
| categoryConcentration           | src/lib/analytics/pattern-detectors.ts:171:14                  | error    |
| recurringExpenseTotal           | src/lib/analytics/pattern-detectors.ts:295:14                  | error    |
| convenienceVsPlanned            | src/lib/analytics/pattern-detectors.ts:450:14                  | error    |
| monthOverMonthTrend             | src/lib/analytics/pattern-detectors.ts:757:14                  | error    |
| currentMonthStart               | src/lib/analytics/net-worth-snapshot.ts:27:17                  | error    |
| balanceTrajectory               | src/lib/analytics/pattern-detectors.ts:850:14                  | error    |
| spendingVelocity                | src/lib/analytics/pattern-detectors.ts:224:14                  | error    |
| INTRO_HEADLINES                 | src/lib/onboarding-v2/intro-headlines.ts:1:14                  | error    |
| incomeDetected                  | src/lib/analytics/pattern-detectors.ts:555:14                  | error    |
| dayOfWeekSkew                   | src/lib/analytics/pattern-detectors.ts:402:14                  | error    |
| valueMapGap                     | src/lib/analytics/pattern-detectors.ts:631:14                  | error    |
| default                         | src/components/office/FolderSection.tsx:81:16                  | error    |
| FileRow                         | src/components/data/DataComponents.tsx:184:17                  | error    |
| merchantFragmentation           | src/lib/analytics/pattern-detectors.ts:46:14                   | error    |
| CategoryBar                     | src/components/data/DataComponents.tsx:56:17                   | error    |
| isExpense                       | src/lib/analytics/pattern-detectors.ts:32:17                   | error    |
| isHoldingsMappingHighConfidence | src/lib/parsers/holdings-detector.ts:149:17                    | error    |
| computeDisciplineScore          | src/lib/analytics/insight-engine.ts:303:17                     | error    |
| computeStatCards                | src/lib/analytics/insight-engine.ts:187:17                     | error    |
| loadDotenvLocal                 | tests/onboarding/runner/preflight.ts:34:23                     | error    |
| assignToLayers                  | src/lib/analytics/insight-engine.ts:151:17                     | error    |
| determineHook                   | src/lib/analytics/insight-engine.ts:269:17                     | error    |
| ChatContext                     | src/components/chat/ChatProvider.tsx:45:14                     | error    |
| makeKey                         | src/lib/upload/duplicate-detector.ts:32:17                     | error    |
| resolveUserCurrency             | src/lib/analytics/insight-engine.ts:35:17                      | error    |
| FolderMetric                    | src/components/data/FolderCard.tsx:55:17                       | error    |
| personaIds                      | tests/onboarding/personas/index.ts:26:17                       | error    |
| MetricTile                      | src/components/data/MetricTile.tsx:11:17                       | error    |
| FolderCard                      | src/components/data/FolderCard.tsx:14:17                       | error    |
| default                         | src/components/brand/CFOAvatar.tsx:47:16                       | error    |
| parseAmount                     | src/lib/parsers/universal-csv.ts:216:17                        | error    |
| parseDate                       | src/lib/parsers/universal-csv.ts:247:17                        | error    |
| predictValueCategory            | src/lib/prediction/predictor.ts:153:23                         | error    |
| traitSchema                     | src/lib/ai/portrait-extraction.ts:8:14                         | error    |
| validateNarrative               | src/lib/ai/insight-validator.ts:47:17                          | error    |
| parseLooseNumber                | src/lib/parsers/holdings-csv.ts:25:17                          | error    |
| extractMerchants                | src/lib/ai/insight-validator.ts:23:17                          | error    |
| STRUGGLE_LABELS                 | src/lib/onboarding-v2/labels.ts:10:14                          | error    |
| isRefundRow                     | src/lib/analytics/categories.ts:33:17                          | error    |
| buildFirstInsightContext        | src/lib/ai/context-builder.ts:183:17                           | error    |
| isMappingHighConfidence         | src/lib/csv/column-detector.ts:50:17                           | error    |
| NEUTRAL_CATEGORY_IDS            | src/lib/analytics/categories.ts:5:14                           | error    |
| detectColumnMapping             | src/lib/csv/column-detector.ts:31:17                           | error    |
| buildQuotableFacts              | src/lib/ai/context-builder.ts:121:17                           | error    |
| ONBOARDING_BEATS                | src/lib/onboarding/types.ts:15:14                              | error    |
| FolderMetric                    | src/components/data/index.ts:3:22                              | error    |
| MetricTile                      | src/components/data/index.ts:1:10                              | error    |
| FolderCard                      | src/components/data/index.ts:3:10                              | error    |
| Constants                       | src/lib/supabase/types.ts:2667:14                              | error    |
| ValuePill                       | src/components/data/index.ts:2:10                              | error    |
| FileRow                         | src/components/data/index.ts:10:3                              | error    |
| estimateCostUSD                 | src/lib/ai/usage-logger.ts:17:17                               | error    |
| CategoryBar                     | src/components/data/index.ts:6:3                               | error    |
| PRIORITY_ORDER                  | src/lib/nudges/rules.ts:198:14                                 | error    |
| NUDGE_LABELS                    | src/lib/nudges/rules.ts:185:14                                 | error    |
| NUDGE_ICONS                     | src/lib/nudges/rules.ts:172:14                                 | error    |
| opusModelId                     | src/lib/ai/provider.ts:15:14                                   | error    |
| opusModel                       | src/lib/ai/provider.ts:31:14                                   | error    |
| chatModelId                     | src/lib/ai/provider.ts:9:14                                    | error    |
| fonts                           | src/lib/tokens.ts:60:14                                        | error    |
| colors                          | src/lib/tokens.ts:6:14                                         | error    |

## Unused exported types (49)

| Name                        | Location                                       | Severity |
| :-------------------------- | :--------------------------------------------- | :------- |
| ValueDistribution           | src/lib/analytics/value-shift-detector.ts:5:18 | error    |
| ConfirmedSingleAssetImport  | src/lib/upload/balance-sheet-import.ts:40:13   | error    |
| ConfirmedLiabilityImport    | src/lib/upload/balance-sheet-import.ts:54:13   | error    |
| ConfirmedHoldingsImport     | src/lib/upload/balance-sheet-import.ts:30:13   | error    |
| StructuredInputConfig       | src/lib/profiling/question-registry.ts:16:13   | error    |
| ImportSummary               | src/lib/upload/balance-sheet-import.ts:76:13   | error    |
| SelectOption                | src/lib/profiling/question-registry.ts:11:13   | error    |
| RetakeCandidateStats        | src/lib/value-map/retake-candidates.ts:9:13    | error    |
| CategoryTier                | src/lib/value-map/retake-candidates.ts:7:13    | error    |
| InputType                   | src/lib/profiling/question-registry.ts:3:13    | error    |
| PersonalityData             | src/components/demo/demo-reveal.tsx:20:18      | error    |
| PersonaExpectations         | tests/onboarding/personas/types.ts:37:18       | error    |
| PersonaProfile              | tests/onboarding/personas/types.ts:20:18       | error    |
| ValueMapResult              | tests/onboarding/personas/types.ts:79:15       | error    |
| PersonaCsv                  | tests/onboarding/personas/types.ts:29:18       | error    |
| GapAnalysisSummary          | src/lib/analytics/gap-analyser.ts:36:18        | error    |
| RecurringExpense            | src/lib/analytics/insight-types.ts:8:13        | error    |
| MonthlySnapshot             | src/lib/analytics/insight-types.ts:7:13        | error    |
| ValueMapSession             | src/lib/analytics/insight-types.ts:9:13        | error    |
| BillExtraction              | src/lib/parsers/bill-extractor.ts:30:18        | error    |
| GapSeverity                 | src/lib/analytics/gap-analyser.ts:12:13        | error    |
| CategoryGap                 | src/lib/analytics/gap-analyser.ts:14:18        | error    |
| Transaction                 | src/lib/analytics/insight-types.ts:6:13        | error    |
| ValidateOptions             | src/lib/ai/insight-validator.ts:38:13          | error    |
| FixedOpenerKey              | src/lib/onboarding-v2/openers.ts:9:13          | error    |
| CreateActionItemAction      | src/lib/onboarding-v2/types.ts:10:13           | error    |
| MessageAction               | src/lib/onboarding-v2/types.ts:12:13           | error    |
| OnboardingAction            | src/lib/onboarding/types.ts:87:13              | error    |
| OnboardingState             | src/lib/onboarding/types.ts:77:18              | error    |
| CompositeTypes              | src/lib/supabase/types.ts:2650:13              | error    |
| TablesInsert                | src/lib/supabase/types.ts:2583:13              | error    |
| TablesUpdate                | src/lib/supabase/types.ts:2608:13              | error    |
| ButtonProps                 | src/components/ui/button.tsx:6:18              | error    |
| BeatMessage                 | src/lib/onboarding/types.ts:28:18              | error    |
| Tables                      | src/lib/supabase/types.ts:2554:13              | error    |
| Enums                       | src/lib/supabase/types.ts:2633:13              | error    |
| FirstInsightResult          | src/lib/onboarding/types.ts:8:18               | error    |
| ValueRuleMatchType          | src/lib/parsers/types.ts:130:13                | error    |
| FormatTemplateColumnMapping | src/lib/parsers/types.ts:49:13                 | error    |
| CreateActionItemAuditEntry  | src/lib/ai/audit-trail.ts:4:13                 | error    |
| StartValueMapAuditEntry     | src/lib/ai/audit-trail.ts:6:13                 | error    |
| NormalisedTransaction       | src/lib/parsers/types.ts:82:13                 | error    |
| StatementMetadata           | src/lib/parsers/types.ts:86:13                 | error    |
| ActionAuditEntry            | src/lib/ai/audit-trail.ts:7:13                 | error    |
| Json                        | src/lib/supabase/types.ts:1:13                 | error    |
| ParsedTransactionSource     | src/lib/parsers/types.ts:6:13                  | error    |
| NudgeFrequency              | src/lib/nudges/rules.ts:13:13                  | error    |
| AlertSeverity               | src/lib/alerts/notify.ts:1:13                  | error    |
| NudgePriority               | src/lib/nudges/rules.ts:14:13                  | error    |

## Duplicate exports (17)

| Name                             | Location                                                | Severity |
| :------------------------------- | :------------------------------------------------------ | :------- |
| ScenariosDashboard|default       | src/components/office/dashboards/ScenariosDashboard.tsx | error    |
| CashFlowDashboard|default        | src/components/office/dashboards/CashFlowDashboard.tsx  | error    |
| NetWorthDashboard|default        | src/components/office/dashboards/NetWorthDashboard.tsx  | error    |
| ValuesDashboard|default          | src/components/office/dashboards/ValuesDashboard.tsx    | error    |
| ScenariosSection|default         | src/components/office/sections/ScenariosSection.tsx     | error    |
| CashFlowSection|default          | src/components/office/sections/CashFlowSection.tsx      | error    |
| NetWorthSection|default          | src/components/office/sections/NetWorthSection.tsx      | error    |
| DetailHeader|default             | src/components/office/dashboards/DetailHeader.tsx       | error    |
| DrillDownRow|default             | src/components/office/dashboards/DrillDownRow.tsx       | error    |
| ValuesSection|default            | src/components/office/sections/ValuesSection.tsx        | error    |
| Briefing|default                 | src/components/office/dashboards/Briefing.tsx           | error    |
| normaliseMerchant|getMerchantKey | src/lib/categorisation/normalise-merchant.ts            | error    |
| OfficeHomeClient|default         | src/app/(office)/office/OfficeHomeClient.tsx            | error    |
| NavigationBar|default            | src/components/navigation/NavigationBar.tsx             | error    |
| UserAvatarMenu|default           | src/components/office/UserAvatarMenu.tsx                | error    |
| FolderSection|default            | src/components/office/FolderSection.tsx                 | error    |
| CFOAvatar|default                | src/components/brand/CFOAvatar.tsx                      | error    |

