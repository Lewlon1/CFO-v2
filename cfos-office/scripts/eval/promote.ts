#!/usr/bin/env tsx
// Promote: replace the active champion with a candidate, with confirmation.
//
//   npx tsx scripts/eval/promote.ts <candidate-filename> [--yes]
//
// The candidate is moved out of eval/judges/candidates/ into eval/judges/
// directly, the previous champion is moved to eval/judges/archive/, and the
// CHAMPION pointer is updated. The candidate's judgeId is also normalised
// (cand-foo → 2026-05-17-foo or similar timestamped form).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { basename, join, resolve } from 'node:path'

import {
  championPointerPath,
  judgesDir,
  readChampionFilename,
  loadJudge,
  loadChampion,
} from './_lib/judge-runner'

const ARGV = process.argv.slice(2)
const YES = ARGV.includes('--yes')
const positional = ARGV.filter((a) => !a.startsWith('--'))
if (positional.length === 0) {
  console.error('Usage: npx tsx scripts/eval/promote.ts <candidate-filename> [--yes]')
  console.error('Example: npx tsx scripts/eval/promote.ts cand-merchant-time-signal.ts')
  console.error('  (looks first in eval/judges/candidates/, then eval/judges/)')
  process.exit(1)
}

const candidateName = positional[0]

function reportsDir(): string {
  return resolve(__dirname, '..', '..', 'eval', 'reports')
}

function resolveCandidatePath(name: string): string {
  // Try candidates/ first, then root judges/.
  const a = join(judgesDir(), 'candidates', name)
  if (existsSync(a)) return a
  const b = join(judgesDir(), name)
  if (existsSync(b)) return b
  throw new Error(
    `promote: candidate not found. Looked in:\n  ${a}\n  ${b}`,
  )
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  // Load champion (for diff context + archive move)
  const champion = await loadChampion()
  const championFilename = readChampionFilename()
  const championPath = join(judgesDir(), championFilename)
  if (!existsSync(championPath)) {
    throw new Error(`promote: champion file ${championPath} missing`)
  }

  // Load candidate
  const candidatePath = resolveCandidatePath(candidateName)
  const candidate = await loadJudge(candidatePath.replace(judgesDir() + '/', ''))
  console.log(`Promoting: ${candidate.judgeId}`)
  console.log(`Replaces:  ${champion.judgeId}`)
  console.log('')

  // Show a diff hint — just the buildPrompt body delta
  console.log('Diff preview (champion → candidate, prompt-body excerpt):')
  console.log('─'.repeat(72))
  showDiffSummary(championPath, candidatePath)
  console.log('─'.repeat(72))
  console.log('')

  if (!YES) {
    const rl = createInterface({ input: stdin, output: stdout })
    try {
      const ans = (await rl.question('Confirm promotion? [y/N] ')).trim().toLowerCase()
      if (ans !== 'y' && ans !== 'yes') {
        console.log('Aborted. No changes made.')
        process.exit(0)
      }
    } finally {
      rl.close()
    }
  }

  // Execute the promotion atomically-ish:
  //   1. Archive current champion
  //   2. Move candidate into eval/judges/ (out of candidates/ if applicable)
  //   3. Update CHAMPION pointer

  // 1. Archive
  const archiveDir = join(judgesDir(), 'archive')
  mkdirSync(archiveDir, { recursive: true })
  const archivedPath = join(archiveDir, championFilename)
  renameSync(championPath, archivedPath)
  console.log(`Archived: ${archivedPath.replace(judgesDir() + '/', '')}`)

  // 2. Move candidate. New filename: <date>-<id>.ts where id is candidate.judgeId
  // stripped of "cand-" prefix.
  const idClean = candidate.judgeId.replace(/^cand-/, '')
  const newFilename = `${dateStamp()}-${idClean}.ts`
  const newPath = join(judgesDir(), newFilename)
  if (existsSync(newPath)) {
    throw new Error(`promote: destination ${newPath} already exists — bailing to avoid overwrite.`)
  }
  // Read, rewrite judgeId to drop cand- prefix, then write at new path; remove old.
  const candidateSource = readFileSync(candidatePath, 'utf-8')
  const promotedSource = candidateSource.replace(
    /export\s+const\s+judgeId\s*=\s*['"][^'"]*['"]/,
    `export const judgeId = '${idClean}'`,
  )
  writeFileSync(newPath, promotedSource, 'utf-8')
  // Remove the candidate file from candidates/ (or wherever it was)
  // Use rename to a junk path then unlink — simpler: just unlink.
  const { unlinkSync } = require('node:fs')
  unlinkSync(candidatePath)
  console.log(`Wrote:    eval/judges/${newFilename}`)

  // 3. Update CHAMPION pointer
  const pointerContent = readFileSync(championPointerPath(), 'utf-8')
  const newPointerLines: string[] = []
  let replaced = false
  for (const line of pointerContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      newPointerLines.push(line)
      continue
    }
    if (!replaced) {
      newPointerLines.push(newFilename)
      replaced = true
    }
    // Drop any subsequent non-comment lines (the pointer is one-line)
  }
  if (!replaced) newPointerLines.push(newFilename)
  writeFileSync(championPointerPath(), newPointerLines.join('\n') + '\n', 'utf-8')
  console.log(`CHAMPION: ${newFilename}`)

  // 4. Write promote report
  mkdirSync(reportsDir(), { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(reportsDir(), `${ts}-promote.md`)
  const reportMd = [
    `# Promote — ${candidate.judgeId} → ${idClean}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `## Change`,
    '',
    `- Previous champion: \`${championFilename}\` → archived to \`archive/${championFilename}\``,
    `- New champion: \`${newFilename}\``,
    `- CHAMPION pointer updated`,
    '',
    `## Approval`,
    '',
    YES ? '`--yes` flag passed; no interactive confirmation.' : 'Confirmed interactively.',
  ].join('\n')
  writeFileSync(reportPath, reportMd, 'utf-8')
  console.log(`\nReport: ${reportPath}`)
}

// ── Diff helper ──────────────────────────────────────────────────────────────
// Find the first ~3000 chars of the buildPrompt template literal in each
// file and show a one-line summary diff. A full diff is overkill — Lewis can
// open the two files in his editor if he wants more.

function extractPromptExcerpt(source: string): string {
  const m = source.match(/return\s+`([\s\S]{0,3000})/)
  if (!m) return '(no buildPrompt template found)'
  return m[1].split('\n').slice(0, 8).join('\n') + '\n…'
}

function showDiffSummary(championPath: string, candidatePath: string): void {
  const champ = readFileSync(championPath, 'utf-8')
  const cand = readFileSync(candidatePath, 'utf-8')
  console.log('CHAMPION buildPrompt opens with:')
  console.log(extractPromptExcerpt(champ))
  console.log('')
  console.log('CANDIDATE buildPrompt opens with:')
  console.log(extractPromptExcerpt(cand))
  console.log('')
  console.log(`(For a full diff, run:  diff -u "${basename(championPath)}" "${basename(candidatePath)}")`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
