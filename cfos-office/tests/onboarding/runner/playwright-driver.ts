import { chromium, type Browser, type Page } from 'playwright'
import path from 'node:path'
import type { Persona } from '../personas/types'
import type { OnboardingStage, AgeBand } from '../personas/types'
import type { TestUser } from './user-factory'
import type { CapturedStage } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { struggleToFamily, type DoorFamily } from '@/lib/onboarding-v2/door/door-config'

export interface DriverOptions {
  baseUrl: string
  outputDir: string
  headless?: boolean
  /**
   * Admin Supabase client used to poll for the Read assistant messages in the
   * estimate-read conversation. The estimate Read and the reality-check Read are
   * both delivered via streaming-free pre-written messages; polling the messages
   * table is more robust than scraping the DOM mid-render.
   */
  admin: SupabaseClient
}

export interface DriverResult {
  stages: CapturedStage[]
  /** The estimate Read — 1st assistant message on the first_read conversation. */
  capturedEstimateRead: unknown | null
  /** The reality-check Read — 2nd assistant message (statement-check personas). */
  capturedRealityCheck: unknown | null
  consoleErrors: string[]
  stagesCompleted: OnboardingStage[]
  errors: string[]
}

export async function runPersonaInBrowser(
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
): Promise<DriverResult> {
  const result: DriverResult = {
    stages: [],
    capturedEstimateRead: null,
    capturedRealityCheck: null,
    consoleErrors: [],
    stagesCompleted: [],
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

    await signIn(page, opts.baseUrl, user, opts.outputDir)
    await runOnboarding(page, persona, user, opts, result)

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

  // Wait for the form to be interactive. Hydration race: the login page is a
  // client component, and submitting before React has wired up the onChange
  // handlers leaves the controlled inputs empty even after page.fill().
  const emailInput = page.locator('input[type="email"]')
  const passwordInput = page.locator('input[type="password"]')
  const submitBtn = page.locator('button[type="submit"]:has-text("Sign in")')
  await emailInput.waitFor({ state: 'visible', timeout: 10_000 })
  await passwordInput.waitFor({ state: 'visible', timeout: 10_000 })
  await submitBtn.waitFor({ state: 'visible', timeout: 10_000 })

  // Type instead of fill — fill() blasts the value via native setter and
  // dispatches a single 'input' event, which can race with React 19's
  // synchronous setState batching on controlled inputs.
  await emailInput.click()
  await emailInput.fill('')
  await emailInput.type(user.email, { delay: 5 })
  await passwordInput.click()
  await passwordInput.fill('')
  await passwordInput.type(user.password, { delay: 5 })

  for (let attempt = 0; attempt < 2; attempt++) {
    const emailVal = await emailInput.inputValue()
    const passwordVal = await passwordInput.inputValue()
    if (emailVal === user.email && passwordVal === user.password) break
    if (attempt === 1) {
      throw new Error(
        `Sign-in form did not accept credentials. email="${emailVal}" expected="${user.email}"`,
      )
    }
    await emailInput.fill(user.email)
    await passwordInput.fill(user.password)
  }

  await submitBtn.click()

  // Two outcomes after the click:
  //  - Sign-in OK → router.push('/chat') → 308 → /office (or /onboarding-v2).
  //  - Sign-in FAIL → inline error div (the only element with BOTH
  //    bg-destructive/10 AND text-destructive classes).
  const successUrlRe = /\/(onboarding-v2|office|chat)\b/
  const errorSelector = 'div.bg-destructive\\/10.text-destructive'

  const outcome = await Promise.race([
    page
      .waitForURL(successUrlRe, { timeout: 30_000 })
      .then(() => ({ kind: 'success' as const })),
    (async () => {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('div.bg-destructive\\/10.text-destructive')
          return el !== null && (el.textContent ?? '').trim().length > 0
        },
        undefined,
        { timeout: 30_000 },
      )
      const errText = await page
        .locator(errorSelector)
        .first()
        .textContent()
        .catch(() => null)
      return { kind: 'login-error' as const, message: (errText ?? '').trim() }
    })(),
  ]).catch(() => ({ kind: 'timeout' as const }))

  if (outcome.kind === 'login-error') {
    try {
      await page.screenshot({ path: `${outputDir}/_error-at-signin.png`, fullPage: true })
    } catch {}
    throw new Error(`Sign-in failed: ${outcome.message || '(no message)'}`)
  }
  if (outcome.kind === 'timeout') {
    try {
      await page.screenshot({ path: `${outputDir}/_error-at-signin.png`, fullPage: true })
    } catch {}
    const currentUrl = page.url()
    const pageText = await page.textContent('body').catch(() => '')
    throw new Error(
      `Sign-in redirect timed out. URL: ${currentUrl}. Page text: ${(pageText ?? '').slice(0, 300)}`,
    )
  }

  // Fresh users land at /office; the chat sheet auto-opens on the door beat
  // (needsEstimateOnboarding). If we didn't get there automatically, go there.
  if (!page.url().includes('/office')) {
    await page.goto(`${baseUrl}/office`, { waitUntil: 'domcontentloaded' })
  }
}

// ── Walk dispatch (estimates-first, in-sheet beats at /office) ───────────────
//
// The whole onboarding runs inside the chat sheet at /office, advancing by
// onboarding_step (EstimateBeatHost for the estimate beats; OnboardingBeatHost
// for the optional statement-check mission) via router.refresh() — there are no
// URL changes between beats, so each stage waits on the next beat's in-sheet
// testid. No statement is uploaded before the estimate Read; the band sketch is
// the input. There is no goal fast-forward — the estimate goal beat is a normal
// in-sheet beat (goal-continue), and the goal row is written by the beat itself.

async function runOnboarding(
  page: Page,
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  // 1. Door beat — name + situation. The sheet auto-opens on the door beat.
  await page.waitForSelector('[data-testid="door-name-input"]', { timeout: 30_000 })
  await driveStage(page, 'door_done', opts, result, async () => {
    await driveDoor(page, persona)
    await page.waitForSelector('[data-testid="context-continue"]', { timeout: 30_000 })
  })

  // 2. Context beat — country + age band.
  await driveStage(page, 'context_done', opts, result, async () => {
    await driveContext(page, persona)
    await page.waitForSelector('[data-testid="composite-continue"]', { timeout: 30_000 })
  })

  // 3. Composite beat — relate reaction (+ optional re-pick / truer line).
  await driveStage(page, 'composite_done', opts, result, async () => {
    await driveComposite(page, persona)
    await page.waitForSelector('[data-testid="goal-continue"]', { timeout: 30_000 })
  })

  // 4. Goal beat — deadline (+ optional alt-goal). The beat writes the goal row.
  await driveStage(page, 'goal_done', opts, result, async () => {
    await driveGoal(page, persona)
    await page.waitForSelector('[data-testid="income-input"]', { timeout: 30_000 })
  })

  // 5. Income beat — one number, then the deterministic pace preview.
  await driveStage(page, 'income_done', opts, result, async () => {
    await driveIncome(page, persona)
    await page.waitForSelector('[data-testid="sketch-continue"]', { timeout: 30_000 })
  })

  // 6. Sketch beat — five band taps (each progressively saved server-side).
  await driveStage(page, 'sketch_done', opts, result, async () => {
    await driveSketch(page, persona)
    await page.waitForSelector('[data-testid="verdicts-continue"]', { timeout: 30_000 })
  })

  // 7. Verdicts beat — top value + three domain verdicts → estimate Read composes.
  await driveStage(page, 'verdicts_done', opts, result, async () => {
    await driveVerdicts(page, persona)
  })

  // 8. Estimate Read — composed + delivered into the sheet (1st assistant msg).
  //    Poll the messages table (more robust than scraping the stream).
  await driveStage(page, 'estimate_read', opts, result, async () => {
    const read = await pollNthAssistantMessage(opts.admin, user.id, 1, 150_000, 'first_read')
    if (read) result.capturedEstimateRead = read
    else throw new Error('estimate Read (1st assistant message) did not arrive within 150s')
    // first_read_delivered stamps onboarding_completed_at (the completion gate).
    // Proceed on timeout so a genuine regression surfaces as the DB-snapshot
    // assertion failure, not a driver crash.
    await pollOnboardingComplete(opts.admin, user.id, 30_000)
  })

  // 9. Optional statement-check mission — the accuracy pass that turns the
  //    sketch into the real picture. Only for personas that opt in.
  if (persona.expectations.runStatementCheck) {
    await runStatementCheck(page, persona, user, opts, result)
  }
}

// ── Estimate beat drivers ─────────────────────────────────────────────────

/** Effective door family: explicit override, else the legacy struggle reverse-map. */
function familyOf(persona: Persona): DoorFamily {
  return (
    persona.expectations.doorFamily ??
    struggleToFamily(persona.expectations.entryStruggle) ??
    'growth'
  )
}

// ASCII-safe AgeBand keys → the live en-dash testid suffixes (context-age-…).
const EN_DASH = '–'
const AGE_BAND_TESTID: Record<AgeBand, string> = {
  '18-29': `18${EN_DASH}29`,
  '30-39': `30${EN_DASH}39`,
  '40-49': `40${EN_DASH}49`,
  '50+': '50 or over',
}

async function clickTestId(page: Page, testId: string, timeout = 30_000): Promise<void> {
  // Playwright auto-waits for the element to be visible AND enabled before
  // clicking — so this also gates on a beat's "Continue" becoming enabled.
  await page.locator(`[data-testid="${testId}"]`).click({ timeout })
}

async function typeInto(page: Page, testId: string, value: string): Promise<void> {
  const el = page.locator(`[data-testid="${testId}"]`)
  await el.click()
  await el.fill('')
  await el.type(value, { delay: 5 })
}

async function driveDoor(page: Page, persona: Persona): Promise<void> {
  // Drive the door via its situation CHIP (deterministic; the free-text path is
  // LLM-classified and intentionally not exercised by the harness). The chip
  // maps from the persona's family (door_family ?? struggleToFamily).
  const family = familyOf(persona)
  await typeInto(page, 'door-name-input', persona.profile.displayName)
  await clickTestId(page, `door-chip-${family}`) // selects the situation
  await clickTestId(page, 'door-continue') // commits the chip → reflection phase
  await clickTestId(page, 'door-reflection-continue') // → estimate_context
}

async function driveContext(page: Page, persona: Persona): Promise<void> {
  await clickTestId(page, `context-country-${persona.profile.country}`)
  await clickTestId(page, `context-age-${AGE_BAND_TESTID[persona.expectations.ageBand]}`)
  await clickTestId(page, 'context-continue')
}

async function driveComposite(page: Page, persona: Persona): Promise<void> {
  const { compositeRelate, compositeRepickFamily, compositeTruerLine } = persona.expectations
  await clickTestId(page, `composite-relate-${compositeRelate}`)
  if (compositeRelate === 'not_me') {
    if (!compositeRepickFamily) {
      throw new Error(`Persona ${persona.id}: compositeRelate is 'not_me' but no compositeRepickFamily set`)
    }
    await clickTestId(page, `composite-repick-${compositeRepickFamily}`)
  }
  // The truer-line input shows for 'close' / 'not_me' only.
  if (compositeTruerLine && (compositeRelate === 'close' || compositeRelate === 'not_me')) {
    await typeInto(page, 'composite-truer-line', compositeTruerLine)
  }
  await clickTestId(page, 'composite-continue')
}

async function driveGoal(page: Page, persona: Persona): Promise<void> {
  const { goalDeadline, goalAltFamily } = persona.expectations
  if (goalAltFamily) {
    await clickTestId(page, 'goal-show-alts')
    await clickTestId(page, `goal-alt-${goalAltFamily}`)
  }
  await clickTestId(page, `goal-deadline-${goalDeadline}`)
  await clickTestId(page, 'goal-continue')
}

async function driveIncome(page: Page, persona: Persona): Promise<void> {
  const income = persona.profile.monthlyIncome ?? 3000
  await typeInto(page, 'income-input', String(income))
  await clickTestId(page, 'income-continue') // → deterministic pace preview
  await clickTestId(page, 'income-pace-continue') // → estimate_sketch
}

async function driveSketch(page: Page, persona: Persona): Promise<void> {
  const b = persona.expectations.sketchBands
  const taps: [string, string][] = [
    ['housing', b.housing],
    ['subs', b.subs],
    ['bills', b.bills],
    ['foodOut', b.foodOut],
    ['saveReach', b.saveReach],
  ]
  for (const [key, id] of taps) {
    await clickTestId(page, `sketch-${key}-${id}`)
  }
  // sketch-continue enables only once all five progressive saves confirm
  // server-side; the click auto-waits for that. Generous timeout for the saves.
  await clickTestId(page, 'sketch-continue', 60_000)
}

async function driveVerdicts(page: Page, persona: Persona): Promise<void> {
  const { topValue, verdicts } = persona.expectations
  await clickTestId(page, `verdict-value-${topValue}`)
  await clickTestId(page, `verdict-subscriptions-${verdicts.subscriptions}`)
  await clickTestId(page, `verdict-foodOut-${verdicts.foodOut}`)
  await clickTestId(page, `verdict-drift-${verdicts.drift}`)
  await clickTestId(page, 'verdicts-continue') // → estimate_read_pending → compose
}

// ── Statement-check mission (the optional accuracy pass) ─────────────────────

async function runStatementCheck(
  page: Page,
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  if (!persona.csv) {
    throw new Error(`Persona ${persona.id}: runStatementCheck is true but no CSV to upload`)
  }
  const csv = persona.csv

  // 9a. Opt into the mission from the estimate Read's CTA, then upload the real
  //     statement. The check-mode processing beat auto-advances to the confirm.
  await driveStage(page, 'check_upload_done', opts, result, async () => {
    // The estimate Read renders in the message list with the statement-check
    // CTA button (StatementCheckActionButton). Wait for it, then opt in.
    await page
      .locator('button:has-text("Check my numbers against a real month")')
      .click({ timeout: 60_000 })

    // advanceStep('check_upload_pending') → refresh → UploadBeatBlock mode=check
    // (no goal-bridge intro — straight to the upload control).
    await page.waitForSelector('input[type="file"]', { timeout: 30_000, state: 'attached' })
    const csvBuf = Buffer.from(csv.contentBase64, 'base64')
    await page.setInputFiles('input[type="file"]', [
      {
        name: csv.filename,
        mimeType: csv.filename.endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        buffer: csvBuf,
      },
    ])

    // Upload → import → check_processing (auto-advances ~3.2s) → confirm beat.
    // The confirm button reads "Looks right — check it against my sketch".
    await page.waitForSelector('button:has-text("Looks right")', { timeout: 120_000 })
  })

  // 9b. Confirm the real fixed costs → the host composes the reality-check Read.
  await driveStage(page, 'check_confirm_done', opts, result, async () => {
    await page.locator('button:has-text("Looks right")').first().click({ timeout: 30_000 })
    // confirmFixedCosts({mode:'check'}) → check_confirm_done → reality-check Read.
  })

  // 9c. Reality-check Read — appended to the SAME first_read conversation as a
  //     2nd assistant message. Poll for it, then confirm the mission terminal.
  await driveStage(page, 'reality_check', opts, result, async () => {
    const read = await pollNthAssistantMessage(opts.admin, user.id, 2, 150_000, 'first_read')
    if (read) result.capturedRealityCheck = read
    else throw new Error('reality-check Read (2nd assistant message) did not arrive within 150s')
    // reality_check_delivered records the mission outcome (the user is already
    // complete). Proceed on timeout — a regression surfaces in the DB snapshot.
    await pollStep(opts.admin, user.id, 'reality_check_delivered', 30_000)
  })
}

// ── Stage helper ────────────────────────────────────────────────────────────

async function driveStage(
  page: Page,
  stage: OnboardingStage,
  opts: DriverOptions,
  result: DriverResult,
  body: () => Promise<void>,
): Promise<void> {
  const shotPath = path.join(opts.outputDir, `${stage}.png`)
  const record: CapturedStage = { stage, screenshotPath: null, networkResponses: [] }
  try {
    await body()
    try {
      await page.screenshot({ path: shotPath, fullPage: false })
      record.screenshotPath = shotPath
    } catch {}
    result.stages.push(record)
    result.stagesCompleted.push(stage)
  } catch (e) {
    result.errors.push(`Stage ${stage} failed: ${String(e instanceof Error ? e.message : e)}`)
    try {
      const errShot = path.join(opts.outputDir, `_error-at-${stage}.png`)
      await page.screenshot({ path: errShot, fullPage: true })
    } catch {}
    throw e
  }
}

// ── DB-driven chat capture ─────────────────────────────────────────────────

/**
 * Poll until onboarding_completed_at is stamped (advanceStep runs a beat after
 * the estimate Read message lands). Returns true when stamped, false on timeout.
 * Does NOT throw — a genuine regression surfaces as the DB-snapshot assertion.
 */
async function pollOnboardingComplete(admin: SupabaseClient, userId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { data } = await admin
      .from('user_profiles')
      .select('onboarding_completed_at, onboarding_step')
      .eq('id', userId)
      .maybeSingle()
    if (data?.onboarding_completed_at || data?.onboarding_step === 'first_read_delivered') return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

/** Poll until onboarding_step reaches the given value. Returns true / false on timeout. */
async function pollStep(admin: SupabaseClient, userId: string, step: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { data } = await admin
      .from('user_profiles')
      .select('onboarding_step')
      .eq('id', userId)
      .maybeSingle()
    if (data?.onboarding_step === step) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

/**
 * Poll the messages table for the Nth assistant message (1-indexed, ascending by
 * created_at) on the user's most-recent conversation of the given type. The
 * estimate Read is the 1st assistant message on the first_read conversation; the
 * reality-check Read is appended to that SAME conversation as the 2nd. Returns
 * the message wrapper or null on timeout.
 */
async function pollNthAssistantMessage(
  admin: SupabaseClient,
  userId: string,
  n: number,
  timeoutMs: number,
  conversationType: string,
): Promise<unknown | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { data: conv } = await admin
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('type', conversationType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (conv?.id) {
      const { data: msgs } = await admin
        .from('messages')
        .select('id, content, role, created_at')
        .eq('conversation_id', conv.id)
        .eq('role', 'assistant')
        .order('created_at', { ascending: true })

      if (msgs && msgs.length >= n && msgs[n - 1]?.content) {
        return { conversationType, content: msgs[n - 1].content, messageId: msgs[n - 1].id }
      }
    }

    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}
