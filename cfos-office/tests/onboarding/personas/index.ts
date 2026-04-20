import type { Persona } from './types'
import { builderClassic } from './builder-classic'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
