import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
