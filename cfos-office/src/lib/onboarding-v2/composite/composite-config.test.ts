// OB-1d — composite config tests. The v1 personas are the spec: a failing
// test after a composite-config.ts edit means the edit needed a NEW config
// version. (Voice guards live in ../onboarding-copy-voice.test.ts.)

import { describe, expect, it } from 'vitest'
import { DOOR_FAMILIES } from '../door/door-config'
import {
  COMPOSITE_CARD_HEADING,
  COMPOSITE_CONFIG_VERSION,
  COMPOSITE_PERSONAS,
  COMPOSITE_TRUER_PLACEHOLDER,
  COMPOSITE_TRUER_PROMPT,
  RELATE_OPTIONS,
  compositeCardLabel,
  type CompositeCountry,
} from './composite-config'

const COUNTRIES: readonly CompositeCountry[] = ['GB', 'ES']

describe('composite config — v1 pinned content', () => {
  it('pins the config version', () => {
    expect(COMPOSITE_CONFIG_VERSION).toBe('v1')
  })

  it('has a persona for every family in both countries', () => {
    for (const family of DOOR_FAMILIES) {
      for (const country of COUNTRIES) {
        const persona = COMPOSITE_PERSONAS[family][country]
        expect(persona).toBeDefined()
        expect(persona.key).toBe(`${family}_${country.toLowerCase()}`)
        expect(persona.name.length).toBeGreaterThan(0)
        expect(persona.age).toBeGreaterThan(0)
        expect(persona.city.length).toBeGreaterThan(0)
      }
    }
  })

  it('gives every persona exactly four non-empty bullets', () => {
    for (const family of DOOR_FAMILIES) {
      for (const country of COUNTRIES) {
        const { bullets } = COMPOSITE_PERSONAS[family][country]
        expect(bullets).toHaveLength(4)
        for (const bullet of bullets) {
          expect(bullet.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('bakes the right currency symbol in (£ for GB, € for ES, never the other)', () => {
    for (const family of DOOR_FAMILIES) {
      const gb = COMPOSITE_PERSONAS[family].GB.bullets.join(' ')
      const es = COMPOSITE_PERSONAS[family].ES.bullets.join(' ')
      expect(gb).toContain('£')
      expect(gb).not.toContain('€')
      expect(es).toContain('€')
      expect(es).not.toContain('£')
    }
  })

  it('applies the delivery merchant skin (growth: Deliveroo GB / Glovo ES)', () => {
    const gb = COMPOSITE_PERSONAS.growth.GB.bullets.join(' ')
    const es = COMPOSITE_PERSONAS.growth.ES.bullets.join(' ')
    expect(gb).toContain('Deliveroo')
    expect(gb).not.toContain('Glovo')
    expect(es).toContain('Glovo')
    expect(es).not.toContain('Deliveroo')
  })

  it('applies the energy merchant skin (candor: Octopus GB / Iberdrola ES)', () => {
    const gb = COMPOSITE_PERSONAS.candor.GB.bullets.join(' ')
    const es = COMPOSITE_PERSONAS.candor.ES.bullets.join(' ')
    expect(gb).toContain('Octopus')
    expect(gb).not.toContain('Iberdrola')
    expect(es).toContain('Iberdrola')
    expect(es).not.toContain('Octopus')
  })

  it('frames the fourth bullet as the kind of move, never a real outcome', () => {
    for (const family of DOOR_FAMILIES) {
      for (const country of COUNTRIES) {
        const fourth = COMPOSITE_PERSONAS[family][country].bullets[3]
        expect(fourth.startsWith('The kind of move that fixes it:')).toBe(true)
      }
    }
  })

  it('pins the card heading and the honesty label', () => {
    expect(COMPOSITE_CARD_HEADING).toBe('Someone in your situation')
    expect(compositeCardLabel('Callum')).toBe(
      '"Callum" is a sketch, not a client — a composite drawn to match situations like yours.',
    )
  })

  it('compositeCardLabel interpolates whatever name it is given', () => {
    for (const family of DOOR_FAMILIES) {
      for (const country of COUNTRIES) {
        const { name } = COMPOSITE_PERSONAS[family][country]
        const label = compositeCardLabel(name)
        expect(label).toContain(`"${name}"`)
        expect(label).toContain('a sketch, not a client')
      }
    }
  })

  it('pins the relate chips', () => {
    expect(RELATE_OPTIONS).toEqual([
      { id: 'spot_on', label: 'Spot on' },
      { id: 'close', label: 'Close enough' },
      { id: 'not_me', label: 'Not really me' },
    ])
  })

  it('pins the truer-line prompt and placeholder', () => {
    expect(COMPOSITE_TRUER_PROMPT).toBe(
      'One line — what would make your version truer?',
    )
    expect(COMPOSITE_TRUER_PLACEHOLDER).toBe(
      "e.g. 'mine's worse since the rent went up'",
    )
  })
})
