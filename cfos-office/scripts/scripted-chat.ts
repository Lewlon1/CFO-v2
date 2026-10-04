/**
 * Fixed 3-turn scripted conversation — the measurement instrument for the
 * filing cabinet.
 *
 * The handoff doc's step 5 has been the open question since the cabinet
 * shipped: "Measure the diet. Unmeasured, and it's the whole business case."
 * Nothing could measure it, because a conversation had to be driven by hand and
 * the two arms were never the same conversation twice.
 *
 * This drives an identical script against a real running server so the only
 * difference between two runs is the arm:
 *
 *   MEMORY_FILES_ENABLED=1 EXPERIMENT_RUN_ID=cab-on  npx next start
 *   MEMORY_FILES_ENABLED=0 EXPERIMENT_RUN_ID=cab-off npx next start
 *
 * Run this against each, then read the numbers out of `llm_usage_log` — never
 * off the console. The `[bedrock-usage]` lines are unpriced and the
 * `[prompt-tiers]` line measures the split, not the spend. The SQL at the end
 * of a run prints what to execute.
 *
 * IMPORTANT — run against a production build (`npm run build && npx next start`).
 * Turbopack compiles a route on first hit, which makes turn 1 unrepresentative
 * and has already cost this harness a full cycle twice.
 *
 * Because the flag is read per request, one build serves both arms: restart
 * with different env, no rebuild.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY  (from .env.local)
 *   SCRIPTED_CHAT_EMAIL, SCRIPTED_CHAT_PASSWORD              the staging user to drive
 *   SCRIPTED_CHAT_BASE_URL                                   default http://localhost:3000
 *   EXPERIMENT_RUN_ID                                        labels the run (set on the SERVER too)
 *
 * Run:
 *   npx tsx scripts/scripted-chat.ts --run-id=cab-on
 *   npx tsx scripts/scripted-chat.ts --dry-run     # print the script, no calls
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually (matches the pattern used by other scripts/).
try {
  const envFile = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local not found — rely on environment variables.
}

import { createClient } from '@supabase/supabase-js'
import { createChunks, stringToBase64URL } from '@supabase/ssr'
import { randomUUID } from 'node:crypto'

/**
 * The script.
 *
 * Turns 1 and 2 are the treatment: each names a topic an indexed file should
 * match, so a working retrieval contract fires `read_memory_file` before the
 * CFO answers. Turn 3 is the control — a numbers question the cabinet must NOT
 * answer, because current figures come from the compute tools and the contract
 * explicitly forbids a file carrying them. A run where turn 3 also reads is a
 * cabinet being consulted indiscriminately, which costs tokens without adding
 * anything.
 *
 * Deliberately generic: the point is a fixed script across arms, not a script
 * tuned to one user's files. Override per-user wording only if you re-run BOTH
 * arms afterwards.
 */
const SCRIPT: readonly string[] = [
  "I've been thinking about that goal I set — where am I with it?",
  'Remind me what I said mattered to me about how I spend, and whether I’m living up to it.',
  'What did I actually spend last month?',
] as const

interface TurnResult {
  index: number
  prompt: string
  text: string
  conversationId: string | null
  ms: number
  ok: boolean
  error?: string
}

function projectRefFrom(url: string): string {
  // https://<ref>.supabase.co → <ref>
  const host = new URL(url).hostname
  const ref = host.split('.')[0]
  if (!ref) throw new Error(`cannot derive project ref from ${url}`)
  return ref
}

/**
 * Mint the cookies `@supabase/ssr` expects on the server.
 *
 * /api/chat authenticates with createServerClient, which reads the session from
 * cookies — a bearer header is ignored. Built with the library's own chunker
 * and base64url encoder rather than a hand-rolled string so it cannot drift
 * from whatever the installed version does (0.10.0 defaults to base64url and
 * chunks past MAX_CHUNK_SIZE).
 */
function sessionCookieHeader(projectRef: string, session: unknown): string {
  const itemName = `sb-${projectRef}-auth-token`
  const encoded = `base64-${stringToBase64URL(JSON.stringify(session))}`
  return createChunks(itemName, encoded)
    .map((chunk) => `${chunk.name}=${encodeURIComponent(chunk.value)}`)
    .join('; ')
}

/**
 * Drain a UI message stream, collecting text and the conversation id.
 *
 * The route returns `toUIMessageStreamResponse` and puts `conversationId` in
 * the message metadata on the start/finish parts. Parsed structurally rather
 * than by part-type name so an AI SDK rename doesn't silently yield empty
 * output: any `conversationId` seen anywhere wins, and any string delta is
 * appended.
 */
function consumeStreamChunk(raw: string, acc: { text: string; conversationId: string | null }): void {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    const walk = (node: unknown): void => {
      if (node == null || typeof node !== 'object') return
      const obj = node as Record<string, unknown>
      if (typeof obj.conversationId === 'string') acc.conversationId = obj.conversationId
      if (obj.type === 'text-delta') {
        const delta = obj.delta ?? obj.textDelta
        if (typeof delta === 'string') acc.text += delta
      }
      for (const value of Object.values(obj)) {
        if (value && typeof value === 'object') walk(value)
      }
    }
    walk(parsed)
  }
}

async function sendTurn(args: {
  baseUrl: string
  cookie: string
  prompt: string
  conversationId: string | null
  index: number
}): Promise<TurnResult> {
  const started = Date.now()
  const body = {
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: args.prompt }],
      },
    ],
    conversationId: args.conversationId,
    conversationType: 'general',
  }

  const res = await fetch(`${args.baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: args.cookie,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    return {
      index: args.index,
      prompt: args.prompt,
      text: '',
      conversationId: args.conversationId,
      ms: Date.now() - started,
      ok: false,
      error: `HTTP ${res.status} ${detail.slice(0, 200)}`,
    }
  }

  const acc = { text: '', conversationId: args.conversationId }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    consumeStreamChunk(decoder.decode(value, { stream: true }), acc)
  }

  return {
    index: args.index,
    prompt: args.prompt,
    text: acc.text,
    conversationId: acc.conversationId,
    ms: Date.now() - started,
    ok: true,
  }
}

function analysisSql(runIds: string[]): string {
  const list = runIds.map((r) => `'${r}'`).join(', ')
  return `
-- Cost and tokens per arm. Compare turns 2-3 (steady state): turn 1 writes the
-- cache in both arms, and the arms have different prefixes so their turn-1
-- write cost is not comparable.
SELECT metadata->>'run_id'              AS run,
       metadata->>'memory_files_enabled' AS cabinet,
       count(*)                          AS turns,
       sum(prompt_tokens)                AS in_tok,
       sum(completion_tokens)            AS out_tok,
       sum(cache_read_tokens)            AS cache_read,
       sum(cache_write_tokens)           AS cache_write,
       round(sum(computed_cost_usd)::numeric, 6) AS cost_usd
FROM llm_usage_log
WHERE call_type = 'chat_turn' AND metadata->>'run_id' IN (${list})
GROUP BY 1, 2 ORDER BY 1;

-- Read-rate: the metric that says the retrieval contract works. Expect
-- read_memory_file on turns 1-2 and NOT on turn 3 (the numbers control).
SELECT metadata->>'run_id' AS run, tool_name, count(*)
FROM llm_usage_log
WHERE call_type = 'tool_call' AND metadata->>'run_id' IN (${list})
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
`.trim()
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const runIdArg = argv.find((a) => a.startsWith('--run-id='))?.slice('--run-id='.length)
  const runId = runIdArg ?? process.env.EXPERIMENT_RUN_ID ?? null
  const baseUrl = process.env.SCRIPTED_CHAT_BASE_URL ?? 'http://localhost:3000'

  console.log('Scripted 3-turn conversation')
  console.log(`  base url  ${baseUrl}`)
  console.log(`  run id    ${runId ?? '(unset — rows will not be attributable)'}`)
  console.log('')
  SCRIPT.forEach((t, i) => console.log(`  turn ${i + 1}  ${t}`))
  console.log('')

  if (dryRun) {
    console.log('Dry run — no server calls.')
    console.log('')
    console.log(analysisSql([runId ?? 'cab-on', 'cab-off']))
    return
  }

  if (!runId) {
    // Without a run_id the rows land unlabelled and the comparison is lost —
    // and you only find out after spending the Bedrock calls.
    throw new Error('set --run-id=<label> (and the same EXPERIMENT_RUN_ID on the server)')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const email = process.env.SCRIPTED_CHAT_EMAIL
  const password = process.env.SCRIPTED_CHAT_PASSWORD
  const missing = Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SCRIPTED_CHAT_EMAIL: email,
    SCRIPTED_CHAT_PASSWORD: password,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`)

  const supabase = createClient(supabaseUrl!, anonKey!)
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email!,
    password: password!,
  })
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message ?? 'no session'}`)

  const cookie = sessionCookieHeader(projectRefFrom(supabaseUrl!), data.session)
  console.log(`  signed in as ${data.user?.id}`)
  console.log('')

  const results: TurnResult[] = []
  let conversationId: string | null = null

  for (const [i, prompt] of SCRIPT.entries()) {
    // Strictly sequential — turn N+1 must see turn N's history, and the cache
    // behaviour being measured only appears on a real second turn.
    const result = await sendTurn({ baseUrl, cookie, prompt, conversationId, index: i + 1 })
    results.push(result)
    conversationId = result.conversationId ?? conversationId
    if (!result.ok) {
      console.error(`  ✗ turn ${result.index} failed: ${result.error}`)
      break
    }
    const preview = result.text.replace(/\s+/g, ' ').slice(0, 110)
    console.log(`  ✓ turn ${result.index}  ${result.ms}ms  ${result.text.length} chars`)
    console.log(`      ${preview}${result.text.length > 110 ? '…' : ''}`)
  }

  console.log('')
  console.log(`  conversation ${conversationId ?? '(none)'}`)
  console.log(`  ${results.filter((r) => r.ok).length}/${SCRIPT.length} turns completed`)
  console.log('')
  console.log('Now run the other arm, then read the numbers from the DB:')
  console.log('')
  console.log(analysisSql([runId, runId === 'cab-on' ? 'cab-off' : 'cab-on']))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
