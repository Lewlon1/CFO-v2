import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const EMAIL_DOMAIN = 'cfo-test.local'

export interface TestUser {
  id: string
  email: string
  password: string
}

export function makeAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function randomPassword(): string {
  return randomBytes(12).toString('hex')
}

function sanitiseRunId(runId: string): string {
  return runId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
}

export async function createTestUser(
  admin: SupabaseClient,
  personaId: string,
  runId: string,
): Promise<TestUser> {
  const safeRun = sanitiseRunId(runId)
  const email = `test-onboarding-${personaId}-${safeRun}@${EMAIL_DOMAIN}`.toLowerCase()
  const password = randomPassword()

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      test_suite: 'onboarding',
      persona_id: personaId,
      run_id: runId,
    },
  })

  if (error) throw new Error(`createTestUser failed for ${personaId}: ${error.message}`)
  if (!data.user) throw new Error(`createTestUser returned no user for ${personaId}`)

  return { id: data.user.id, email, password }
}

export async function deleteTestUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    console.error(`[user-factory] deleteUser ${userId} failed:`, error.message)
  }
}

export async function deleteAllTestUsers(admin: SupabaseClient, runId?: string): Promise<number> {
  let deleted = 0
  let page = 1
  const runIdSan = runId ? sanitiseRunId(runId) : null

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    if (!data.users.length) break

    for (const u of data.users) {
      if (!u.email?.endsWith(`@${EMAIL_DOMAIN}`)) continue
      if (runIdSan && !u.email.includes(`-${runIdSan}@`)) continue
      await deleteTestUser(admin, u.id)
      deleted++
    }

    if (data.users.length < 100) break
    page++
  }
  return deleted
}
