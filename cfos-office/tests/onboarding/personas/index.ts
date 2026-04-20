import type { Persona } from './types'

// Personas are registered here as they are added.
// Imports and array entries are added task-by-task.

export const PERSONAS: readonly Persona[] = [] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
