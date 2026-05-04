import { describe, expect, it } from 'vitest'
import { TEMPLATES, currencySymbol, substitute, toTitleCase } from '../observation-templates'

describe('substitute', () => {
  it('fills single placeholders', () => {
    expect(substitute('Hello {name}', { name: 'world' })).toBe('Hello world')
  })

  it('fills multiple placeholders including the same key twice', () => {
    expect(substitute('{a} + {a} = {b}', { a: '1', b: '2' })).toBe('1 + 1 = 2')
  })

  it('throws on unfilled placeholders', () => {
    expect(() => substitute('Hello {missing}', {})).toThrow(/Unfilled.*missing/)
  })

  it('throws on null/undefined values', () => {
    expect(() => substitute('Hello {x}', { x: null })).toThrow(/Null\/undefined.*x/)
    expect(() => substitute('Hello {x}', { x: undefined })).toThrow(/Null\/undefined.*x/)
  })

  it('coerces numbers and booleans to strings', () => {
    expect(substitute('{n} items, {flag}', { n: 5, flag: true })).toBe('5 items, true')
  })
})

describe('TEMPLATES', () => {
  it('has all three v1 templates wired', () => {
    expect(TEMPLATES['high_freq_merchant.rhythm']).toBeDefined()
    expect(TEMPLATES['category_variance.discipline_eats_joy']).toBeDefined()
    expect(TEMPLATES['time_pattern.weekend_clock']).toBeDefined()
  })

  it('every template has at least 2 pattern_name_options', () => {
    for (const [, tpl] of Object.entries(TEMPLATES)) {
      expect(tpl.pattern_name_options.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('high_freq_merchant.rhythm renders end-to-end with a merchant name', () => {
    const tpl = TEMPLATES['high_freq_merchant.rhythm']
    const payload = { merchant_name: 'Pret' }
    expect(tpl.pattern_name_options.every((opt) => opt.includes('{merchant_name}'))).toBe(true)
    expect(substitute(tpl.question_template, payload)).toContain('Pret')
    expect(substitute(tpl.experiment_template, payload)).toContain('Pret')
  })

  it('category_variance.discipline_eats_joy renders with locked share + currency', () => {
    const tpl = TEMPLATES['category_variance.discipline_eats_joy']
    const payload = { locked_share: 82, currency_symbol: '£', locked_category_label: 'necessities' }
    const question = substitute(tpl.question_template, payload)
    expect(question).toContain('82%')
    expect(question).toContain('£')
  })

  it('experiment templates contain noticing language, not behaviour-change verbs', () => {
    // Words that are unambiguously directive in the second person ("you should
    // cancel", "consider switching"). Words like "stop" are excluded because
    // they appear in noticing-style observations of user behaviour ("when you
    // almost spend and stop, jot it down") — that's the inverse of a directive.
    const forbidden = /\b(cancel|switch|consider|reduce)\b/i
    for (const [key, tpl] of Object.entries(TEMPLATES)) {
      expect(tpl.experiment_template, `template ${key}`).not.toMatch(forbidden)
    }
  })
})

describe('currencySymbol', () => {
  it('maps the three primary currencies', () => {
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('USD')).toBe('$')
  })

  it('falls back to "<code> " for unknown codes', () => {
    expect(currencySymbol('CHF')).toBe('CHF ')
  })
})

describe('toTitleCase', () => {
  it('capitalises single words', () => {
    expect(toTitleCase('amazon')).toBe('Amazon')
  })
  it('capitalises multi-word strings', () => {
    expect(toTitleCase('uber eats')).toBe('Uber Eats')
  })
  it('returns empty for empty input', () => {
    expect(toTitleCase('')).toBe('')
  })
})
