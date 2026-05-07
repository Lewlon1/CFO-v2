// Side-effect module: loads .env.local into process.env at import time.
// Import this FIRST in cli.ts so env vars exist before @/lib/ai/provider
// (and similar modules) initialise.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["'](.*)["']$/, '$1')
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local missing is OK — preflight will catch missing required vars.
}
