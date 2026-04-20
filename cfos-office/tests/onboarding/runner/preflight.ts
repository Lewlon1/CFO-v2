const STAGING_PROJECT_REF = 'qlbhvlssksnrhsleadzn'

export function checkStagingGuard(supabaseUrl: string): void {
  if (!supabaseUrl) {
    throw new Error('Staging guard: NEXT_PUBLIC_SUPABASE_URL is empty or missing.')
  }
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(
      `Staging guard: NEXT_PUBLIC_SUPABASE_URL does not point at CFO Staging (${STAGING_PROJECT_REF}).\n` +
      `Got: ${supabaseUrl}\n` +
      `The suite refuses to run against production or any non-staging project.`
    )
  }
}

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const

export function checkRequiredEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): void {
  const missing: string[] = []
  for (const key of REQUIRED_ENV) {
    if (!env[key] || env[key] === '') missing.push(key)
  }
  if (missing.length) {
    throw new Error(`Preflight: missing required env vars:\n  - ${missing.join('\n  - ')}`)
  }
}

export async function loadDotenvLocal(filepath: string): Promise<void> {
  const fs = await import('node:fs')
  let content: string
  try {
    content = fs.readFileSync(filepath, 'utf-8')
  } catch {
    return
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["'](.*)["']$/, '$1')
    if (!process.env[key]) process.env[key] = value
  }
}
