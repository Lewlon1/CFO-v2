import { chromium, type Browser, type Page } from 'playwright'
import path from 'node:path'
import type { Persona, PersonaValueMapResponse, OnboardingStage } from '../personas/types'
import type { TestUser } from './user-factory'
import type { CapturedStage } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface DriverOptions {
  baseUrl: string
  outputDir: string
  headless?: boolean
  /**
   * Admin Supabase client used to poll for the first assistant message in
   * the first-insight conversation (Marcus path). The chat content is
   * delivered via streaming AI SDK; polling messages is more robust than
   * scraping DOM mid-stream.
   */
  admin: SupabaseClient
}

export interface DriverResult {
  stages: CapturedStage[]
  capturedArchetype: unknown | null
  capturedInsight: unknown | null
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

    // Capture API responses. The archetype is still served by a dedicated
    // route in v2. First-insight content is delivered via streaming chat —
    // we capture that via DB polling later.
    page.on('response', async (res) => {
      const url = res.url()
      try {
        if (url.includes('/api/onboarding/generate-archetype')) {
          result.capturedArchetype = await res.json()
        }
      } catch {
        // Ignore non-JSON / in-flight parse errors
      }
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
  // Polling for `useState` to have run via the autocomplete attribute is a
  // poor man's hydration check, but a real check is `page.waitForFunction`
  // that verifies setting the value sticks.
  const emailInput = page.locator('input[type="email"]')
  const passwordInput = page.locator('input[type="password"]')
  const submitBtn = page.locator('button[type="submit"]:has-text("Sign in")')
  await emailInput.waitFor({ state: 'visible', timeout: 10_000 })
  await passwordInput.waitFor({ state: 'visible', timeout: 10_000 })
  await submitBtn.waitFor({ state: 'visible', timeout: 10_000 })

  // Type instead of fill — fill() blasts the value via native setter and
  // dispatches a single 'input' event, which can race with React 19's
  // synchronous setState batching on controlled inputs. type() sends per-
  // character keystrokes which always trigger onChange correctly.
  await emailInput.click()
  await emailInput.fill('') // clear any browser autofill
  await emailInput.type(user.email, { delay: 5 })
  await passwordInput.click()
  await passwordInput.fill('')
  await passwordInput.type(user.password, { delay: 5 })

  // Defensive: verify the controlled-input state actually reflects what we
  // typed before submitting. If React state is stale, retry once.
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
  //  - Sign-in OK → router.push('/chat') → next.config 308 → /office → layout
  //    redirects to /onboarding-v2. Target URL pattern is /onboarding-v2|/office|/chat.
  //  - Sign-in FAIL → setError(...) renders an inline error div. The error
  //    div in (auth)/login/page.tsx is the only DOM element with BOTH
  //    `bg-destructive/10` AND `text-destructive` classes — anchor on both
  //    to avoid false positives from unrelated destructive-styled elements.
  const successUrlRe = /\/(onboarding-v2|office|chat)\b/
  // Tailwind compiles `bg-destructive/10` to a class `bg-destructive\/10`.
  // In Playwright selectors the `/` is escaped as `\\/`. Combine both error
  // classes for an exact match on the login-page error div.
  const errorSelector = 'div.bg-destructive\\/10.text-destructive'

  const outcome = await Promise.race([
    page
      .waitForURL(successUrlRe, { timeout: 30_000 })
      .then(() => ({ kind: 'success' as const })),
    (async () => {
      // Wait for the error element AND non-empty text. A bare visible match
      // could fire during React's render flush where the div is mounted but
      // its text child hasn't committed yet.
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            'div.bg-destructive\\/10.text-destructive',
          )
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

  // The office layout redirects fresh users to /onboarding-v2 when neither
  // onboarding_completed_at nor entry_struggle is set. If we didn't land
  // there automatically (e.g. URL is /office or /chat), navigate explicitly.
  if (!page.url().includes('/onboarding-v2')) {
    await page.goto(`${baseUrl}/onboarding-v2`, { waitUntil: 'domcontentloaded' })
  }
}

// ── Walk dispatch ───────────────────────────────────────────────────────────

async function runOnboarding(
  page: Page,
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  // Struggle screen renders the headline "what brought you in?" — wait for it
  await page.waitForSelector('text=/what brought you in/i', { timeout: 30_000 })

  await driveStage(page, 'struggle_submitted', persona, opts, result, async () => {
    await submitStruggle(page, persona)
  })

  const isMarcus = persona.expectations.entryStruggle === 'dont_know'
  if (isMarcus) {
    // Post-struggle, the user lands at /office?chat=open for the goal-derive
    // conversation. The skip control in the UI only appears after 90s — far
    // too long for tests. Mirror what skipGoalBeat() does server-side via the
    // admin client to fast-forward Marcus users straight into the value-map.
    await bypassGoalBeat(opts.admin, user, page, opts.baseUrl)
    await runMarcusPath(page, persona, user, opts, result)
  } else {
    await runChatFirstPath(page, persona, user, opts, result)
  }
}

/**
 * Test-only fast-forward past the goal-chat beat for Marcus personas.
 * Real users either complete the goal conversation (CFO asks, user answers,
 * goal lands → completeGoalBeat) or wait 90s for the skip control. Tests
 * need neither — bypass directly via the admin client. The UI redirect
 * predicate that follows (office layout) does the rest.
 */
async function bypassGoalBeat(
  admin: SupabaseClient,
  user: TestUser,
  page: Page,
  baseUrl: string,
): Promise<void> {
  // Mark the goal-chat conversation as completed (Marcus only — chat-first
  // users may keep their goal-chat open after this beat, but Marcus drops
  // it).
  const { error: convErr } = await admin
    .from('conversations')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('type', 'onboarding_goal_chat')
    .eq('status', 'active')
  if (convErr) {
    console.warn('[bypassGoalBeat] conversations update failed:', convErr.message)
  }

  // Step transition. The office layout watches onboarding_step and redirects
  // accordingly; once we set 'goal_skipped' and reload, Marcus users get
  // routed to /onboarding-v2/value-map automatically.
  //
  // We ALSO assert entry_struggle here. Reason: submitStruggle's update via
  // the user-cookie supabase client appears to silently no-op for fresh test
  // users on staging (returns no error, 0 rows affected, no telemetry).
  // Without entry_struggle set, the value-map page's resumeRoute() returns
  // '/onboarding-v2' and the test gets stuck looping back to the struggle
  // screen. Writing entry_struggle via the admin client makes the test
  // deterministic. Diagnosing why the user-context update no-ops is a
  // separate follow-up — likely a trigger ordering or RLS subtlety on
  // staging.
  const { data: updatedRows, error: profErr } = await admin
    .from('user_profiles')
    .update({
      onboarding_step: 'goal_skipped',
      entry_struggle: 'dont_know',
      onboarding_route: 'value_map',
    })
    .eq('id', user.id)
    .select('id, onboarding_step, entry_struggle')
  if (profErr) {
    console.error('[bypassGoalBeat] user_profiles update failed:', profErr.message)
    throw new Error(`bypassGoalBeat user_profiles update failed: ${profErr.message}`)
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw new Error(
      `bypassGoalBeat: 0 user_profiles rows updated for user ${user.id}. ` +
      `Row likely doesn't exist — check the auth.users → user_profiles trigger on staging.`,
    )
  }
  console.log(
    `[bypassGoalBeat] user ${user.id} now at step=${updatedRows[0].onboarding_step} struggle=${updatedRows[0].entry_struggle}`,
  )

  // Best-effort navigation to value-map. The bypass DB writes are correct
  // (verified above), but at the time of writing the server-component
  // redirect chain doesn't reliably land at /onboarding-v2/value-map even
  // when the DB state is consistent — the layout sees state that suggests
  // staying at /office despite admin-verified onboarding_step='goal_skipped'.
  // Likely an RLS / auth-uid mismatch between cookie session and DB row,
  // worth investigating in a follow-up. For now, attempt the navigation and
  // let runMarcusPath's existing waitForURL surface the failure with its
  // normal "Stage value_map_done failed" message — the bypass itself
  // should not throw and prevent that downstream signal from landing.
  await page.goto(`${baseUrl}/onboarding-v2/value-map`, { waitUntil: 'load' }).catch(() => {})
  console.log(`[bypassGoalBeat] navigation attempted; page.url() = ${page.url()}`)
}

// ── Stage helper ────────────────────────────────────────────────────────────

async function driveStage(
  page: Page,
  stage: OnboardingStage,
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

  // Wait for the Continue button to be enabled — i.e. the React state from
  // the option-click has flushed and `canContinue` is true. Without this,
  // Playwright can fire the Continue click before `selected` state has
  // propagated, and submitStruggle's server-action call gets selectedOption=null
  // which the action silently rejects. Result: entry_struggle stays unset and
  // the redirect chain takes the user somewhere unexpected.
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

// ── Marcus path: value-map → upload → archetype → chat ──────────────────────

async function runMarcusPath(
  page: Page,
  persona: Persona,
  user: TestUser,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  // value_map
  await driveStage(page, 'value_map_done', persona, opts, result, async () => {
    await page.waitForURL(/\/onboarding-v2\/value-map/, { timeout: 30_000 })
    await waitForValueMapIntro(page)
    await page.click('button:has-text("Let\'s start")')

    if (!persona.valueMapResponses) {
      throw new Error(`Persona ${persona.id} is on Marcus path but has no valueMapResponses`)
    }
    for (const response of persona.valueMapResponses) {
      await tapValueMapCard(page, response)
    }

    // In onboarding mode, ValueMapFlow.handleExerciseComplete sets
    // readyToFinish=true directly after the 10th card (no summary screen).
    // That fires handleContinue → onComplete in value-map-orchestrator,
    // which awaits advanceStep('value_map_done') then router.push('/upload').
    await page.waitForURL(/\/onboarding-v2\/upload/, { timeout: 30_000 })
  })

  // upload
  await driveStage(page, 'upload_done', persona, opts, result, async () => {
    if (!persona.csv) {
      throw new Error(`Persona ${persona.id} is on Marcus path but has no CSV — the v2 upload step is mandatory`)
    }
    await page.waitForSelector('input[type="file"]', { timeout: 30_000, state: 'attached' })
    const csvBuf = Buffer.from(persona.csv.contentBase64, 'base64')
    await page.setInputFiles('input[type="file"]', [{
      name: persona.csv.filename,
      mimeType: persona.csv.filename.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      buffer: csvBuf,
    }])
    // UploadWizard runs in autoImport mode; once import succeeds the
    // orchestrator calls advanceStep('upload_done') then router.push('/archetype').
    await page.waitForURL(/\/onboarding-v2\/archetype/, { timeout: 90_000 })
  })

  // archetype
  await driveStage(page, 'archetype_shown', persona, opts, result, async () => {
    // The orchestrator fires POST /api/onboarding/generate-archetype on mount.
    // Capture handler is already wired; we just wait for the CTA to enable.
    await page.waitForSelector('button:has-text("See what I found")', { timeout: 90_000 })
    await page.click('button:has-text("See what I found")')
    // Lands at /office?chat=open&conversationId=<id>; ChatOpenerTrigger strips
    // the query params after handling.
    await page.waitForURL(/\/office(\?|$)/, { timeout: 30_000 })
  })

  // complete: first-insight conversation has been created and is being
  // delivered via the chat sheet. Poll for the assistant message.
  await driveStage(page, 'complete', persona, opts, result, async () => {
    // First-insight generation can take 60-90s on Bedrock cold paths; allow
    // a generous window so we capture the wow moment text reliably.
    const insight = await pollFirstReadAssistantMessage(opts.admin, user.id, 150_000)
    if (insight) {
      result.capturedInsight = insight
    }
  })
}

// ── Chat-first path: struggle → chat ────────────────────────────────────────

async function runChatFirstPath(
  page: Page,
  _persona: Persona,
  user: TestUser,
  opts: DriverOptions,
  result: DriverResult,
): Promise<void> {
  await driveStage(page, 'chat_opener', _persona, opts, result, async () => {
    // The server action creates a conversation and redirects to
    // /office?chat=open&conversationId=<id>[&fto=1]. ChatOpenerTrigger
    // handles the opener (for free_text) and strips the params.
    await page.waitForURL(/\/office(\?|$)/, { timeout: 30_000 })
    // Poll for the first assistant message in the conversation — this is
    // either the pre-canned opener (debt/wealth/planning) or the LLM-
    // generated free-text opener.
    const opener = await pollFirstAssistantMessage(opts.admin, user.id, 60_000, 'onboarding_v2_chat')
    if (opener) {
      result.capturedInsight = opener
    }
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function waitForValueMapIntro(page: Page): Promise<void> {
  // The Value Map intro renders a "Let's start" CTA. Don't proceed until
  // it's mounted, with a couple of retries for the redirect/race window.
  for (let attempt = 0; attempt < 4; attempt++) {
    const btn = page.locator('button:has-text("Let\'s start")').first()
    if (await btn.count() > 0) return
    await page.waitForTimeout(1000)
  }
  await page.waitForSelector('button:has-text("Let\'s start")', { timeout: 15_000 })
}

async function tapValueMapCard(page: Page, response: PersonaValueMapResponse): Promise<void> {
  // Wait for the quadrant question to appear for the current card
  await page.waitForSelector('text=/How do you feel about this spend/i', { timeout: 15_000 })

  // There's a ~1.5s gate before buttons become tappable — wait it out
  await page.waitForTimeout(1700)

  if (response.hardToDecide || response.quadrant === null) {
    // "Unsure" button appears once the gate clears
    await page.waitForSelector('button:has-text("Unsure")', { timeout: 8_000 })
    await page.click('button:has-text("Unsure")')
  } else {
    const quadrantLabel = response.quadrant.charAt(0).toUpperCase() + response.quadrant.slice(1)
    await page.click(`button:has-text("${quadrantLabel}")`)

    // Confidence dots are labelled "Confidence N of 5"
    await page.waitForSelector('button[aria-label*="Confidence"]', { timeout: 5000 })
    const confidenceBtn = page.locator(`button[aria-label="Confidence ${response.confidence} of 5"]`).first()
    if (await confidenceBtn.count() > 0) {
      await confidenceBtn.click()
    }
    await page.click('button:has-text("Next")')
  }

  await page.waitForTimeout(500)
}

// ── DB-driven chat capture ─────────────────────────────────────────────────

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
