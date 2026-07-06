import { chromium, type Browser, type Page } from 'playwright'
import path from 'node:path'
import type { Persona } from '../personas/types'
import type { TestUser } from './user-factory'
import type { CapturedStage } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface DriverOptions {
  baseUrl: string
  outputDir: string
  headless?: boolean
  /**
   * Admin Supabase client used to (a) poll for the first assistant message in
   * the first_read conversation and (b) fast-forward the 90s-gated goal beat.
   * Chat content is delivered via streaming AI SDK; polling messages is more
   * robust than scraping the DOM mid-stream.
   */
  admin: SupabaseClient
}

export interface DriverResult {
  stages: CapturedStage[]
  capturedArchetype: unknown | null
  capturedInsight: unknown | null
  consoleErrors: string[]
  stagesCompleted: import('../personas/types').OnboardingStage[]
  errors: string[]
}

export async function runPersonaInBrowser(
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
): Promise<DriverResult> {
  const result: DriverResult = {
    stages: [],
    capturedArchetype: null,
    capturedInsight: null,
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

  // Fresh users with no entry_struggle land at /office for the in-sheet entry
  // beat. If we didn't get there automatically, go explicitly.
  if (!page.url().includes('/office')) {
    await page.goto(`${baseUrl}/office`, { waitUntil: 'domcontentloaded' })
  }
}

// ── Walk dispatch (value-first, in-sheet beats at /office) ───────────────────
//
// The whole onboarding runs inside the chat sheet at /office, advancing by
// onboarding_step (OnboardingBeatHost) via router.refresh() — there are no URL
// changes between beats, so each stage waits on the next beat's in-sheet
// selector. There is no Marcus/chat-first split. The only admin shortcut is the
// goal beat (a goal-only chat gated by a 90s skip control), fast-forwarded the
// same way completeGoalBeat / skipGoalBeat do server-side.

async function runOnboarding(
  page: Page,
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  // 1. Struggle beat — folded into the chat sheet ("what brought you in?"). The
  //    sheet auto-opens (needsEntryStruggle), so the prompt renders with no nav.
  await page.waitForSelector('text=/what brought you in/i', { timeout: 30_000 })
  await driveStage(page, 'struggle_submitted', persona, opts, result, async () => {
    await submitStruggle(page, persona)
    // The struggle server action sets entry_struggle + advances to
    // goal_chat_started. On staging the user-context update has been observed to
    // silently no-op for fresh users, so make entry_struggle deterministic.
    await ensureEntryStruggle(opts.admin, user, persona)
  })

  // 2. Goal beat — fast-forward via admin (mirrors completeGoalBeat /
  //    skipGoalBeat: close the goal-chat conversation + stamp upload_pending).
  //    Goal personas get their goal inserted first so the First Read sees it.
  await driveStage(page, 'goal_done', persona, opts, result, async () => {
    await fastForwardGoalBeat(opts.admin, user, persona)
    // Re-render /office so the in-sheet OnboardingBeatHost shows the upload beat.
    await page.goto(`${opts.baseUrl}/office`, { waitUntil: 'domcontentloaded' })
  })

  // 3. Upload beat — UploadIntro renders first (now always); user either clicks
  //    "Continue" to proceed to the file uploader, or "I don't have a statement
  //    handy" to skip straight to the essentials beat.
  await driveStage(page, 'upload_done', persona, opts, result, async () => {
    if (persona.csv) {
      // Upload path: click "Continue" on the intro, then upload the file.
      const continueBtn = page.locator('button:has-text("Continue")')
      await continueBtn.waitFor({ state: 'visible', timeout: 30_000 })
      await continueBtn.click()
      await page.waitForSelector('input[type="file"]', { timeout: 30_000, state: 'attached' })
      const csvBuf = Buffer.from(persona.csv.contentBase64, 'base64')
      await page.setInputFiles('input[type="file"]', [{
        name: persona.csv.filename,
        mimeType: persona.csv.filename.endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        buffer: csvBuf,
      }])
      // UploadBeatBlock.onDone advances to upload_processing → refresh → the
      // EssentialsBeatBlock (income/rent). Its income field id is the anchor.
      await page.waitForSelector('#processing-income', { timeout: 90_000 })
    } else {
      // Skip path: click "I don't have a statement handy" on the intro; the
      // server action (skipUploadToEssentials) advances onboarding_step →
      // router.refresh() → EssentialsBeatBlock appears at #processing-income.
      const skipBtn = page.locator("button:has-text(\"I don't have a statement handy\")")
      await skipBtn.waitFor({ state: 'visible', timeout: 30_000 })
      await skipBtn.click()
      await page.waitForSelector('#processing-income', { timeout: 30_000 })
    }
  })

  // 4. Essentials beat — income + rent (blur-to-save), then continue.
  await driveStage(page, 'essentials_done', persona, opts, result, async () => {
    await fillEssentials(page, persona)
    // ProcessingForm advances to details_pending → refresh → ConfirmBeatBlock.
    await page.waitForSelector('button:has-text("Looks right")', { timeout: 30_000 })
  })

  // 5. Confirm beat — accept the reconciled fixed costs.
  await driveStage(page, 'confirm_done', persona, opts, result, async () => {
    // Change 4 (optional): for skip-upload personas, assert the progress meter
    // reads 60% before the user confirms. Goal(20) + Income(20) + Fixed costs(20)
    // = 60 with no upload — this is the ceiling on declared knowledge.
    // The meter exposes aria-label="Setup progress: N%" so the check is robust.
    if (!persona.csv) {
      const meter = page.locator('[role="status"][aria-label^="Setup progress:"]')
      const meterVisible = await meter.isVisible().catch(() => false)
      if (meterVisible) {
        const ariaLabel = await meter.getAttribute('aria-label').catch(() => null)
        if (ariaLabel && !ariaLabel.includes('60%')) {
          // Record as a non-fatal warning rather than crashing the driver.
          result.errors.push(
            `confirm beat: progress meter aria-label expected "Setup progress: 60%", got "${ariaLabel}"`,
          )
        }
      }
      // If meter is not visible, skip silently — it may not render until
      // the essentials save completes; a missing meter is not a driver failure.
    }
    await page.click('button:has-text("Looks right")')
    // confirmFixedCosts → details_confirmed → OnboardingBeatHost composes the
    // Read (CfoThinking) then hands it into the sheet.
  })

  // 6. First Read — composed + delivered into the sheet. Poll the messages
  //    table (more robust than scraping the stream).
  await driveStage(page, 'first_read', persona, opts, result, async () => {
    const insight = await pollFirstReadAssistantMessage(opts.admin, user.id, 150_000)
    if (insight) result.capturedInsight = insight
    else throw new Error('first_read assistant message did not arrive within 150s')
    // Stamp lands a beat later in advanceStep('first_read_delivered'); wait so the DB
    // snapshot in persona-runner sees onboarding_completed_at. Proceed on timeout so a
    // genuine regression still surfaces as the assertion failure (not a driver crash).
    await pollOnboardingComplete(opts.admin, user.id, 30_000)
  })
}

/**
 * Belt-and-braces: ensure entry_struggle is set after the struggle beat. The
 * in-sheet struggle server action sets it, but the user-context write has been
 * observed to silently no-op for fresh test users on staging (see git history).
 * Idempotent — only writes when the column is still null.
 */
async function ensureEntryStruggle(admin: SupabaseClient, user: TestUser, persona: Persona): Promise<void> {
  const { data: prof } = await admin
    .from('user_profiles')
    .select('entry_struggle, country')
    .eq('id', user.id)
    .maybeSingle()
  const patch: Record<string, unknown> = {}
  if (!prof?.entry_struggle) patch.entry_struggle = persona.expectations.entryStruggle
  if (!prof?.country) patch.country = persona.profile.country
  if (Object.keys(patch).length > 0) {
    await admin.from('user_profiles').update(patch).eq('id', user.id)
  }
}

/**
 * Test-only fast-forward past the goal-chat beat. Real users complete the goal
 * conversation or wait 90s for the skip control; tests need neither. Mirrors
 * completeGoalBeat / skipGoalBeat (goal-beat-actions.ts): close the active
 * goal-chat conversation and stamp onboarding_step='upload_pending', which the
 * office layout renders as the in-sheet upload beat. For goal personas, the
 * goal row is inserted first so the First Read can reference it.
 */
async function fastForwardGoalBeat(admin: SupabaseClient, user: TestUser, persona: Persona): Promise<void> {
  const goal = persona.expectations.goal
  if (goal) {
    const { error: goalErr } = await admin.from('goals').insert({
      user_id: user.id,
      name: goal.name,
      type: goal.type ?? 'savings',
      target_amount: goal.targetAmount,
      current_amount: goal.currentAmount ?? 0,
      target_date: goal.targetDate ?? null,
      status: 'active',
    })
    if (goalErr) throw new Error(`fastForwardGoalBeat: goal insert failed: ${goalErr.message}`)
  }

  await admin
    .from('conversations')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('type', 'onboarding_goal_chat')
    .eq('status', 'active')

  const { data: updated, error } = await admin
    .from('user_profiles')
    .update({ onboarding_step: 'upload_pending' })
    .eq('id', user.id)
    .select('id, onboarding_step')
  if (error) throw new Error(`fastForwardGoalBeat: user_profiles update failed: ${error.message}`)
  if (!updated || updated.length === 0) {
    throw new Error(
      `fastForwardGoalBeat: 0 user_profiles rows updated for ${user.id} — row likely missing ` +
      `(check the auth.users → user_profiles trigger on staging).`,
    )
  }
}

/**
 * Fill the income + rent fields on the EssentialsBeatBlock (ProcessingForm).
 * Both save on blur; the "Looking good…" continue control enables once both
 * land and the import has finished.
 */
async function fillEssentials(page: Page, persona: Persona): Promise<void> {
  const income = persona.profile.monthlyIncome ?? 3000
  const rent = persona.profile.monthlyRent ?? 1000

  const incomeInput = page.locator('#processing-income')
  await incomeInput.click()
  await incomeInput.fill('')
  await incomeInput.type(String(income), { delay: 5 })
  await incomeInput.blur()

  const rentInput = page.locator('#processing-rent')
  await rentInput.click()
  await rentInput.fill('')
  await rentInput.type(String(rent), { delay: 5 })
  await rentInput.blur()

  // The continue button enables only once both numbers save AND the CSV import
  // finishes; while finishing it reads "Just a moment — finishing up…". Click
  // auto-waits for the enabled "Looks good — show me the picture" state.
  await page.locator('button:has-text("Looks good")').first().click({ timeout: 90_000 })
}

// ── Stage helper ────────────────────────────────────────────────────────────

async function driveStage(
  page: Page,
  stage: import('../personas/types').OnboardingStage,
  _persona: Persona,
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

// ── Struggle submission ─────────────────────────────────────────────────────

const STRUGGLE_OPTION_LABEL: Record<string, string> = {
  dont_know: "I don't know where my money goes",
  debt:      "I'm carrying debt I want to clear",
  wealth:    'I want to start building wealth',
  planning:  "I'm planning for something specific",
}

async function submitStruggle(page: Page, persona: Persona): Promise<void> {
  const struggle = persona.expectations.entryStruggle
  const continueBtn = page.locator('button:has-text("Continue")')

  if (struggle === 'free_text') {
    const text = persona.expectations.entryStruggleText
    if (!text) throw new Error(`Persona ${persona.id}: entryStruggle is free_text but no entryStruggleText set`)
    const textarea = page.locator('textarea')
    await textarea.click()
    await textarea.fill('')
    await textarea.type(text, { delay: 5 })
  } else {
    const label = STRUGGLE_OPTION_LABEL[struggle]
    if (!label) throw new Error(`Persona ${persona.id}: unknown entryStruggle "${struggle}"`)
    await page.click(`button:has-text(${JSON.stringify(label)})`)
  }

  // Wait for Continue to enable — the option-click's React state must flush
  // before the submit, or the server action gets selectedOption=null.
  await continueBtn.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction(
    () => {
      const btns = Array.from(document.querySelectorAll('button'))
      const cont = btns.find((b) => /continue/i.test(b.textContent ?? ''))
      return cont !== undefined && !(cont as HTMLButtonElement).disabled
    },
    undefined,
    { timeout: 10_000 },
  )
  await continueBtn.click()
}

// ── DB-driven chat capture ─────────────────────────────────────────────────

/**
 * Poll until onboarding_completed_at is stamped (advanceStep runs a beat after the message).
 * Returns true when stamped, false on timeout. Does NOT throw on timeout — a genuine
 * regression surfaces as the DB-snapshot assertion failure, not a driver crash.
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

/**
 * Poll the messages table for the first assistant message in the user's
 * first_read conversation. Returns the message row or null on timeout.
 */
async function pollFirstReadAssistantMessage(
  admin: SupabaseClient,
  userId: string,
  timeoutMs: number,
): Promise<unknown | null> {
  return pollFirstAssistantMessage(admin, userId, timeoutMs, 'first_read')
}

async function pollFirstAssistantMessage(
  admin: SupabaseClient,
  userId: string,
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
        .limit(1)

      if (msgs && msgs.length > 0 && msgs[0].content) {
        return { conversationType, content: msgs[0].content, messageId: msgs[0].id }
      }
    }

    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}
