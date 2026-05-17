#!/usr/bin/env tsx
/**
 * Phase 7 — Session v2.2 Chat Intelligence eval harness.
 *
 * Thin wrapper around the persona runner CLI that adds a `--prompt-version
 * v1|v2` flag (default v1). Spawns
 *   npx tsx tests/onboarding/runner/cli.ts <forwarded args>
 * with CHAT_INTELLIGENCE_V2_FORCE=1 in the subprocess env when v2 is
 * requested, so the chat-intelligence-v2 feature flag returns true for
 * every user the runner touches.
 *
 * Usage:
 *
 *   npx tsx scripts/run-personas-v2.ts --prompt-version v1 [other args...]
 *   npx tsx scripts/run-personas-v2.ts --prompt-version v2 [other args...]
 *
 * Any args other than --prompt-version are forwarded verbatim to cli.ts,
 * so this is a drop-in replacement for invoking cli.ts directly.
 *
 * Why a wrapper rather than editing cli.ts directly: in this PR's working
 * environment the runner directory is read-denied, so safely editing
 * cli.ts in-place isn't possible. The wrapper is the cleanest minimal-
 * touch path. If you'd rather edit cli.ts directly, see
 * cfos-office/tests/onboarding/runner/prompt-version-flag.ts for the
 * import-at-the-top pattern.
 */

import { spawn } from 'child_process'
import { resolve } from 'path'

const ARGV = process.argv.slice(2)

type PromptVersion = 'v1' | 'v2'

function parsePromptVersion(args: string[]): { version: PromptVersion; forwarded: string[] } {
  const idx = args.indexOf('--prompt-version')
  if (idx === -1) return { version: 'v1', forwarded: args }
  const value = args[idx + 1]
  if (value !== 'v1' && value !== 'v2') {
    console.error(
      `--prompt-version expects "v1" or "v2", got "${value ?? '(missing)'}".`,
    )
    process.exit(1)
  }
  const forwarded = args.slice(0, idx).concat(args.slice(idx + 2))
  return { version: value, forwarded }
}

const { version, forwarded } = parsePromptVersion(ARGV)

const cliPath = resolve(__dirname, '..', 'tests', 'onboarding', 'runner', 'cli.ts')

const env: NodeJS.ProcessEnv = { ...process.env }
if (version === 'v2') {
  env.CHAT_INTELLIGENCE_V2_FORCE = '1'
} else {
  delete env.CHAT_INTELLIGENCE_V2_FORCE
}

console.log(
  `[run-personas-v2] prompt-version: ${version}` +
    (version === 'v2' ? ' (CHAT_INTELLIGENCE_V2_FORCE=1)' : '') +
    `, forwarding ${forwarded.length} arg(s) to cli.ts`,
)

// Spawn `npx tsx <cliPath> <forwarded>`. We use npx so this works whether
// or not tsx is on PATH globally, matching how the runner is invoked
// elsewhere in the project.
const child = spawn('npx', ['tsx', cliPath, ...forwarded], {
  stdio: 'inherit',
  env,
  // Run from the cfos-office root so any relative paths inside cli.ts
  // (e.g. config files, test-output) resolve as they would normally.
  cwd: resolve(__dirname, '..'),
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-personas-v2] cli.ts killed by signal ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 0)
})

child.on('error', err => {
  console.error('[run-personas-v2] failed to spawn cli.ts:', err)
  process.exit(1)
})
