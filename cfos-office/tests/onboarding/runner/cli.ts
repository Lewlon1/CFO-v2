// Side-effect import: loads .env.local BEFORE any other module so that
// @/lib/ai/provider (imported transitively below) sees the AWS_REGION env var.
import './_load-env'

import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { parseArgs } from './args'
import { checkStagingGuard, checkRequiredEnv } from './preflight'
import { ensureDevServer } from './dev-server'
import { runPersona } from './persona-runner'
import { writeReports, printCliSummary } from './reporter'
import { PERSONAS, getPersona } from '../personas'
import { deleteAllTestUsers, makeAdminClient } from './user-factory'
import type { PersonaRunResult, SuiteRunResult, RunContext } from './types'

const STAGING_PROJECT_REF = 'qlbhvlssksnrhsleadzn'

async function runUnitTests(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['vitest', 'run', 'tests/onboarding/unit'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    proc.on('exit', (code) => resolve(code === 0))
  })
}

async function runInBatches<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // Preflight
  checkRequiredEnv(process.env)
  checkStagingGuard(process.env.NEXT_PUBLIC_SUPABASE_URL!)

  // Resolve personas
  const toRun = args.personas === null
    ? [...PERSONAS]
    : args.personas.map((id) => {
        const p = getPersona(id)
        if (!p) throw new Error(`Unknown persona: ${id}. Available: ${PERSONAS.map((x) => x.id).join(', ')}`)
        return p
      })

  // Unit tests
  if (!args.noUnit) {
    console.log('Running unit tests…')
    const ok = await runUnitTests()
    if (!ok) {
      console.error('Unit tests failed — aborting.')
      process.exit(1)
    }
  }

  // Dev server
  console.log('Ensuring dev server…')
  const server = await ensureDevServer()
  console.log(`Dev server at ${server.url}${server.spawned ? ' (spawned)' : ' (existing)'}`)

  const runId = args.runId ?? new Date().toISOString().replace(/[:.]/g, '-')
  const outputDir = path.resolve(process.cwd(), 'tests/onboarding/test-output', runId)
  await mkdir(outputDir, { recursive: true })

  const ctx: RunContext = {
    runId,
    outputDir,
    skipJudge: args.skipJudge,
    keepUsers: args.keepUsers,
    devServerUrl: server.url,
  }

  const startedAt = new Date().toISOString()
  const startTs = Date.now()

  let personaResults: PersonaRunResult[] = []
  try {
    console.log(`Running ${toRun.length} persona(s), concurrency ${args.concurrency}…`)
    personaResults = await runInBatches(toRun, args.concurrency, (p) => runPersona(p, ctx))
  } finally {
    if (server.spawned) {
      console.log('Stopping spawned dev server…')
      await server.stop()
    }
    if (!args.keepUsers) {
      try {
        const admin = makeAdminClient()
        const n = await deleteAllTestUsers(admin, runId)
        if (n > 0) console.log(`Cleaned up ${n} orphaned test user(s).`)
      } catch (e) {
        console.error('Cleanup failed (not fatal):', String(e))
      }
    }
  }

  const finishedAt = new Date().toISOString()
  const durationMs = Date.now() - startTs

  const hasFailures = personaResults.some((p) =>
    p.layers.functional === 'fail' || p.layers.llm === 'fail' || p.layers.visual === 'fail'
  )

  const suite: SuiteRunResult = {
    runId,
    startedAt,
    finishedAt,
    durationMs,
    argsUsed: { ...args },
    stagingProjectRef: STAGING_PROJECT_REF,
    personas: personaResults,
    unitTestsPassed: true,
    overallExitCode: hasFailures ? 1 : 0,
  }

  await writeReports(suite, outputDir)
  printCliSummary(suite, outputDir)
  process.exit(suite.overallExitCode)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
