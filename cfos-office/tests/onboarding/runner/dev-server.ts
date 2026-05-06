import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const DEV_SERVER_URL = 'http://localhost:3000'
const STARTUP_TIMEOUT_MS = 60_000

export interface DevServerHandle {
  url: string
  stop: () => Promise<void>
  spawned: boolean
}

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(2000) })
    return res.status < 500
  } catch {
    return false
  }
}

async function waitForReady(startedAt: number): Promise<void> {
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (await isServerRunning()) return
    await sleep(500)
  }
  throw new Error(`Dev server did not become ready within ${STARTUP_TIMEOUT_MS}ms at ${DEV_SERVER_URL}`)
}

export async function ensureDevServer(): Promise<DevServerHandle> {
  if (await isServerRunning()) {
    return {
      url: DEV_SERVER_URL,
      stop: async () => {},
      spawned: false,
    }
  }

  const child: ChildProcess = spawn('npx', ['next', 'dev'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  child.stdout?.on('data', () => {})
  child.stderr?.on('data', (buf) => {
    const msg = buf.toString()
    if (msg.toLowerCase().includes('error')) {
      process.stderr.write(`[dev-server] ${msg}`)
    }
  })

  const startedAt = Date.now()
  try {
    await waitForReady(startedAt)
  } catch (err) {
    child.kill('SIGTERM')
    throw err
  }

  return {
    url: DEV_SERVER_URL,
    spawned: true,
    stop: async () => {
      if (!child.killed) {
        child.kill('SIGTERM')
        await sleep(1500)
        if (!child.killed) child.kill('SIGKILL')
      }
    },
  }
}
