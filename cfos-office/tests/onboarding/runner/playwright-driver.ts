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
  await page.fill('input[type="email"]', user.email)
  await page.fill('input[type="password"]', user.password)
  await page.click('button[type="submit"]:has-text("Sign in")')

  try {
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 20_000 })
  } catch (e) {
    try {
      await page.screenshot({ path: `${outputDir}/_error-at-signin.png`, fullPage: true })
    } catch {}
    const pageText = await page.textContent('body').catch(() => '')
    throw new Error(`Sign-in redirect timed out. Page text snippet: ${(pageText ?? '').slice(0, 500)}`)
  }

  // The office layout redirects fresh users to /onboarding-v2 when neither
  // onboarding_completed_at nor entry_struggle is set. If we didn't land
  // there automatically, navigate explicitly.
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
    await runMarcusPath(page, persona, user, opts, result)
  } else {
    await runChatFirstPath(page, persona, user, opts, result)
  }
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
  if (struggle === 'free_text') {
    const text = persona.expectations.entryStruggleText
    if (!text) throw new Error(`Persona ${persona.id}: entryStruggle is free_text but no entryStruggleText set`)
    await page.fill('textarea', text)
  } else {
    const label = STRUGGLE_OPTION_LABEL[struggle]
    if (!label) throw new Error(`Persona ${persona.id}: unknown entryStruggle "${struggle}"`)
    await page.click(`button:has-text(${JSON.stringify(label)})`)
  }
  await page.click('button:has-text("Continue")')
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

    // After the 10th card the flow transitions to the summary screen
    await page.waitForSelector('button:has-text("Continue")', { timeout: 20_000 })
    await page.click('button:has-text("Continue")')
    // ValueMapFlow.onComplete fires → /onboarding-v2/upload
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
    const insight = await pollFirstInsightAssistantMessage(opts.admin, user.id, 90_000)
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
 * first_insight conversation. Returns the message row or null on timeout.
 */
async function pollFirstInsightAssistantMessage(
  admin: SupabaseClient,
  userId: string,
  timeoutMs: number,
): Promise<unknown | null> {
  return pollFirstAssistantMessage(admin, userId, timeoutMs, 'first_insight')
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
