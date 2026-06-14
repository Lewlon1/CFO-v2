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

// Public-schema tables that reference user_id / profile_id. Deleting these
// rows before auth.admin.deleteUser keeps Supabase's "Database error deleting
// user" path from firing — when public-schema FKs lack ON DELETE CASCADE,
// the Supabase Auth admin endpoint surfaces a noisy generic 500 even though
// the auth.users row eventually goes away via the auth.* cascades. Explicit
// tear-down makes the operation deterministic and the cleanup log quiet.
export const USER_DATA_TABLES_BY_USER_ID = [
  'llm_usage_log',
  'value_category_rules',
  'financial_portrait',
  'goals',
  'assets',
  'liabilities',
  'action_items',
  'messages',
  'conversations',
  'transactions',
] as const

const USER_DATA_TABLES_BY_PROFILE_ID = [
  'value_map_results',
  'value_map_sessions',
  'user_events',
] as const

const PROFILE_ROW_TABLE_BY_ID = 'user_profiles'

// "Table-not-found" patterns from PostgREST — silent-skip cases. Adding a
// new entry here is preferable to logging noise for tables that don't exist
// in the current branch.
const TABLE_MISSING_RE = /(relation .* does not exist|could not find the table|schema cache)/i

async function tearDownUserData(admin: SupabaseClient, userId: string): Promise<void> {
  // Order: dependent rows first (messages before conversations), then top-
  // level domain tables. Errors are logged but not thrown — a missing table
  // (e.g. in branched databases) shouldn't block the auth-user deletion.
  for (const table of USER_DATA_TABLES_BY_USER_ID) {
    const { error } = await admin.from(table).delete().eq('user_id', userId)
    if (error && !TABLE_MISSING_RE.test(error.message)) {
      console.warn(`[user-factory] tearDownUserData ${table}/user_id failed:`, error.message)
    }
  }
  for (const table of USER_DATA_TABLES_BY_PROFILE_ID) {
    const { error } = await admin.from(table).delete().eq('profile_id', userId)
    if (error && !TABLE_MISSING_RE.test(error.message)) {
      console.warn(`[user-factory] tearDownUserData ${table}/profile_id failed:`, error.message)
    }
  }
  const { error: profErr } = await admin.from(PROFILE_ROW_TABLE_BY_ID).delete().eq('id', userId)
  if (profErr && !TABLE_MISSING_RE.test(profErr.message)) {
    console.warn(`[user-factory] tearDownUserData user_profiles/id failed:`, profErr.message)
  }
}

export async function deleteTestUser(admin: SupabaseClient, userId: string): Promise<void> {
  await tearDownUserData(admin, userId)
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    // After tear-down, the only path to this error is a Supabase Auth-side
    // bug or the user already being gone. Treat "user not found" as success.
    if (/user not found/i.test(error.message)) return
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
