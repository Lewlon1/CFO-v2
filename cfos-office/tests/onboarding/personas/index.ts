import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'
import { truthTellerBalanced } from './truth-teller-balanced'
import { drifterExpat } from './drifter-expat'
import { anchorDebt } from './anchor-debt'
import { skipValueMap } from './skip-value-map'
import { skipCsvUpload } from './skip-csv-upload'
import { timeSaverExpert } from './time-saver-expert'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
  truthTellerBalanced,
  drifterExpat,
  anchorDebt,
  skipValueMap,
  skipCsvUpload,
  timeSaverExpert,
] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
