/**
 * One-off re-extraction of post-conversation portrait traits for users whose
 * conversations predate the S-W1.5-11 pipeline fix.
 *
 * The post-conversation extractor was silently failing in prod (fire-and-forget
 * `fetch()` killed by Vercel before landing — see plan
 * `~/.claude/plans/session-w1-5-11-financial-lexical-allen.md`). Going forward
 * the pipeline runs via `after()` and a daily cron. But existing conversations
 * stay unanalysed until someone runs this script.
 *
 * USAGE
 *   Read-only against the database — emits SQL `INSERT` statements to stdout.
 *   Lewis reviews and runs against prod manually:
 *
 *     npx tsx scripts/reextract-portrait.ts > prod-backfill-039-portrait-reextraction.sql
 *
 *   Env (via .env.local or shell):
 *     NEXT_PUBLIC_SUPABASE_URL    = https://iccelmjenljanqrhhzdv.supabase.co  (or staging)
 *     SUPABASE_SERVICE_ROLE_KEY   = <service role for that project>
 *     AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY = Bedrock creds
 *     BEDROCK_CLAUDE_UTILITY_MODEL (optional, defaults to eu.anthropic.claude-haiku-4-5...)
 *
 *   Defaults to running for the three Tier-A users (Tijn, Ben, Alex) whose
 *   portraits have been most affected. Override with TARGET_USER_IDS.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { generateObject } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { traitSchema } from '../src/lib/ai/portrait-extraction'

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
  /* rely on shell env */
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const TIER_A_USER_IDS = [
  '1ad2b8ae-3d8e-4b89-8966-5822afacb554', // Tijn
  'eac08b34-e73f-484b-8a53-6ce1f4f008a2', // Ben
  '687af76d-0407-4097-b082-80824e0b8c23', // Alex
]
const targetUserIds = (process.env.TARGET_USER_IDS?.split(',').map((s) => s.trim()).filter(Boolean)) ?? TIER_A_USER_IDS
const SOURCE_TAG = 'manual_reextraction_2026-05'

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
})
const utilityModelId =
  process.env.BEDROCK_CLAUDE_UTILITY_MODEL || 'eu.anthropic.claude-haiku-4-5-20251001-v1:0'
const utilityModel = bedrock(utilityModelId)

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''")
}

function logToStderr(...args: unknown[]) {
  console.error('[reextract]', ...args)
}

async function loadTranscript(userId: string): Promise<{ transcript: string; messageCount: number; conversationIds: string[] }> {
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, title, type, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (!convs || convs.length === 0) return { transcript: '', messageCount: 0, conversationIds: [] }

  const conversationIds: string[] = []
  const segments: string[] = []
  let total = 0
  for (const conv of convs) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conv.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    if (!msgs || msgs.length === 0) continue
    conversationIds.push(conv.id)
    total += msgs.length
    segments.push(
      `--- Conversation: ${conv.title ?? '(untitled)'} (${conv.type ?? 'general'}, ${conv.created_at}) ---\n` +
        msgs.map((m) => `${m.role === 'user' ? 'USER' : 'CFO'}: ${m.content}`).join('\n\n'),
    )
  }
  return { transcript: segments.join('\n\n'), messageCount: total, conversationIds }
}

async function loadExistingTraitKeys(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('financial_portrait')
    .select('trait_key')
    .eq('user_id', userId)
    .is('dismissed_at', null)
  return new Set((data ?? []).map((t) => t.trait_key))
}

async function main() {
  const projectHint = supabaseUrl.includes('iccelmjenljanqrhhzdv') ? 'PROD' : supabaseUrl.includes('qlbhvlssksnrhsleadzn') ? 'STAGING' : 'OTHER'
  logToStderr(`Database: ${projectHint} (${supabaseUrl})`)
  logToStderr(`Targets: ${targetUserIds.length} user(s)`)

  console.log('-- Re-extracted portrait traits (S-W1.5-11)')
  console.log(`-- Source tag: ${SOURCE_TAG}`)
  console.log(`-- Generated: ${new Date().toISOString()}`)
  console.log(`-- Database: ${projectHint}`)
  console.log('-- Review each block before running. Each user is wrapped in a transaction so')
  console.log('-- you can run them independently.')
  console.log('')

  for (const userId of targetUserIds) {
    logToStderr(`\n=== ${userId} ===`)
    const { transcript, messageCount, conversationIds } = await loadTranscript(userId)
    if (messageCount === 0) {
      logToStderr('  No messages — skipping.')
      console.log(`-- ${userId}: no messages, skipped`)
      console.log('')
      continue
    }
    logToStderr(`  ${messageCount} messages across ${conversationIds.length} conversations`)

    const existingKeys = await loadExistingTraitKeys(userId)
    const existingList = Array.from(existingKeys)
      .map((k) => `- ${k}`)
      .join('\n') || '(none yet)'

    const { object } = await generateObject({
      model: utilityModel,
      schema: traitSchema,
      prompt: `You are analysing the FULL conversation history between a user and their personal CFO across multiple conversations. Extract behavioral traits, patterns, or profile-relevant information that was revealed across these conversations but not explicitly captured by tool calls.

Existing trait keys already on file:
${existingList}

Conversation history:
${transcript}

Rules:
- Only extract traits with confidence >= 0.5
- Don't duplicate trait keys listed above
- Keep trait_value concise but specific
- Return empty arrays if nothing new was found
- Focus on: spending behavior, financial attitudes, life circumstances, goals, personality traits relevant to financial advice
- Aim for 5-10 high-signal traits per user. Quality over quantity.`,
    })

    const newTraits = object.new_traits.filter((t) => !existingKeys.has(t.trait_key))
    logToStderr(`  Bedrock returned ${object.new_traits.length} traits (${newTraits.length} new)`)

    console.log(`-- =================================================================`)
    console.log(`-- User: ${userId}`)
    console.log(`-- Source: ${SOURCE_TAG}`)
    console.log(`-- Conversations analysed: ${conversationIds.length} (${messageCount} messages)`)
    console.log(`-- Traits proposed: ${newTraits.length}`)
    console.log(`-- =================================================================`)
    if (newTraits.length === 0) {
      console.log('-- (no new traits)')
      console.log('')
      continue
    }
    console.log('BEGIN;')
    for (const trait of newTraits) {
      console.log(
        `INSERT INTO public.financial_portrait (user_id, trait_type, trait_key, trait_value, confidence, evidence, source) VALUES (`,
      )
      console.log(`  '${userId}',`)
      console.log(`  '${sqlEscape(trait.trait_type)}',`)
      console.log(`  '${sqlEscape(trait.trait_key)}',`)
      console.log(`  '${sqlEscape(trait.trait_value)}',`)
      console.log(`  ${trait.confidence},`)
      console.log(`  '${sqlEscape(trait.evidence)}',`)
      console.log(`  '${SOURCE_TAG}'`)
      console.log(`) ON CONFLICT (user_id, trait_key) DO NOTHING;`)
    }
    console.log('COMMIT;')
    console.log('')
  }

  logToStderr('\nDone. Pipe stdout to a .sql file, review by hand, run against prod manually.')
}

main().catch((err) => {
  console.error('[reextract] fatal:', err)
  process.exit(1)
})
