import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { makeAdminClient, createTestUser, deleteTestUser } from './user-factory'
import { runPersonaInBrowser } from './playwright-driver'
import { snapshotDbState, assertDbState } from './db-assertions'
import { summariseCsv } from './csv-summariser'
import { judgeOutput } from './judge'
import type { Persona } from '../personas/types'
import type { PersonaRunResult, RunContext } from './types'

export async function runPersona(
  persona: Persona,
  ctx: RunContext,
): Promise<PersonaRunResult> {
  const startedAt = new Date().toISOString()
  const startTs = Date.now()
  const admin = makeAdminClient()
  const personaOutputDir = path.join(ctx.outputDir, persona.id)
  await mkdir(path.join(personaOutputDir, 'captured'), { recursive: true })

  const result: PersonaRunResult = {
    personaId: persona.id,
    label: persona.label,
    startedAt,
    finishedAt: '',
    durationMs: 0,
    layers: { functional: 'skip', llm: 'skip', visual: 'skip' },
    stagesCompleted: [],
    functionalErrors: [],
    dbState: null,
    stages: [],
    consoleErrors: [],
    captured: {},
    judge: {},
    hardRuleFailures: [],
    likertMeans: {},
  }

  let user: Awaited<ReturnType<typeof createTestUser>> | null = null

  try {
    user = await createTestUser(admin, persona.id, ctx.runId)

    const driverOut = await runPersonaInBrowser(persona, user, {
      baseUrl: ctx.devServerUrl,
      outputDir: personaOutputDir,
      admin,
    })
    result.stages = driverOut.stages
    result.stagesCompleted = driverOut.stagesCompleted
    result.consoleErrors = driverOut.consoleErrors
    result.functionalErrors.push(...driverOut.errors)
    if (driverOut.capturedEstimateRead !== null) result.captured.estimateRead = driverOut.capturedEstimateRead
    if (driverOut.capturedRealityCheck !== null) result.captured.realityCheckRead = driverOut.capturedRealityCheck

    // DB assertions
    const snap = await snapshotDbState(admin, user.id)
    result.dbState = snap
    const dbErrs = assertDbState(persona, snap)
    result.functionalErrors.push(...dbErrs)

    await writeFile(
      path.join(personaOutputDir, 'captured', 'estimate-read.json'),
      JSON.stringify(driverOut.capturedEstimateRead ?? null, null, 2),
    )
    await writeFile(
      path.join(personaOutputDir, 'captured', 'reality-check.json'),
      JSON.stringify(driverOut.capturedRealityCheck ?? null, null, 2),
    )
    await writeFile(
      path.join(personaOutputDir, 'captured', 'db-state-after-handoff.json'),
      JSON.stringify(snap, null, 2),
    )
    if (result.consoleErrors.length) {
      await writeFile(
        path.join(personaOutputDir, 'console-errors.log'),
        result.consoleErrors.join('\n'),
      )
    }

    // Functional + Visual layer status
    const stagesMatch = persona.expectations.stagesCompleted.every((s) =>
      result.stagesCompleted.includes(s),
    )
    result.layers.functional = (stagesMatch && result.functionalErrors.length === 0) ? 'pass' : 'fail'
    result.layers.visual = result.stages.filter((s) => s.screenshotPath).length > 0 ? 'pass' : 'fail'

    // LLM judge layer
    if (!ctx.skipJudge && persona.expectations.likertDimensions.length > 0) {
      // The estimate Read predates any upload, so it is judged WITHOUT a CSV
      // (its figures are honest ≈ band sketches). The reality-check Read is
      // judged against the uploaded statement's summary so R4 can catch a
      // hallucinated figure.
      const csvSummary = persona.csv
        ? summariseCsv(Buffer.from(persona.csv.contentBase64, 'base64').toString('utf-8'), persona.profile.currency)
        : null

      if (result.captured.estimateRead) {
        const j = await judgeOutput(persona, 'estimate_read', result.captured.estimateRead, null)
        result.judge.estimateRead = j
        await writeFile(path.join(personaOutputDir, 'captured', 'judge-estimate-read.json'), JSON.stringify(j, null, 2))
      }
      if (result.captured.realityCheckRead) {
        const j = await judgeOutput(persona, 'reality_check_read', result.captured.realityCheckRead, csvSummary)
        result.judge.realityCheckRead = j
        await writeFile(path.join(personaOutputDir, 'captured', 'judge-reality-check.json'), JSON.stringify(j, null, 2))
      }

      const allHardRules = [
        ...(result.judge.estimateRead?.hardRules ?? []),
        ...(result.judge.realityCheckRead?.hardRules ?? []),
      ]
      const failures = allHardRules.filter((r) => !r.passed)
      result.hardRuleFailures = failures.map((f) => `${f.ruleId}${f.detail ? ' — ' + f.detail : ''}`)

      const likertSums: Record<string, { total: number; n: number }> = {}
      for (const j of [result.judge.estimateRead, result.judge.realityCheckRead]) {
        if (!j) continue
        for (const l of j.likert) {
          if (!likertSums[l.dimension]) likertSums[l.dimension] = { total: 0, n: 0 }
          likertSums[l.dimension].total += l.score
          likertSums[l.dimension].n += 1
        }
      }
      for (const [dim, v] of Object.entries(likertSums)) {
        result.likertMeans[dim] = Math.round((v.total / v.n) * 10) / 10
      }

      if (result.judge.estimateRead || result.judge.realityCheckRead) {
        result.layers.llm = failures.length === 0 ? 'pass' : 'fail'
      } else {
        result.layers.llm = 'fail'
        result.hardRuleFailures.push('No LLM outputs captured (flow never produced an estimate Read)')
      }
    } else {
      result.layers.llm = 'skip'
    }
  } catch (e) {
    result.error = `Persona runner crashed: ${String(e instanceof Error ? e.stack ?? e.message : e)}`
    result.layers.functional = 'fail'
  } finally {
    if (user && !ctx.keepUsers) {
      await deleteTestUser(admin, user.id)
    }
  }

  result.finishedAt = new Date().toISOString()
  result.durationMs = Date.now() - startTs
  return result
}
