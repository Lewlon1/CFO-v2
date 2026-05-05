// Shared formatters used by the v3 evidence detectors. Kept tiny —
// formatting only, no DB / model logic.

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? '' : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

export function countWord(n: number): string {
  switch (n) {
    case 2:
      return 'twice'
    case 3:
      return 'three times'
    case 4:
      return 'four times'
    case 5:
      return 'five times'
    default:
      return `${n} times`
  }
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  const day = d.getUTCDate()
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  return `${day} ${month}`
}

// Returns the union of common renderings the model might produce for an
// amount: fixed-decimal, rounded, with currency symbol prefix/suffix, and
// the comma-decimal Spanish rendering.
export function amountForms(amount: number, symbol: string): string[] {
  const fixed = amount.toFixed(2)
  const intPart = String(Math.round(amount))
  const forms = new Set<string>([
    fixed,
    intPart,
    `${symbol}${fixed}`,
    `${symbol}${intPart}`,
    `${fixed}${symbol}`,
    `${intPart}${symbol}`,
  ])
  const fixedComma = fixed.replace('.', ',')
  forms.add(fixedComma)
  forms.add(`${symbol}${fixedComma}`)
  return Array.from(forms)
}

// Day-of-week name from ISO date (UTC). Used for cluster framings.
export function dayName(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return ''
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]
}
