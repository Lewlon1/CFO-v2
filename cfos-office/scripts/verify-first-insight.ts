#!/usr/bin/env tsx
/**
 * Usage: npx tsx scripts/verify-first-insight.ts <userId>
 *
 * Prints payload JSON + assembled system prompt, then runs anti-hallucination
 * checks against the First Insight pipeline.
 *
 * Prerequisites:
 * - .env.local (or env vars) with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * - The target user must exist in the target Supabase project and have transactions
 *
 * NOTE on Next.js cookies: `buildSystemPrompt` imports `createClient()` from
 * `@/lib/supabase/server`, which uses `next/headers`. Outside a Next request
 * this throws. We stub both modules BEFORE importing context-builder so the
 * build path resolves and we can inject a service-role client.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import Module from 'module';

// --- 1. Load .env.local manually (avoids dotenv dependency) ---
// Try common locations relative to the script. When running inside a worktree
// the env file may live in the main repo, so we walk up a few levels looking
// for a sibling cfos-office/.env.local too.
const ENV_CANDIDATES = [
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../../.env.local'),
  resolve(__dirname, '../../cfos-office/.env.local'),
  resolve(__dirname, '../../../cfos-office/.env.local'),
  resolve(__dirname, '../../../../cfos-office/.env.local'),
  resolve(__dirname, '../../../../../cfos-office/.env.local'),
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
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  console.error(
    envLoadedFrom
      ? `Loaded env from: ${envLoadedFrom} (but required keys missing)`
      : `No .env.local found. Tried: ${ENV_CANDIDATES.join(', ')}`
  );
  process.exit(1);
}

// --- 2. Create the service-role Supabase client ---
import { createClient as createServiceClient } from '@supabase/supabase-js';
const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- 3. Stub `next/headers` and `@/lib/supabase/server` BEFORE context-builder loads ---
// The context-builder module imports `createClient` from the server helper, which
// in turn imports from `next/headers`. Outside a Next request context this
// throws "cookies() was called outside a request scope". We intercept the
// resolution to return a stub that yields our service-role client.
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === 'next/headers') {
    return require.resolve('./_stub-next-headers.ts');
  }
  return origResolve.call(this, request, ...rest);
};

// We also need to replace the server helper module with a version that
// returns our service client, since calling the real one would still try to
// read cookies through the stub. Easiest path: pre-populate require.cache for
// the server helper module.
const serverHelperPath = require.resolve('../src/lib/supabase/server');
require.cache[serverHelperPath] = {
  id: serverHelperPath,
  filename: serverHelperPath,
  loaded: true,
  exports: { createClient: async () => serviceClient },
} as any;

// --- 4. Now import the app modules (after the stubs are in place) ---
/* eslint-disable @typescript-eslint/no-require-imports */
const { computeFirstInsight } = require('../src/lib/analytics/insight-engine');
const { buildSystemPrompt } = require('../src/lib/ai/context-builder');

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: npx tsx scripts/verify-first-insight.ts <userId>');
    process.exit(1);
  }

  console.log(`\n(env loaded from ${envLoadedFrom ?? 'process env'})`);
  console.log(`(supabase url: ${supabaseUrl})`);
  console.log(`\n=== Computing first insight for user ${userId} ===\n`);

  const payload = await computeFirstInsight(serviceClient as any, userId);
  console.log(JSON.stringify(payload, null, 2));

  console.log('\n=== Assembled system prompt ===\n');
  const prompt: string = await buildSystemPrompt(userId, 'first_insight', {
    first_insight_payload: payload,
  });
  console.log(prompt);
  console.log('\n--- end prompt ---\n');

  console.log('\n=== Anti-hallucination checks ===\n');
  // We want to flag any usage of forbidden terms OUTSIDE the explicit denial
  // sections. The prompt intentionally names them in three kinds of denial
  // zones:
  //   - "STRICT RULES" (buildFirstInsightContext)
  //   - "NOT AVAILABLE" (buildFirstInsightContext)
  //   - the "CRITICAL: Do not mention, reference, imply, or compute..." line
  //     in the first_insight conversation-type section (single-line denial,
  //     tracked via per-line regex below).
  const LINE_DENIAL_PATTERNS = [
    /^CRITICAL:\s+Do not mention/i,
    /^-\s+Do (?:not|NOT)\s+/i,
    /^- You do NOT know\b/i,
    /^- You CAN say:/i,
    /^- If a field says "not_available"/i,
    /^- When in doubt:/i,
    /^- Every number you cite/i,
    /\bDo not say the words?\b/i,
    /\bDo NOT compute or imply\b/i,
    /\bDo NOT say\b/i,
  ];
  const FORBIDDEN = [
    /\bsavings rate\b/i,
    /\b% of (?:your |the )?income\b/i,
    /\bsurplus\b/i,
    /\bdeficit\b/i,
    /\baffordab(?:le|ility)\b/i,
    /\bsustainab(?:le|ility)\b/i,
    /\bleftover\b/i,
    /\bleft over\b/i,
    /\byour age\b/i,
    /\byour employment\b/i,
    /\bhousing type\b/i,
  ];
  // Compute denial ranges ONCE (sections + per-line matches of denial patterns)
  const denialRanges = computeDenialRanges(
    prompt,
    ['STRICT RULES', 'NOT AVAILABLE'],
    LINE_DENIAL_PATTERNS,
  );
  let failed = 0;
  for (const re of FORBIDDEN) {
    const all = findAllMatches(prompt, re);
    if (all.length === 0) {
      console.log(`  OK: ${re.source} -- not present`);
      continue;
    }
    const suspicious = all.filter(
      m => !denialRanges.some(([s, e]) => m.index >= s && m.index < e),
    );
    if (suspicious.length > 0) {
      console.error(
        `  FAIL: ${re.source} appears ${suspicious.length}x outside denial zones`,
      );
      for (const m of suspicious) {
        const start = Math.max(0, m.index - 40);
        const end = Math.min(prompt.length, m.index + m[0].length + 40);
        const context = prompt.slice(start, end).replace(/\n/g, ' ');
        console.error(`        context: "${context}"`);
      }
      failed++;
    } else {
      console.log(
        `  OK: ${re.source} -- ${all.length} occurrences, all inside denial zones`,
      );
    }
  }

  console.log(`\n=== Summary: ${failed === 0 ? 'PASS' : 'FAIL'} (${failed} issues) ===`);
  console.log(`\nPrompt length: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  process.exit(failed === 0 ? 0 : 2);
}

function computeDenialRanges(
  prompt: string,
  sectionHeaders: string[],
  lineDenialPatterns: RegExp[],
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const header of sectionHeaders) {
    const headerIdx = prompt.indexOf(header);
    if (headerIdx < 0) continue;
    const afterHeader = prompt.slice(headerIdx);
    const nextSectionMatch = afterHeader.slice(header.length).match(/\n(?:#{1,4} |---)/);
    const endOffset = nextSectionMatch
      ? header.length + (nextSectionMatch.index ?? 0)
      : afterHeader.length;
    ranges.push([headerIdx, headerIdx + endOffset]);
  }
  let cursor = 0;
  for (const rawLine of prompt.split('\n')) {
    const lineStart = cursor;
    const lineEnd = cursor + rawLine.length;
    if (lineDenialPatterns.some(p => p.test(rawLine))) {
      ranges.push([lineStart, lineEnd]);
    }
    cursor = lineEnd + 1;
  }
  return ranges;
}

function findAllMatches(prompt: string, pattern: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const globalRe = new RegExp(pattern.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = globalRe.exec(prompt)) !== null) out.push(m);
  return out;
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
