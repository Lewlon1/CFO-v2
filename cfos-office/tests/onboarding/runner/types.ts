import type { OnboardingStage } from '../personas/types'

export type LayerStatus = 'pass' | 'fail' | 'skip'

export interface HardRuleResult {
  ruleId: string
  passed: boolean
  detail?: string
}

export interface LikertResult {
  dimension: string
  score: number
  reason: string
}

/** Which Read a JudgeOutput grades — the estimate Read (always composed) or the
 *  reality-check Read (statement-check personas only). */
export type ReadKind = 'estimate_read' | 'reality_check_read'

export interface JudgeOutput {
  outputType: ReadKind
  modelId: string
  timestamp: string
  hardRules: HardRuleResult[]
  likert: LikertResult[]
  raw: unknown
}

/**
 * A single milestone the driver hit during a persona walk. The screenshot
 * file (if captured) is named after the stage; the network responses block
 * is reserved for future use — currently empty.
 */
export interface CapturedStage {
  stage: OnboardingStage
  screenshotPath: string | null
  networkResponses: {
    path: string
    status: number
    response: unknown
  }[]
}

export interface DbStateSnapshot {
  user_profiles: Record<string, unknown> | null
  financial_portrait: Record<string, unknown>[] | null
  onboarding_progress: Record<string, unknown> | null
  /** The estimates-first sketch + verification row (bands, verdicts, derived, verification). */
  onboarding_estimates: Record<string, unknown> | null
  transactionCount: number
  /** Content of every assistant message for the user — checked for leaked QA notes (fix #2). */
  assistantMessageContents: string[]
  /** recurring_expenses names for the user — checked for case-variant dupes (fix #3). */
  recurringNames: string[]
  /** Number of goals for the user — the estimate goal beat creates exactly one. */
  goalsCount: number
}

export interface PersonaRunResult {
  personaId: string
  label: string
  startedAt: string
  finishedAt: string
  durationMs: number
  layers: {
    functional: LayerStatus
    llm: LayerStatus
    visual: LayerStatus
  }
  stagesCompleted: OnboardingStage[]
  functionalErrors: string[]
  dbState: DbStateSnapshot | null
  stages: CapturedStage[]
  consoleErrors: string[]
  captured: {
    estimateRead?: unknown
    realityCheckRead?: unknown
  }
  judge: {
    estimateRead?: JudgeOutput
    realityCheckRead?: JudgeOutput
  }
  hardRuleFailures: string[]
  likertMeans: Record<string, number>
  error?: string
}

export interface SuiteRunResult {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  argsUsed: Record<string, unknown>
  stagingProjectRef: string
  personas: PersonaRunResult[]
  unitTestsPassed: boolean
  overallExitCode: 0 | 1
}

export interface RunContext {
  runId: string
  outputDir: string
  skipJudge: boolean
  keepUsers: boolean
  devServerUrl: string
}
