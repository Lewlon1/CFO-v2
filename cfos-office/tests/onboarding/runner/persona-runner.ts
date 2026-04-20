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
    beatsCompleted: [],
    beatsSkipped: [],
    functionalErrors: [],
    dbState: null,
    beats: [],
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
    })
    result.beats = driverOut.beats
    result.beatsCompleted = driverOut.beatsCompleted
    result.beatsSkipped = driverOut.beatsSkipped
    result.consoleErrors = driverOut.consoleErrors
    result.functionalErrors.push(...driverOut.errors)
    if (driverOut.capturedArchetype !== null) result.captured.archetype = driverOut.capturedArchetype
    if (driverOut.capturedInsight !== null) result.captured.insight = driverOut.capturedInsight

    // DB assertions
    const snap = await snapshotDbState(admin, user.id)
    result.dbState = snap
    const dbErrs = assertDbState(persona, snap)
    result.functionalErrors.push(...dbErrs)

    await writeFile(
      path.join(personaOutputDir, 'captured', 'archetype.json'),
      JSON.stringify(driverOut.capturedArchetype ?? null, null, 2),
    )
    await writeFile(
      path.join(personaOutputDir, 'captured', 'insight.json'),
      JSON.stringify(driverOut.capturedInsight ?? null, null, 2),
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
    const beatsMatch = persona.expectations.beatsCompleted.every((b) => result.beatsCompleted.includes(b))
    result.layers.functional = (beatsMatch && result.functionalErrors.length === 0) ? 'pass' : 'fail'
    result.layers.visual = result.beats.filter((b) => b.screenshotPath).length > 0 ? 'pass' : 'fail'

    // LLM judge layer
    if (!ctx.skipJudge && persona.expectations.likertDimensions.length > 0) {
      const csvSummary = persona.csv
        ? summariseCsv(Buffer.from(persona.csv.contentBase64, 'base64').toString('utf-8'), persona.profile.currency)
        : null

      if (result.captured.archetype) {
        const j = await judgeOutput(persona, 'archetype', result.captured.archetype, csvSummary)
        result.judge.archetype = j
        await writeFile(path.join(personaOutputDir, 'captured', 'judge-archetype.json'), JSON.stringify(j, null, 2))
      }
      if (result.captured.insight) {
        const j = await judgeOutput(persona, 'insight', result.captured.insight, csvSummary)
        result.judge.insight = j
        await writeFile(path.join(personaOutputDir, 'captured', 'judge-insight.json'), JSON.stringify(j, null, 2))
      }

      const allHardRules = [
        ...(result.judge.archetype?.hardRules ?? []),
        ...(result.judge.insight?.hardRules ?? []),
      ]
      const failures = allHardRules.filter((r) => !r.passed)
      result.hardRuleFailures = failures.map((f) => `${f.ruleId}${f.detail ? ' — ' + f.detail : ''}`)

      const likertSums: Record<string, { total: number; n: number }> = {}
      for (const j of [result.judge.archetype, result.judge.insight]) {
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

      if (result.judge.archetype || result.judge.insight) {
        result.layers.llm = failures.length === 0 ? 'pass' : 'fail'
      } else {
        // No outputs captured — can't judge
        result.layers.llm = 'fail'
        result.hardRuleFailures.push('No LLM outputs captured (flow never produced archetype or insight)')
      }
    } else {
      result.layers.llm = persona.expectations.likertDimensions.length === 0 ? 'skip' : 'skip'
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
