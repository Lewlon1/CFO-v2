// Stub — CSV column detection will be implemented in Session 3
export interface ColumnMapping {
  date?: string
  description?: string
  amount?: string
  currency?: string
}

export function detectColumnMapping(_headers: string[]): ColumnMapping {
  return {}
}

export function isMappingHighConfidence(_mapping: ColumnMapping): boolean {
  return false
}
