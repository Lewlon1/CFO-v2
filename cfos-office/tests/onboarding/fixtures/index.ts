import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, 'reads')

export function loadRead(name: string): string {
  return readFileSync(path.join(DIR, `${name}.txt`), 'utf-8')
}

export function listReads(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''))
}
