import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, 'reads')

export function loadRead(name: string): string {
  const file = path.join(DIR, `${name}.txt`)
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`Could not load fixture "${name}" — expected ${file} to exist`)
  }
}

export function listReads(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''))
}
