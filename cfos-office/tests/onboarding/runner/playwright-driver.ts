import { chromium, type Browser, type Page } from 'playwright'
import path from 'node:path'
import type { Persona, PersonaValueMapResponse } from '../personas/types'
import type { TestUser } from './user-factory'
import type { CapturedBeat } from './types'

const BEAT_ORDER = [
  'welcome',
  'framework',
  'value_map',
  'archetype',
  'csv_upload',
  'capabilities',
  'first_insight',
  'handoff',
] as const

export interface DriverOptions {
  baseUrl: string
  outputDir: string
  headless?: boolean
}

export interface DriverResult {
  beats: CapturedBeat[]
  capturedArchetype: unknown | null
  capturedInsight: unknown | null
  consoleErrors: string[]
  beatsCompleted: string[]
  beatsSkipped: string[]
  errors: string[]
}

export async function runPersonaInBrowser(
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
): Promise<DriverResult> {
  const result: DriverResult = {
    beats: [],
    capturedArchetype: null,
    capturedInsight: null,
    consoleErrors: [],
    beatsCompleted: [],
    beatsSkipped: [],
    errors: [],
  }

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: opts.headless !== false })
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    })

    const page = await context.newPage()

    page.on('console', (msg) => {
      if (msg.type() === 'error') result.consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      result.consoleErrors.push(`PageError: ${err.message}`)
    })

    // Capture API responses from the onboarding endpoints
    page.on('response', async (res) => {
      const url = res.url()
      try {
        if (url.includes('/api/onboarding/generate-archetype')) {
          result.capturedArchetype = await res.json()
        } else if (url.includes('/api/onboarding/generate-insight')) {
          result.capturedInsight = await res.json()
        }
      } catch {
        // Ignore non-JSON or in-flight parse errors
      }
    })

    await signIn(page, opts.baseUrl, user, opts.outputDir)
    await runOnboarding(page, persona, opts, result)

    await context.close()
  } catch (e) {
    result.errors.push(`Driver crashed: ${String(e instanceof Error ? e.stack ?? e.message : e)}`)
  } finally {
    if (browser) await browser.close()
  }

  return result
}

// ── Sign in ─────────────────────────────────────────────────────────────────

async function signIn(page: Page, baseUrl: string, user: TestUser, outputDir: string): Promise<void> {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', user.email)
  await page.fill('input[type="password"]', user.password)

  await page.click('button[type="submit"]:has-text("Sign in")')

  try {
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 20_000 })
  } catch (e) {
    // Capture the login page state for diagnosis — likely an error banner
    try {
      await page.screenshot({ path: `${outputDir}/_error-at-signin.png`, fullPage: true })
    } catch {}
    const pageText = await page.textContent('body').catch(() => '')
    throw new Error(`Sign-in redirect timed out. Page text snippet: ${(pageText ?? '').slice(0, 500)}`)
  }

  // Navigate explicitly to /office to ensure the onboarding modal mounts
  if (!page.url().includes('/office')) {
    await page.goto(`${baseUrl}/office`, { waitUntil: 'domcontentloaded' })
  }
}

// ── Onboarding walkthrough ──────────────────────────────────────────────────

async function runOnboarding(
  page: Page,
  persona: Persona,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  // Wait for the onboarding modal header ("First Meeting")
  await page.waitForSelector('text=/First Meeting/i', { timeout: 30_000 })

  for (const beat of BEAT_ORDER) {
    // Auto-skipped beats (by reducer) — don't attempt to drive
    if (persona.expectations.beatsSkipped.includes(beat)) {
      result.beatsSkipped.push(beat)
      continue
    }

    try {
      await driveBeat(page, beat, persona, opts, result)
      result.beatsCompleted.push(beat)
    } catch (e) {
      result.errors.push(`Beat ${beat} failed: ${String(e instanceof Error ? e.message : e)}`)
      try {
        const errShot = path.join(opts.outputDir, `_error-at-${beat}.png`)
        await page.screenshot({ path: errShot, fullPage: true })
      } catch {}
      break
    }
  }
}

async function driveBeat(
  page: Page,
  beat: string,
  persona: Persona,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  const shot = path.join(opts.outputDir, `${beat}.png`)
  const beatRecord: CapturedBeat = { beat, screenshotPath: null, networkResponses: [] }

  switch (beat) {
    case 'welcome': {
      // Auto-advances through 3 text messages then shows "Let's go"
      await page.waitForSelector("button:has-text(\"Let's go\")", { timeout: 30_000 })
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      await page.click("button:has-text(\"Let's go\")")
      break
    }

    case 'framework': {
      await page.waitForSelector("button:has-text(\"Let's do it\")", { timeout: 30_000 })
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      await page.click("button:has-text(\"Let's do it\")")
      break
    }

    case 'value_map': {
      // Value Map has an intro screen with "I'm ready" or similar; click through
      await waitForValueMapActive(page)
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot

      if (persona.skipBeats.includes('value_map')) {
        // Tap "Skip for now"
        await clickAnyOf(page, [
          'button:has-text("Skip for now")',
          'button:has-text("Skip")',
        ])
        break
      }

      if (!persona.valueMapResponses) {
        throw new Error('Persona has no valueMapResponses but is not configured to skip value_map')
      }

      for (const response of persona.valueMapResponses) {
        await tapValueMapCard(page, response)
      }

      // After the 10th card, ValueMapFlow auto-fires onComplete → reducer
      // advances to `archetype` beat. No button click needed.
      break
    }

    case 'archetype': {
      // Wait for archetype card to finish loading (up to 45s for LLM)
      await page.waitForSelector('text=/archetype|You see|You spend|Your money|You keep/i', { timeout: 50_000 })
      // Dwell time enforced by the app (MIN_ARCHETYPE_DWELL_MS = 20000).
      // The "Upload" button should eventually appear.
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      await page.waitForSelector('button:has-text("Upload")', { timeout: 45_000 })
      await clickAnyOf(page, [
        'button:has-text("Upload a statement")',
        'button:has-text("Upload")',
      ])
      break
    }

    case 'csv_upload': {
      // Wait for the upload UI to render — either a file input or the skip button
      await page.waitForSelector('input[type="file"], button:has-text("do this later"), button:has-text("Skip")', { timeout: 30_000, state: 'attached' })
      // Extra time for the embed reveal animation
      await page.waitForTimeout(800)

      if (persona.skipBeats.includes('csv_upload') || !persona.csv) {
        await page.screenshot({ path: shot, fullPage: false })
        beatRecord.screenshotPath = shot
        await clickAnyOf(page, [
          'button:has-text("do this later")',
          'button:has-text("Skip")',
          'button:has-text("Not now")',
          'button:has-text("Maybe later")',
        ])
        break
      }

      // Attach CSV via file input
      const csvBuf = Buffer.from(persona.csv.contentBase64, 'base64')
      await page.setInputFiles('input[type="file"]', [{
        name: persona.csv.filename,
        mimeType: persona.csv.filename.endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        buffer: csvBuf,
      }])
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot

      // Wait for the beat to advance — capabilities copy appears
      await page.waitForSelector('text=/brought you to the office|focus on first/i', { timeout: 60_000 })
      break
    }

    case 'capabilities': {
      // Wait for the capability picker to render (not just the preceding text message)
      await page.waitForSelector('button:has-text("Where my money")', { timeout: 30_000 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot

      // Pick the first 2 capability options
      const capabilityLabels = ['Where my money', 'Understanding my', 'Tracking what', 'Planning big']
      let tappedCount = 0
      for (const label of capabilityLabels) {
        if (tappedCount >= 2) break
        const btn = page.locator(`button:has-text("${label}")`).first()
        if (await btn.count() > 0) {
          try {
            await btn.click({ timeout: 3000 })
            tappedCount++
            await page.waitForTimeout(200)
          } catch {}
        }
      }

      // Continue appears only after ≥1 selection
      await clickAnyOf(page, [
        'button:has-text("Continue")',
        'button:has-text("Done")',
        'button:has-text("Next")',
      ])
      break
    }

    case 'first_insight': {
      // Insight narration can take up to 70s. We detect completion by the
      // rating scale appearing ("Does it resonate?" + 5 emoji buttons).
      try {
        await page.waitForSelector('button[aria-label="Impressive"]', { timeout: 70_000 })
      } catch {
        await page.screenshot({ path: shot, fullPage: false })
        beatRecord.screenshotPath = shot
        throw new Error('first_insight never rendered rating UI — likely no CSV data or insight generation stuck (possible product bug: reducer fails to skip first_insight when csv_upload is skipped mid-session)')
      }

      await page.waitForTimeout(1000)
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot

      // Pick "Impressive" (4/5).
      await page.click('button[aria-label="Impressive"]')
      // Rating triggers handleInsightRate → completeBeat after 600ms delay.
      break
    }

    case 'handoff': {
      await page.waitForSelector('button:has-text("Enter the Office")', { timeout: 30_000 })
      await page.screenshot({ path: shot, fullPage: false })
      beatRecord.screenshotPath = shot
      await clickAnyOf(page, ['button:has-text("Enter the Office")'])
      await page.waitForURL(/\/office/, { timeout: 15_000 })
      // Allow the refresh/navigation to complete
      await page.waitForTimeout(1000)
      break
    }
  }

  result.beats.push(beatRecord)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function clickAnyOf(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if (await loc.count() > 0) {
      try {
        await loc.click({ timeout: 5000 })
        return
      } catch {
        // Try the next
      }
    }
  }
  throw new Error(`None of selectors clickable: ${selectors.join(' | ')}`)
}

async function waitForValueMapActive(page: Page): Promise<void> {
  // The Value Map shows an intro screen first with a "Let's start" button.
  for (let attempt = 0; attempt < 4; attempt++) {
    const hasCard = await page.locator('text=/How do you feel about this spend/i').count()
    if (hasCard > 0) return

    const introBtn = page.locator([
      'button:has-text("Let\'s start")',
      'button:has-text("start")',
      'button:has-text("Start")',
      'button:has-text("Begin")',
      'button:has-text("I\'m ready")',
    ].join(', ')).first()
    if (await introBtn.count() > 0) {
      try {
        await introBtn.click({ timeout: 3000 })
      } catch {}
    }
    await page.waitForTimeout(1500)
  }

  await page.waitForSelector('text=/How do you feel about this spend/i', { timeout: 15_000 })
}

async function tapValueMapCard(page: Page, response: PersonaValueMapResponse): Promise<void> {
  // Wait for the quadrant question to appear for the current card
  await page.waitForSelector('text=/How do you feel about this spend/i', { timeout: 15_000 })

  // There's a 1.5s gate before buttons become tappable — wait it out
  await page.waitForTimeout(1700)

  if (response.hardToDecide || response.quadrant === null) {
    // "Unsure" button is visible alongside the quadrants once the 1.5s gate clears
    await page.waitForSelector('button:has-text("Unsure")', { timeout: 8_000 })
    await page.click('button:has-text("Unsure")')
  } else {
    const quadrantLabel = response.quadrant.charAt(0).toUpperCase() + response.quadrant.slice(1)
    // Quadrant buttons contain the label as text
    await page.click(`button:has-text("${quadrantLabel}")`)

    // Confidence: use aria-labelled dot matching the desired value
    await page.waitForSelector('button[aria-label*="Confidence"]', { timeout: 5000 })
    const confidenceBtn = page.locator(`button[aria-label="Confidence ${response.confidence} of 5"]`).first()
    if (await confidenceBtn.count() > 0) {
      await confidenceBtn.click()
    }

    // Confirm
    await page.click('button:has-text("Next")')
  }

  // Card transition + feedback — wait for next card or summary
  await page.waitForTimeout(500)
}
