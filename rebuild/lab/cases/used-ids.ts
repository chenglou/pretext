// Every case id used so far, for sets that must hold only new cases: sealed sets (seal.ts) and fresh rounds (../fresh.ts).
//
// Sources, all read for ids only (the first 4 KB of each line):
// - every case file a run.json under .artifacts names (casesFile);
// - every .ndjson under .artifacts/lab/cases (the development and held-out files, giants.ndjson) and
//   .artifacts/lab/final-20260916/cases;
// - every .ndjson beside a SEAL.json (a sealed set, whether or not a run named its files);
// - every .ndjson in a `cases` folder under .artifacts/lab/fresh (a fresh round's set, run or not);
// - rebuild/lab/smoke-cases.ndjson.
// The census of 2026-09-16 observed all of main's suite once, in chunk files under census/cases/chunks; those chunks aren't
// excluded, or no suite case would be left. They are listed as `notExcluded`.
//
// generationLock serializes generators that exclude used ids, so two sets generated at the same time can't pick the same
// unused suite case: a set's files are complete before the next generator reads the used ids.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'

const REPO = resolve(import.meta.dir, '../../..')
const ARTIFACTS = join(REPO, '.artifacts')
// Directories that hold no case files a run used: browser profiles, virtualenvs and source caches.
const SKIP_DIRS = new Set(['profiles', 'venv', 'src-cache', 'node_modules', 'scratchpad-backup'])
const CENSUS_CHUNKS = '/research-20260916/census/cases/chunks/'
const FRESH = '/.artifacts/lab/fresh/'

function* walk(dir: string, skip: string | null): Generator<string> {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    if (path === skip) continue
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(path, skip)
    } else {
      yield path
    }
  }
}

// A run made in another worktree of this repository names its case files by that worktree's paths (the charter branch's
// ~/github/pretext-rebuild-charter, ceiling round 4's ~/github/pretext-rebuild-wt/<owner>), and worktrees go away. Every
// worktree shares one `.artifacts`, and `rebuild/` is the repository's, so a named file that is gone is looked up by its path
// from `.artifacts` or `rebuild` on, in this repository. A file that exists is taken as named.
export function inThisRepository(file: string, exists: (path: string) => boolean = existsSync): string {
  if (exists(file)) return file
  const match = /\/(\.artifacts|rebuild)\/.*$/.exec(file)
  if (match === null) return file
  const here = join(REPO, match[0])
  return exists(here) ? here : file
}

// Case ids of an NDJSON case file. Lines split on LF only (JSON strings can hold U+2028), and the id sits in a line's first
// 4 KB, so giant paragraphs cost nothing.
export function caseIdsOf(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const ids: string[] = []
  for (let start = 0; start < text.length;) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const match = /"id":"(c-[0-9a-f]{16})"/.exec(text.slice(start, Math.min(end, start + 4096)))
    if (match !== null) ids.push(match[1]!)
    start = end + 1
  }
  return ids
}

export type UsedIds = {
  ids: Set<string>
  sources: Array<{ path: string; ids: number }>
  // Census chunk files runs name, which aren't excluded.
  notExcluded: string[]
  // Case files a run names that are gone.
  missing: string[]
}

// `skip` is a directory left out of the walk (the set being generated). With `failOnMissing`, a run that names a case
// file that is gone throws; otherwise it is listed in `missing`.
export function collectUsedIds(options: { skip?: string | null; failOnMissing: boolean }): UsedIds {
  const sources = new Set<string>()
  const notExcluded = new Set<string>()
  for (const path of walk(ARTIFACTS, options.skip ?? null)) {
    if (path.endsWith('run.json')) {
      let casesFile: unknown
      try {
        casesFile = (JSON.parse(readFileSync(path, 'utf8')) as { casesFile?: unknown }).casesFile
      } catch {
        continue
      }
      if (typeof casesFile !== 'string') continue
      const file = inThisRepository(resolve(casesFile))
      if (options.skip != null && file.startsWith(`${options.skip}/`)) continue
      if (file.includes(CENSUS_CHUNKS)) notExcluded.add(file)
      else sources.add(file)
    } else if ((path.includes('/.artifacts/lab/cases/') || path.includes('/.artifacts/lab/final-20260916/cases/')) && path.endsWith('.ndjson')) {
      sources.add(path)
    } else if (path.includes(FRESH) && path.includes('/cases/') && path.endsWith('.ndjson')) {
      sources.add(path)
    } else if (path.endsWith('/SEAL.json')) {
      // Every earlier sealed set, whether or not a run named its files: its case files go in whole, read for ids only.
      const dir = resolve(path, '..')
      for (const name of readdirSync(dir)) if (name.endsWith('.ndjson')) sources.add(join(dir, name))
    }
  }
  sources.add(join(REPO, 'rebuild/lab/smoke-cases.ndjson'))
  const ids = new Set<string>()
  const list: UsedIds['sources'] = []
  const missing: string[] = []
  for (const file of [...sources].sort()) {
    if (!existsSync(file)) {
      if (options.failOnMissing) throw new Error(`A run names ${file}, which is gone`)
      missing.push(relative(REPO, file))
      continue
    }
    const found = caseIdsOf(file)
    for (let i = 0; i < found.length; i++) ids.add(found[i]!)
    list.push({ path: relative(REPO, file), ids: found.length })
  }
  return { ids, sources: list, notExcluded: [...notExcluded].sort().map(file => relative(REPO, file)), missing }
}

export function writeIdsFile(path: string, ids: ReadonlySet<string>): void {
  writeFileSync(path, [...ids].sort().map(id => `{"id":"${id}"}\n`).join(''))
}

// ---- Generation lock ----

const LOCK = join(ARTIFACTS, 'lab/fresh/.generate-lock')

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Runs `work` while holding the generation lock (a directory made with mkdir, with an owner file beside it). Waits while a
// live owner holds it and takes over a lock whose owner is dead. The owner file goes to the Trash on release.
export async function generationLock<T>(job: string, work: () => Promise<T> | T): Promise<T> {
  mkdirSync(resolve(LOCK, '..'), { recursive: true })
  const owner = `${LOCK}.owner`
  const started = Date.now()
  for (;;) {
    try {
      mkdirSync(LOCK)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let pid: number | null = null
      try {
        pid = (JSON.parse(readFileSync(owner, 'utf8')) as { pid: number }).pid
      } catch {
        pid = null
      }
      // An owner file appears right after the directory; a lock without one for 10 s belongs to nobody.
      const stale = pid === null ? Date.now() - started > 10000 : !alive(pid)
      if (stale) {
        console.error(`[generate-lock] taking over from ${pid === null ? 'an owner that never wrote its file' : `dead owner pid ${pid}`}`)
        break
      }
      if (Date.now() - started > 30 * 60000) throw new Error(`generation lock held by pid ${pid} for 30 minutes`)
      await Bun.sleep(500)
    }
  }
  writeFileSync(owner, `${JSON.stringify({ job, pid: process.pid, at: new Date().toISOString() })}\n`)
  try {
    return await work()
  } finally {
    spawnSync('trash', [owner])
    try {
      rmdirSync(LOCK)
    } catch {
      // Another process took the lock over; nothing to release.
    }
  }
}
