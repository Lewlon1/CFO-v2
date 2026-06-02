import { describe, it, expect } from 'vitest'
import { normaliseMerchant } from './normalise-merchant'
import { categoriseByRules } from './rules-engine'
import type { Category } from '@/lib/parsers/types'

const CATEGORIES: Category[] = [
  { id: 'housing', name: 'Housing', description: null, examples: [], default_value_category: null },
  { id: 'groceries', name: 'Groceries', description: null, examples: [], default_value_category: null },
  { id: 'transport', name: 'Transport', description: null, examples: [], default_value_category: null },
  { id: 'utilities_bills', name: 'Utilities', description: null, examples: [], default_value_category: null },
  { id: 'eat_drinking_out', name: 'Eating Out', description: null, examples: [], default_value_category: null },
  { id: 'health', name: 'Health', description: null, examples: [], default_value_category: null },
  { id: 'subscriptions', name: 'Subscriptions', description: null, examples: [], default_value_category: null },
  { id: 'shopping', name: 'Shopping', description: null, examples: [], default_value_category: null },
  { id: 'travel', name: 'Travel', description: null, examples: [], default_value_category: null },
  { id: 'entertainment', name: 'Entertainment', description: null, examples: [], default_value_category: null },
  { id: 'personal_care', name: 'Personal Care', description: null, examples: [], default_value_category: null },
  { id: 'pets', name: 'Pets', description: null, examples: [], default_value_category: null },
  { id: 'savings_investments', name: 'Savings', description: null, examples: [], default_value_category: null },
  { id: 'debt_repayments', name: 'Debt', description: null, examples: [], default_value_category: null },
  { id: 'income', name: 'Income', description: null, examples: [], default_value_category: null },
  { id: 'transfers', name: 'Transfers', description: null, examples: [], default_value_category: null },
] as unknown as Category[]

describe('normaliseMerchant — UK bank noise', () => {
  it('strips Direct Debit reference suffixes', () => {
    expect(normaliseMerchant('HYPEROPTIC DD (Direct Debit) Reference: 1HYP000944081'))
      .toBe('hyperoptic')
  })

  it('strips Faster Payments reference suffixes', () => {
    expect(normaliseMerchant('ROBYN WELCH (Faster Payments) Reference: BIRTHDAY'))
      .toBe('robyn welch')
  })

  it('unwraps Non-Sterling Transaction Fee wrapper', () => {
    expect(normaliseMerchant('Non-Sterling Transaction Fee (Caprabo Madrid)'))
      .toContain('caprabo')
  })

  it('handles Revolut pot transfer', () => {
    expect(normaliseMerchant('Transfer to Pot')).toBe('transfer to pot')
  })

  it('strips trailing uppercase location', () => {
    const out = normaliseMerchant('PAN LAUDE MADRID GB')
    expect(out).toBe('pan laude')
  })

  it('leaves ordinary merchant names alone', () => {
    expect(normaliseMerchant('Mercadona')).toBe('mercadona')
    expect(normaliseMerchant('Starbucks')).toBe('starbucks')
  })
})

describe('categoriseByRules — smoke test against beta uncategorised merchants', () => {
  const cases: Array<{ desc: string; expected: string }> = [
    { desc: 'Popeyes London', expected: 'eat_drinking_out' },
    { desc: 'Caprabo Barcelona', expected: 'groceries' },
    { desc: 'Pan Laude Madrid', expected: 'eat_drinking_out' },
    { desc: 'HYPEROPTIC DD (Direct Debit) Reference: 1HYP0009', expected: 'utilities_bills' },
    { desc: 'Claude.ai Subscription', expected: 'subscriptions' },
    { desc: 'Supabase Inc', expected: 'subscriptions' },
    { desc: 'Perplexity AI', expected: 'subscriptions' },
    { desc: 'Playtomic Padel', expected: 'entertainment' },
    { desc: 'ZURICH ASSURANCE LTD', expected: 'utilities_bills' },
    { desc: 'MANCHESTER C C', expected: 'utilities_bills' },
    { desc: 'Transfer to Pot', expected: 'transfers' },
    { desc: 'To EUR', expected: 'transfers' },
    { desc: 'Withdrawal', expected: 'transfers' },
  ]

  for (const { desc, expected } of cases) {
    it(`${desc} → ${expected}`, () => {
      const res = categoriseByRules(desc, { categories: CATEGORIES })
      expect(res.categoryId).toBe(expected)
    })
  }

  it('at least 8/10 Phase-4 merchants match', () => {
    const sample = cases.slice(0, 10)
    const matched = sample.filter((c) => categoriseByRules(c.desc, { categories: CATEGORIES }).categoryId !== null)
    expect(matched.length).toBeGreaterThanOrEqual(8)
  })
})

describe('categoriseByRules — transaction-type + ES/CA coverage (Levers 2 & 3)', () => {
  const cases: Array<{ desc: string; expected: string }> = [
    // Tier 0: P2P marker is stripped by normaliseMerchant, so it must be read
    // from the raw description before normalisation.
    { desc: 'ROBYN WELCH (P2P Payment)', expected: 'transfers' },
    { desc: 'BENJAMIN COOKE (P2P Payment)', expected: 'transfers' },
    // Income / savings markers from the real uncategorised tail
    { desc: 'TRANSFERENCIA RECIBIDA NORDIC BRANDS AB', expected: 'income' },
    { desc: 'Fundsmith SIPP Contribution', expected: 'savings_investments' },
    // Spanish / Catalan merchants the keyword list now generalises over
    { desc: 'Bonpreu Gracia', expected: 'groceries' },
    { desc: 'Carniceria Lopez', expected: 'groceries' },
    { desc: 'Forn de Pa Sant Jordi', expected: 'groceries' },
    { desc: 'Vinoteca Torres', expected: 'eat_drinking_out' },
    { desc: 'La Central Libreria', expected: 'shopping' },
    // Spanish / PR cash & P2P movements (surfaced by staging)
    { desc: 'Retirada De Efectivo En Cajero Automatico 004923540000', expected: 'transfers' },
    { desc: 'BIZUM RECIBIDO: Bizum de Alessandro', expected: 'transfers' },
    { desc: 'ATH MOVIL OUT TO MAMI 7872210000', expected: 'transfers' },
    { desc: 'Transferencia Inmediata De Lewis Robert Frank Lonsdale', expected: 'transfers' },
    // More Spanish merchant generalisations
    { desc: 'Aena', expected: 'travel' },
    { desc: 'Cines Verdi Barcelona', expected: 'entertainment' },
    { desc: 'Farmàcia del Pas', expected: 'health' },
    { desc: 'RECIBO SANITAS SALUD', expected: 'health' },
  ]

  for (const { desc, expected } of cases) {
    it(`${desc} → ${expected}`, () => {
      expect(categoriseByRules(desc, { categories: CATEGORIES }).categoryId).toBe(expected)
    })
  }

  it('P2P detection survives normalisation that strips the (P2P Payment) tag', () => {
    // Sanity: the normaliser does remove the marker, proving Tier 0 must run first.
    expect(normaliseMerchant('ROBYN WELCH (P2P Payment)')).toBe('robyn welch')
  })
})
