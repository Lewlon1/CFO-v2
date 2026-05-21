#!/usr/bin/env tsx
/**
 * Phase 7 — Session v2.2 Chat Intelligence eval harness.
 *
 * Generates BOTH the V1 and V2 first-insight system prompts for a single
 * user, runs each through Claude (chatModel), and writes a side-by-side
 * markdown diff to
 *   cfos-office/tests/onboarding/test-output/compare-first-insight-<userId>-<timestamp>.md
 *
 * Optional --judge flag runs the LLM-as-judge harness against each response
 * and appends a "## Judge scores" section.
 *
 * Usage:
 *   npx tsx scripts/compare-first-insight.ts <userId>           # capture only
 *   npx tsx scripts/compare-first-insight.ts <userId> --judge   # capture + judge
 *
 * Prerequisites:
 * - .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   AND AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
 * - The target user must exist in the target Supabase project and have
 *   transactions (otherwise both prompts will be sparse and the comparison
 *   is meaningless).
 *
 * NOTE on Next.js cookies: mirrors the verify-first-insight.ts approach —
 * we stub `next/headers` + `@/lib/supabase/server` BEFORE importing the
 * context-builder so the build path resolves and we can inject a
 * service-role client.
 *
 * NOTE on V1 vs V2 in one process: the v2 feature flag is evaluated
 * lazily on every call to buildSystemPrompt, but the chat-intelligence-v2
 * module is imported at module-load time. We toggle the env var around
 * each buildSystemPrompt call — the flag checks `process.env.CHAT_INTELLIGENCE_V2_FORCE`
 * at call time, so this works without separate processes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import Module from 'module';

// --- 1. Parse args ---
const ARGV = process.argv.slice(2);
const JUDGE_MODE = ARGV.includes('--judge');
const CAPTURE_MODE = ARGV.includes('--capture');
const HYPOTHESIS_MODE = ARGV.includes('--hypothesis');

function usageAndExit(code = 1): never {
  console.error('Usage:');
  console.error('  npx tsx scripts/compare-first-insight.ts <userId>                # v1 vs v2');
  console.error('  npx tsx scripts/compare-first-insight.ts <userId> --hypothesis   # v2 vs v2_hypothesis');
  console.error('  npx tsx scripts/compare-first-insight.ts <userId> --judge        # add legacy judge');
  console.error('  npx tsx scripts/compare-first-insight.ts <userId> --capture      # write pair to eval/golden-set/');
  console.error('  (--judge, --capture, --hypothesis can be combined)');
  process.exit(code);
}

const userId = ARGV.find(a => !a.startsWith('--'));
if (!userId) usageAndExit(1);

// --- 2. Load .env.local manually (mirrors verify-first-insight.ts) ---
const ENV_CANDIDATES = [
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../../.env.local'),
  resolve(__dirname, '../../cfos-office/.env.local'),
  resolve(__dirname, '../../../cfos-office/.env.local'),
];

let envLoadedFrom: string | null = null;
for (const candidate of ENV_CANDIDATES) {
  try {
    const envFile = readFileSync(candidate, 'utf-8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
    envLoadedFrom = candidate;
    break;
  } catch {
    // try next candidate
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const awsRegion = process.env.AWS_REGION ?? '';
const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID ?? '';
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  console.error(
    envLoadedFrom
      ? `Loaded env from: ${envLoadedFrom} (but required keys missing)`
      : `No .env.local found. Tried: ${ENV_CANDIDATES.join(', ')}`,
  );
  process.exit(1);
}

if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
  console.error('Missing AWS credentials (AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).');
  console.error('compare-first-insight.ts calls Bedrock and cannot run without them.');
  process.exit(1);
}

// --- 3. Create the service-role Supabase client ---
import { createClient as createServiceClient } from '@supabase/supabase-js';
const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- 4. Stub `next/headers` and `@/lib/supabase/server` BEFORE imports ---
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === 'next/headers') {
    return require.resolve('./_stub-next-headers.ts');
  }
  return origResolve.call(this, request, ...rest);
};

const serverHelperPath = require.resolve('../src/lib/supabase/server');
require.cache[serverHelperPath] = {
  id: serverHelperPath,
  filename: serverHelperPath,
  loaded: true,
  exports: { createClient: async () => serviceClient },
} as any;

// --- 5. Imports (after stubs are in place) ---
const { buildSystemPrompt } = require('../src/lib/ai/context-builder');
const { computeFirstInsight } = require('../src/lib/analytics/insight-engine');
const { chatModel } = require('../src/lib/ai/provider');
const { createToolbox } = require('../src/lib/ai/tools');
const { generateText, stepCountIs } = require('ai');

// The trigger message the chat surface auto-sends for first_insight.
// Source: cfos-office/src/components/chat/ChatProvider.tsx (default branch
// at the bottom of the auto-trigger useEffect — the value-map path and
// other typed openings have their own trigger strings, but first_insight
// uses the generic "Post-upload analysis triggered" prompt).
const FIRST_INSIGHT_TRIGGER =
  '[System: Post-upload analysis triggered. Deliver your first insight.]';

interface RunResult {
  prompt: string;
  text: string;
  toolCalls: Array<{ toolName: string; args?: unknown; output?: unknown }>;
  finishReason: string;
  promptChars: number;
  inputTokens?: number;
  outputTokens?: number;
}

async function runVariant(
  variant: 'v1' | 'v2' | 'v2_hypothesis',
  conversationId: string,
): Promise<RunResult> {
  // Toggle the v2 force flag. V2 is now default — set '0' to force V1.
  if (variant === 'v1') {
    process.env.CHAT_INTELLIGENCE_V2_FORCE = '0';
  } else {
    delete process.env.CHAT_INTELLIGENCE_V2_FORCE;
  }

  // Toggle the hypothesis prompt-variant flag. Only set for the dedicated
  // v2_hypothesis arm; the v2 baseline arm must NOT render the hypothesis
  // section even if the env was set externally.
  if (variant === 'v2_hypothesis') {
    process.env.HYPOTHESIS_ENGINE_PROMPT = '1';
  } else {
    delete process.env.HYPOTHESIS_ENGINE_PROMPT;
  }

  // All variants compute the payload (post-upload route does this for
  // every user now — V1 stores the full payload; V2 / v2_hypothesis only
  // keep the experiment_proposal slice for the closing-beat block).
  const payload = await computeFirstInsight(serviceClient as any, userId);
  const conversationMetadata: Record<string, unknown> =
    variant === 'v1'
      ? {
          first_insight_payload: payload,
          transaction_count: payload?.transactionCount,
        }
      : {
          chat_intelligence_v2: true,
          experiment_proposal: payload?.experiment_proposal ?? null,
        };

  const prompt: string = await buildSystemPrompt(
    userId,
    'first_insight',
    conversationMetadata,
    conversationId,
  );

  // Determine the user's primary currency for tool context.
  const { data: profileRow } = await serviceClient
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', userId)
    .single();
  const currency = profileRow?.primary_currency ?? 'EUR';

  const toolbox = createToolbox({
    supabase: serviceClient,
    userId,
    conversationId,
    currency,
  });

  // generateText (synchronous capture) mirrors what the chat route does
  // with streamText. Same stopWhen, same toolChoice. We pass the system
  // prompt as a system-role message with cachePoint to match prod exactly.
  const result = await generateText({
    model: chatModel,
    messages: [
      {
        role: 'system',
        content: prompt,
        providerOptions: {
          bedrock: { cachePoint: { type: 'default' } },
        },
      },
      { role: 'user', content: FIRST_INSIGHT_TRIGGER },
    ],
    tools: toolbox,
    toolChoice: 'auto',
    stopWhen: stepCountIs(5),
  });

  // result.text is the final assistant text. result.toolCalls / .toolResults
  // are per-step aggregates. The AI SDK exposes a flat .toolCalls array of
  // all tool calls across all steps.
  const toolCalls: RunResult['toolCalls'] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawSteps: any[] = (result as any).steps ?? [];
  for (const step of rawSteps) {
    const calls = step?.toolCalls ?? [];
    const results = step?.toolResults ?? [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const out = results.find((r: any) => r?.toolCallId === call?.toolCallId);
      toolCalls.push({
        toolName: call?.toolName ?? 'unknown',
        args: call?.input ?? call?.args,
        output: out?.output ?? out?.result,
      });
    }
  }

  return {
    prompt,
    text: result.text ?? '',
    toolCalls,
    finishReason: result.finishReason ?? 'unknown',
    promptChars: prompt.length,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

function fenceMd(content: string, lang = ''): string {
  // If content already contains triple backticks, switch to a longer fence.
  const longest = (content.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${content}\n${fence}`;
}

function renderToolCalls(calls: RunResult['toolCalls']): string {
  if (calls.length === 0) return '_(no tool calls)_';
  const lines: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    lines.push(`### Call ${i + 1} — \`${c.toolName}\``);
    lines.push('');
    lines.push('**args**');
    lines.push('');
    lines.push(fenceMd(JSON.stringify(c.args ?? null, null, 2), 'json'));
    lines.push('');
    lines.push('**output**');
    lines.push('');
    lines.push(fenceMd(JSON.stringify(c.output ?? null, null, 2), 'json'));
    lines.push('');
  }
  return lines.join('\n');
}

async function fetchKnownMerchants(): Promise<string[]> {
  // Pull recent merchant strings from the user's transactions so the judge
  // can check H1 (specific merchant from user's data) without re-running
  // tool calls. Last 90 days, unique descriptions, up to 200 names.
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const { data } = await serviceClient
    .from('transactions')
    .select('description')
    .eq('user_id', userId)
    .gte('date', since.toISOString().slice(0, 10))
    .limit(2000);
  const set = new Set<string>();
  for (const row of data ?? []) {
    const desc = (row as { description?: string | null })?.description?.trim();
    if (desc) set.add(desc);
  }
  return Array.from(set).slice(0, 200);
}

async function fetchUserBrief(): Promise<string> {
  // Pull the entry brief / struggle / goal text so the judge can score H2
  // (hook ties to stated goal/struggle). Best-effort — we concatenate a
  // few likely sources without failing if any are missing.
  const parts: string[] = [];

  const { data: profile } = await serviceClient
    .from('user_profiles')
    .select('display_name, entry_brief, entry_struggle, primary_currency')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.entry_brief) parts.push(`Entry brief: ${profile.entry_brief}`);
  if (profile?.entry_struggle) parts.push(`Entry struggle: ${profile.entry_struggle}`);

  const { data: goals } = await serviceClient
    .from('goals')
    .select('title, target_amount, target_date, notes')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(3);

  for (const g of goals ?? []) {
    const bits: string[] = [];
    if ((g as any).title) bits.push(String((g as any).title));
    if ((g as any).target_amount != null) bits.push(`target ${(g as any).target_amount}`);
    if ((g as any).target_date) bits.push(`by ${(g as any).target_date}`);
    if ((g as any).notes) bits.push(`(${(g as any).notes})`);
    if (bits.length) parts.push(`Goal: ${bits.join(' — ')}`);
  }

  if (parts.length === 0) return '(no entry brief / goal recorded)';
  return parts.join('\n');
}

async function main() {
  console.log(`\n(env loaded from ${envLoadedFrom ?? 'process env'})`);
  console.log(`(supabase url: ${supabaseUrl})`);
  console.log(`(judge mode: ${JUDGE_MODE ? 'ON' : 'off'})`);
  console.log(`\n=== Comparing first-insight V1 vs V2 for user ${userId} ===\n`);

  // Sanity: confirm the user exists.
  const { data: existing, error: userErr } = await serviceClient
    .from('user_profiles')
    .select('id, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (userErr || !existing) {
    console.error(`User ${userId} not found in user_profiles. Aborting.`);
    process.exit(1);
  }

  // Use a deterministic conversation id so the prompt builder can attach
  // metadata in the same way prod would. We never insert this row — it's
  // synthetic and only flows through the prompt builder + tool context.
  const conversationId = `compare-${userId}-${Date.now()}`;

  // In --hypothesis mode we run v2 vs v2_hypothesis. Generate a fresh
  // hypothesis up front so the v2_hypothesis arm has a row to render.
  // Without this, the v2_hypothesis arm would degrade to the v2 baseline.
  let runA: RunResult;
  let runB: RunResult;
  let labelA: 'v1' | 'v2';
  let labelB: 'v2' | 'v2_hypothesis';

  if (HYPOTHESIS_MODE) {
    console.log('Generating fresh hypothesis for v2_hypothesis arm...');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateAndPersistHypothesis } = require('../src/lib/hypothesis/generate-and-persist');
    await generateAndPersistHypothesis(serviceClient, userId, 'manual');

    console.log('Running V2 baseline...');
    runA = await runVariant('v2', `${conversationId}-v2`);
    labelA = 'v2';
    console.log(`  V2 done — ${runA.text.length} chars text, ${runA.toolCalls.length} tool calls`);

    console.log('Running V2_hypothesis...');
    runB = await runVariant('v2_hypothesis', `${conversationId}-v2h`);
    labelB = 'v2_hypothesis';
    console.log(`  V2_hypothesis done — ${runB.text.length} chars text, ${runB.toolCalls.length} tool calls`);
  } else {
    console.log('Running V1...');
    runA = await runVariant('v1', `${conversationId}-v1`);
    labelA = 'v1';
    console.log(`  V1 done — ${runA.text.length} chars text, ${runA.toolCalls.length} tool calls`);

    console.log('Running V2...');
    runB = await runVariant('v2', `${conversationId}-v2`);
    labelB = 'v2';
    console.log(`  V2 done — ${runB.text.length} chars text, ${runB.toolCalls.length} tool calls`);
  }
  const v1 = runA;
  const v2 = runB;

  // Known merchants + user brief are needed by either --judge or --capture.
  // Compute once, share between both paths.
  let knownMerchants: string[] = [];
  let userBrief = '';
  if (JUDGE_MODE || CAPTURE_MODE) {
    [knownMerchants, userBrief] = await Promise.all([
      fetchKnownMerchants(),
      fetchUserBrief(),
    ]);
  }

  let judgeSection = '';
  if (JUDGE_MODE) {
    console.log('Running judge...');
    const { judgeFirstInsight } = require('../tests/onboarding/runner/judge-first-insight');

    const v1Judge = await judgeFirstInsight({
      response: v1.text,
      prompt: v1.prompt,
      knownMerchants,
      userBrief,
    });
    const v2Judge = await judgeFirstInsight({
      response: v2.text,
      prompt: v2.prompt,
      knownMerchants,
      userBrief,
    });

    judgeSection = [
      '## Judge scores',
      '',
      `### ${labelA}`,
      '',
      fenceMd(JSON.stringify(v1Judge, null, 2), 'json'),
      '',
      `### ${labelB}`,
      '',
      fenceMd(JSON.stringify(v2Judge, null, 2), 'json'),
      '',
    ].join('\n');
    console.log(`  Judge done — ${labelA} pass=${v1Judge.overall_pass}, ${labelB} pass=${v2Judge.overall_pass}`);
  }

  // Write the markdown diff. Output path lives under the harness
  // test-output dir so it's tracked alongside the persona runs.
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(
    __dirname,
    '..',
    'tests',
    'onboarding',
    'test-output',
    `compare-first-insight-${userId}-${timestamp}.md`,
  );
  mkdirSync(dirname(outPath), { recursive: true });

  const md = [
    `# ${labelA} vs ${labelB} — userId ${userId} — ${timestamp}`,
    '',
    `- Trigger message: \`${FIRST_INSIGHT_TRIGGER}\``,
    `- ${labelA} prompt length: ${v1.promptChars} chars (~${Math.round(v1.promptChars / 4)} tokens)`,
    `- ${labelB} prompt length: ${v2.promptChars} chars (~${Math.round(v2.promptChars / 4)} tokens)`,
    `- ${labelA} finishReason: \`${v1.finishReason}\`  ${labelB} finishReason: \`${v2.finishReason}\``,
    `- ${labelA} tokens in/out: ${v1.inputTokens ?? '?'} / ${v1.outputTokens ?? '?'}`,
    `- ${labelB} tokens in/out: ${v2.inputTokens ?? '?'} / ${v2.outputTokens ?? '?'}`,
    '',
    `## ${labelA} prompt`,
    '',
    fenceMd(v1.prompt, 'md'),
    '',
    `## ${labelA} response`,
    '',
    fenceMd(v1.text || '(empty)', 'md'),
    '',
    `## ${labelB} prompt`,
    '',
    fenceMd(v2.prompt, 'md'),
    '',
    `## ${labelB} response`,
    '',
    fenceMd(v2.text || '(empty)', 'md'),
    '',
    '## Tool calls',
    '',
    `### ${labelA}`,
    '',
    renderToolCalls(v1.toolCalls),
    '',
    `### ${labelB}`,
    '',
    renderToolCalls(v2.toolCalls),
    '',
    judgeSection,
  ].join('\n');

  writeFileSync(outPath, md, 'utf-8');
  console.log(`\nWrote: ${outPath}\n`);

  // --capture: persist the V1/V2 pair into the golden set so it can be rated
  // and used by calibrate/diagnose/tournament. We do this AFTER the markdown
  // write so a failure here doesn't lose the visible artifact.
  if (CAPTURE_MODE) {
    const { buildPair, writePair } = require('./eval/_lib/pair-storage');
    const pair = buildPair({
      source: 'compare-first-insight',
      persona_id: null,
      user_id: userId,
      trigger_message: FIRST_INSIGHT_TRIGGER,
      known_merchants: knownMerchants,
      user_brief: userBrief,
      variant_a: { label: labelA, system_prompt: v1.prompt },
      variant_b: { label: labelB, system_prompt: v2.prompt },
      response_a: {
        text: v1.text,
        tool_calls: v1.toolCalls,
        tokens: { in: v1.inputTokens ?? 0, out: v1.outputTokens ?? 0 },
      },
      response_b: {
        text: v2.text,
        tool_calls: v2.toolCalls,
        tokens: { in: v2.inputTokens ?? 0, out: v2.outputTokens ?? 0 },
      },
    });
    writePair(pair);
    console.log(`Captured pair: ${pair.pair_id} (fold=${pair.fold})`);
    console.log(`  eval/golden-set/pairs/${pair.pair_id}.json\n`);
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
