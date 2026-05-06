export interface CliArgs {
  personas: string[] | null      // null = run all
  skipJudge: boolean
  keepUsers: boolean
  concurrency: number
  noUnit: boolean
  runId: string | null
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    personas: null,
    skipJudge: false,
    keepUsers: false,
    concurrency: 2,
    noUnit: false,
    runId: null,
  }

  function consumeValue(i: number, flag: string): { value: string; skip: number } {
    const current = argv[i]
    const eqIdx = current.indexOf('=')
    if (eqIdx >= 0) return { value: current.slice(eqIdx + 1), skip: 0 }
    if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`)
    return { value: argv[i + 1], skip: 1 }
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const base = a.split('=')[0]
    switch (base) {
      case '--personas': {
        const { value, skip } = consumeValue(i, '--personas')
        out.personas = value.split(',').map((s) => s.trim()).filter(Boolean)
        i += skip
        break
      }
      case '--skip-judge':
        out.skipJudge = true
        break
      case '--keep-users':
        out.keepUsers = true
        break
      case '--concurrency': {
        const { value, skip } = consumeValue(i, '--concurrency')
        const n = Number(value)
        if (!Number.isFinite(n) || n < 1) throw new Error(`--concurrency requires a positive number, got "${value}"`)
        out.concurrency = n
        i += skip
        break
      }
      case '--no-unit':
        out.noUnit = true
        break
      case '--run-id': {
        const { value, skip } = consumeValue(i, '--run-id')
        out.runId = value
        i += skip
        break
      }
      default:
        if (a.startsWith('--')) {
          throw new Error(`Unknown flag: ${a}`)
        }
        break
    }
  }

  return out
}
