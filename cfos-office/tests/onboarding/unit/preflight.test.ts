import { describe, it, expect } from 'vitest'
import { checkStagingGuard, checkRequiredEnv } from '../runner/preflight'

describe('checkStagingGuard', () => {
  it('accepts the staging project URL', () => {
    expect(() => checkStagingGuard('https://qlbhvlssksnrhsleadzn.supabase.co')).not.toThrow()
  })

  it('rejects a non-staging URL', () => {
    expect(() => checkStagingGuard('https://example.supabase.co')).toThrow(/staging/i)
  })

  it('rejects empty URL', () => {
    expect(() => checkStagingGuard('')).toThrow()
  })
})

describe('checkRequiredEnv', () => {
  const requiredKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']

  it('passes when all keys present', () => {
    const env = Object.fromEntries(requiredKeys.map((k) => [k, 'x']))
    expect(() => checkRequiredEnv(env)).not.toThrow()
  })

  it('fails with the missing key name', () => {
    const env = Object.fromEntries(requiredKeys.map((k) => [k, 'x']))
    delete env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => checkRequiredEnv(env)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
