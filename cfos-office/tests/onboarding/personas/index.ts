import type { Persona } from './types'
import { builderClassic } from './builder-classic'
import { fortressSaver } from './fortress-saver'
import { truthTellerBalanced } from './truth-teller-balanced'
import { drifterExpat } from './drifter-expat'
import { anchorDebt } from './anchor-debt'
import { timeSaverExpert } from './time-saver-expert'
import { aikoLowTransaction } from './aiko-low-transaction'
import { sofiaChaotic } from './sofia-chaotic'
import { tomLongHistory } from './tom-long-history'
import { zaneSpain } from './zane-spain'
import { skipUploadDeclared } from './skip-upload-declared'

export const PERSONAS: readonly Persona[] = [
  builderClassic,
  fortressSaver,
  truthTellerBalanced,
  drifterExpat,
  anchorDebt,
  timeSaverExpert,
  // Session 32 (C) — first-Read calibration personas. Each targets a
  // failure mode the existing suite didn't cover. See
  // docs/audits/2026-05-26-session-32C.md for the coverage decisions.
  aikoLowTransaction,
  sofiaChaotic,
  tomLongHistory,
  zaneSpain,
  // Optional-upload path: exercises the "I don't have a statement handy"
  // skip branch added to the upload-intro beat. No CSV; declared Read only.
  skipUploadDeclared,
] as const

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

export function personaIds(): string[] {
  return PERSONAS.map((p) => p.id)
}
