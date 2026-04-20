import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SuiteRunResult, PersonaRunResult, LayerStatus } from './types'

function badge(status: LayerStatus): string {
  if (status === 'pass') return '<span class="b pass">pass</span>'
  if (status === 'fail') return '<span class="b fail">fail</span>'
  return '<span class="b skip">skip</span>'
}

function statusCell(status: LayerStatus): string {
  if (status === 'pass') return 'PASS'
  if (status === 'fail') return 'FAIL'
  return 'skip'
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 100) / 10
  return `${s}s`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function personaSection(p: PersonaRunResult, outputRoot: string): string {
  const imgs = p.beats
    .filter((b) => b.screenshotPath)
    .map((b) => {
      const rel = path.relative(outputRoot, b.screenshotPath!)
      return `<figure><img src="${escapeHtml(rel)}" alt="${escapeHtml(b.beat)}"><figcaption>${escapeHtml(b.beat)}</figcaption></figure>`
    })
    .join('')

  const hardRules = [
    ...(p.judge.archetype?.hardRules ?? []).map((r) => ({ ...r, type: 'archetype' })),
    ...(p.judge.insight?.hardRules ?? []).map((r) => ({ ...r, type: 'insight' })),
  ]
  const hardRulesHtml = hardRules.map((r) =>
    `<li class="${r.passed ? 'pass' : 'fail'}">[${r.type}] ${escapeHtml(r.ruleId)}${r.detail ? ` — ${escapeHtml(r.detail)}` : ''}</li>`
  ).join('')

  const likertRows = Object.entries(p.likertMeans)
    .map(([dim, score]) => `<tr><td>${escapeHtml(dim)}</td><td>${score.toFixed(1)}</td></tr>`).join('')

  const likertDetails: string[] = []
  for (const [type, j] of Object.entries(p.judge)) {
    if (!j) continue
    for (const l of j.likert) {
      likertDetails.push(`<li><strong>[${type}] ${escapeHtml(l.dimension)}:</strong> ${l.score}/5 — ${escapeHtml(l.reason)}</li>`)
    }
  }

  const funcErrorsHtml = p.functionalErrors.length
    ? `<details><summary>Functional errors (${p.functionalErrors.length})</summary><pre>${escapeHtml(p.functionalErrors.join('\n'))}</pre></details>`
    : ''

  const consoleHtml = p.consoleErrors.length
    ? `<details><summary>Console errors (${p.consoleErrors.length})</summary><pre>${escapeHtml(p.consoleErrors.join('\n'))}</pre></details>`
    : ''

  return `
<section class="persona">
  <header>
    <h2>${escapeHtml(p.label)} <code>${escapeHtml(p.personaId)}</code></h2>
    <div class="layers">
      Functional: ${badge(p.layers.functional)}
      LLM: ${badge(p.layers.llm)}
      Visual: ${badge(p.layers.visual)}
      <span class="duration">${fmtDuration(p.durationMs)}</span>
    </div>
  </header>
  ${p.error ? `<div class="error">Fatal: ${escapeHtml(p.error)}</div>` : ''}
  <h3>Screenshots</h3>
  <div class="gallery">${imgs || '<p>No screenshots captured</p>'}</div>
  <h3>LLM judge</h3>
  <h4>Hard rules</h4>
  <ul class="rules">${hardRulesHtml || '<li>None (no judge run)</li>'}</ul>
  <h4>Likert means</h4>
  <table><thead><tr><th>Dimension</th><th>Score (1-5)</th></tr></thead><tbody>${likertRows || '<tr><td colspan="2">—</td></tr>'}</tbody></table>
  ${likertDetails.length ? `<details><summary>Per-dimension reasons</summary><ul>${likertDetails.join('')}</ul></details>` : ''}
  <h3>Captured</h3>
  <details><summary>Archetype JSON</summary><pre>${escapeHtml(JSON.stringify(p.captured.archetype ?? null, null, 2))}</pre></details>
  <details><summary>Insight JSON</summary><pre>${escapeHtml(JSON.stringify(p.captured.insight ?? null, null, 2))}</pre></details>
  <details><summary>DB state after handoff</summary><pre>${escapeHtml(JSON.stringify(p.dbState ?? null, null, 2))}</pre></details>
  ${funcErrorsHtml}
  ${consoleHtml}
</section>`
}

const CSS = `
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; background: #0e1117; color: #e8e9ed; }
h1, h2, h3, h4 { color: #fefefe; }
h1 { margin-top: 0; }
h2 { border-bottom: 1px solid #2a2e37; padding-bottom: 8px; }
.summary-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
.summary-table th, .summary-table td { padding: 8px 12px; border-bottom: 1px solid #2a2e37; text-align: left; }
.summary-table th { color: #9aa0a6; font-weight: 600; font-size: 12px; text-transform: uppercase; }
.b { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px; }
.b.pass { background: #22543d; color: #68d391; }
.b.fail { background: #742a2a; color: #fc8181; }
.b.skip { background: #2d3748; color: #a0aec0; }
.persona { background: #1a1e27; padding: 20px; border-radius: 8px; margin-bottom: 24px; }
.persona header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
.persona .duration { color: #9aa0a6; font-size: 14px; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin: 12px 0; }
.gallery figure { margin: 0; }
.gallery img { width: 100%; border: 1px solid #2a2e37; border-radius: 4px; cursor: pointer; }
.gallery figcaption { font-size: 12px; color: #9aa0a6; text-align: center; margin-top: 4px; font-family: monospace; }
pre { background: #0e1117; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; }
details { margin: 8px 0; }
summary { cursor: pointer; color: #90cdf4; }
.rules { padding-left: 20px; }
.rules li { font-family: monospace; font-size: 12px; padding: 2px 0; }
.rules li.pass { color: #68d391; }
.rules li.fail { color: #fc8181; }
.error { background: #742a2a; color: #fed7d7; padding: 10px; border-radius: 4px; margin: 10px 0; }
table { border-collapse: collapse; }
table th, table td { padding: 4px 12px; border-bottom: 1px solid #2a2e37; }
`

export async function writeReports(suite: SuiteRunResult, outputDir: string): Promise<void> {
  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(suite, null, 2))

  const rows = suite.personas.map((p) => `
    <tr>
      <td><code>${escapeHtml(p.personaId)}</code></td>
      <td>${escapeHtml(p.label)}</td>
      <td>${badge(p.layers.functional)}</td>
      <td>${badge(p.layers.llm)}</td>
      <td>${badge(p.layers.visual)}</td>
      <td>${fmtDuration(p.durationMs)}</td>
    </tr>`).join('')

  const likertGlobal = aggregateLikert(suite.personas)
  const likertHtml = Object.entries(likertGlobal).map(([k, v]) => `<strong>${escapeHtml(k)}:</strong> ${v.toFixed(1)}`).join(' · ')

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Onboarding suite — ${escapeHtml(suite.runId)}</title>
  <style>${CSS}</style>
</head>
<body>
<h1>Onboarding Test Suite — ${escapeHtml(suite.runId)}</h1>
<p><strong>Project:</strong> ${escapeHtml(suite.stagingProjectRef)} · <strong>Duration:</strong> ${fmtDuration(suite.durationMs)} · <strong>Exit:</strong> ${suite.overallExitCode}</p>
<table class="summary-table">
  <thead><tr><th>Persona</th><th>Label</th><th>Functional</th><th>LLM</th><th>Visual</th><th>Duration</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p>Likert means: ${likertHtml || '—'}</p>
${suite.personas.map((p) => personaSection(p, outputDir)).join('')}
</body>
</html>`

  await writeFile(path.join(outputDir, 'report.html'), html)
}

function aggregateLikert(personas: PersonaRunResult[]): Record<string, number> {
  const sums: Record<string, { total: number; n: number }> = {}
  for (const p of personas) {
    for (const [dim, score] of Object.entries(p.likertMeans)) {
      if (!sums[dim]) sums[dim] = { total: 0, n: 0 }
      sums[dim].total += score
      sums[dim].n += 1
    }
  }
  const out: Record<string, number> = {}
  for (const [dim, v] of Object.entries(sums)) {
    out[dim] = Math.round((v.total / v.n) * 10) / 10
  }
  return out
}

export function printCliSummary(suite: SuiteRunResult, outputDir: string): void {
  const lines: string[] = []
  lines.push(`\nOnboarding Test Suite — ${suite.runId}`)
  lines.push('-'.repeat(72))
  lines.push(`Preflight:       ${suite.unitTestsPassed ? 'PASS' : 'FAIL'} (unit tests)`)
  lines.push('-'.repeat(72))
  lines.push('Persona'.padEnd(32) + 'Functional  LLM    Visual   Time')
  lines.push('-'.repeat(72))

  for (const p of suite.personas) {
    const row = [
      p.personaId.padEnd(32),
      statusCell(p.layers.functional).padEnd(12),
      statusCell(p.layers.llm).padEnd(7),
      statusCell(p.layers.visual).padEnd(9),
      fmtDuration(p.durationMs),
    ].join('')
    let extra = ''
    if (p.hardRuleFailures.length > 0) extra = `  <- ${p.hardRuleFailures[0].slice(0, 80)}`
    else if (p.functionalErrors.length > 0) extra = `  <- ${p.functionalErrors[0].slice(0, 80)}`
    lines.push(row + extra)
  }

  lines.push('-'.repeat(72))
  const likert = aggregateLikert(suite.personas)
  if (Object.keys(likert).length > 0) {
    lines.push('Likert means: ' + Object.entries(likert).map(([k, v]) => `${k}=${v.toFixed(1)}`).join('  '))
  }
  lines.push('-'.repeat(72))
  lines.push(`Report: file://${path.resolve(outputDir, 'report.html')}`)
  lines.push(`Exit: ${suite.overallExitCode}\n`)

  console.log(lines.join('\n'))
}
