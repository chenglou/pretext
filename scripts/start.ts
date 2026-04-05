import { execFileSync, spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 3000
const DEFAULT_HOST = '127.0.0.1'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function listHtmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => join(dir, entry.name))
    .sort()
}

function listNestedIndexFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(dir, entry.name, 'index.html'))
    .sort()
}

export function getServeEntries(cwd: string = process.cwd()): string[] {
  const pagesDir = join(cwd, 'pages')
  const demosDir = join(pagesDir, 'demos')
  return [
    ...listHtmlFiles(pagesDir),
    ...listHtmlFiles(demosDir),
    ...listNestedIndexFiles(demosDir),
  ]
}

function getListeningPids(port: number): number[] {
  if (process.platform === 'win32') {
    return []
  }

  try {
    const output = execFileSync('lsof', ['-tiTCP:' + String(port), '-sTCP:LISTEN'], {
      encoding: 'utf8',
    }).trim()

    if (output === '') return []

    return [...new Set(
      output
        .split('\n')
        .map(line => Number.parseInt(line, 10))
        .filter(pid => Number.isFinite(pid)),
    )]
  } catch {
    return []
  }
}

function tryKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // Ignore races where the process exited between lookup and kill.
  }
}

async function freePort(port: number): Promise<void> {
  let pids = getListeningPids(port)
  if (pids.length === 0) return

  console.log(`Freeing port ${port}: terminating ${pids.join(', ')}`)
  for (const pid of pids) {
    tryKill(pid, 'SIGTERM')
  }

  for (let i = 0; i < 20; i++) {
    await sleep(100)
    pids = getListeningPids(port)
    if (pids.length === 0) return
  }

  console.log(`Port ${port} still busy: killing ${pids.join(', ')}`)
  for (const pid of pids) {
    tryKill(pid, 'SIGKILL')
  }

  for (let i = 0; i < 20; i++) {
    await sleep(100)
    pids = getListeningPids(port)
    if (pids.length === 0) return
  }

  throw new Error(`Failed to free port ${port}; still listening: ${pids.join(', ')}`)
}

export function getServeCommandArgs(options?: { cwd?: string; host?: string; watch?: boolean }): string[] {
  const host = options?.host ?? process.env['HOST'] ?? DEFAULT_HOST
  const watch = options?.watch ?? process.argv.includes('--watch')
  const args = [...getServeEntries(options?.cwd)]

  if (watch) {
    args.push('--watch', '--no-clear-screen')
  }

  args.push(`--host=${host}:${PORT}`)
  return args
}

async function main(): Promise<void> {
  await freePort(PORT)

  const child = spawn('bun', getServeCommandArgs(), {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  child.on('error', error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
