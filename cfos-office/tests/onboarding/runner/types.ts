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

export interface JudgeOutput {
  outputType: 'archetype' | 'insight'
  modelId: string
  timestamp: string
  hardRules: HardRuleResult[]
  likert: LikertResult[]
  raw: unknown
}

export interface CapturedBeat {
  beat: string
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
  transactionCount: number
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
  beatsCompleted: string[]
  beatsSkipped: string[]
  functionalErrors: string[]
  dbState: DbStateSnapshot | null
  beats: CapturedBeat[]
  consoleErrors: string[]
  captured: {
    archetype?: unknown
    insight?: unknown
  }
  judge: {
    archetype?: JudgeOutput
    insight?: JudgeOutput
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
