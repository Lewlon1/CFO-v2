import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'
import { truthTellerBalanced } from './truth-teller-balanced'
import { drifterExpat } from './drifter-expat'
import { anchorDebt } from './anchor-debt'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
  truthTellerBalanced,
  drifterExpat,
  anchorDebt,
] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
