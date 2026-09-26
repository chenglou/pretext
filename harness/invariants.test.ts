// The offline invariants (invariants.ts) in every engine profile, and faults no browser recording shows, each planted in
// a copy of src/: one for every check but coverage, round trip and asking Canvas nothing after preparing; and two faults
// `equal --offline` (offline-equal.ts) must see. The test name says what an app developer would see if it went unseen.
import { afterAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROFILES, type Profile } from './invariants.ts'

type Result = { profile: string; cases: number; failures: string[]; counts: Record<string, number> }

// Four children run at a time, each killed if it doesn't report within 10 s. watchdog.ts kills one past 1 GB, checking
// every 100 ms, which a library that allocates without end overruns by a few hundred MB: running away in all four, it
// took 5.3 GB with bun test itself. One that ends without its report stops the others, as the library under test may
// run away in them too, and the file's end kills any left: bun test leaves them running, and runs no exit handler, so a
// child whose bun test is gone is left to its watchdog. This process keeps the first MB of what each child writes. The
// planted copies of src/ are this process's own.
const running = new Set<Bun.Subprocess>()
let stopped = ''
const killAll = (why: string): void => {
  stopped ||= why
  for (const child of running) child.kill('SIGKILL')
}
const LIBS = join(import.meta.dir, '../.artifacts/harness-test-libs')
mkdirSync(LIBS, { recursive: true })
const libs = mkdtempSync(join(LIBS, 'invariants-'))
afterAll(() => {
  killAll('the test file ended')
  rmSync(libs, { recursive: true, force: true })
})
const waiting: Array<() => void> = []
let slots = 4

// The first MB of a child's output, read to the end so the child never waits on a full pipe.
async function head(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    if (size < 1 << 20) chunks.push(chunk)
    size += chunk.length
  }
  return Buffer.concat(chunks).subarray(0, 1 << 20).toString()
}

async function run<T = Result>(profile: Profile, lib?: string, args: string[] = [], script = 'invariants.ts'): Promise<T> {
  if (slots > 0) slots--
  else await new Promise<void>(resolve => waiting.push(resolve))
  const what = `${script} --profile=${profile}${lib === undefined ? '' : ` --lib=${lib}`}`
  try {
    // By length, or TypeScript takes `stopped` to stay '' across the await below, where another child may set it.
    if (stopped.length > 0) throw new Error(`${what} didn't start, as ${stopped}`)
    const child = Bun.spawn([process.execPath, join(import.meta.dir, script), `--profile=${profile}`, ...(lib === undefined ? [] : [`--lib=${lib}`]), ...args], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000, killSignal: 'SIGKILL' })
    running.add(child)
    const start = performance.now()
    const [out, err, code] = await Promise.all([head(child.stdout), head(child.stderr), child.exited])
    running.delete(child)
    if (code === 0) return JSON.parse(out) as T
    const how = child.signalCode === null ? `exited ${code}` : stopped !== '' ? `was stopped when ${stopped}` : performance.now() - start >= 10_000 ? 'ran over 10 s' : 'was killed'
    killAll(`${what} ${how}`)
    throw new Error(`${what} ${how}: ${err}`)
  } finally {
    const next = waiting.shift()
    if (next === undefined) slots++
    else next()
  }
}

// A copy of src/ with one defect planted, each pattern matching once in the code as it is now.
function planted(name: string, file: string, patches: ReadonlyArray<readonly [RegExp, string]>): string {
  const dir = join(libs, name)
  cpSync(join(import.meta.dir, '../src'), dir, { recursive: true, dereference: true })
  let source = readFileSync(join(dir, file), 'utf8')
  for (const [pattern, replacement] of patches) {
    const found = source.match(new RegExp(pattern.source, 'g'))?.length ?? 0
    if (found !== 1) throw new Error(`${name}: ${pattern} matches src/${file} ${found} times; plant the same defect in the code as it is now`)
    source = source.replace(pattern, replacement)
  }
  writeFileSync(join(dir, file), source)
  return dir
}

// Few draws: the fixed inputs and the growth recipes show each fault.
const LIGHT = ['--draws=40', '--rich=20']
const PLANTS: ReadonlyArray<readonly [string, Profile, string, string, ReadonlyArray<readonly [RegExp, string]>, string]> = [
  ['a list that keeps the cursor it passed to layoutNextLine would find it moved to the line end', 'unknown', 'cursor-moved', 'layout.ts',
    [[/return \{ text, width, start: lineStart, end \}/, 'start.segmentIndex = end.segmentIndex\n  start.graphemeIndex = end.graphemeIndex\n  return { text, width, start: lineStart, end }']], 'cursors'],
  ['a last line ending at segment Infinity would name no place in its text, and a JSON copy of that end start the paragraph again', 'unknown', 'infinite-end', 'layout.ts',
    [[/(const width = stepPreparedLineGeometryFromStart\(internal, lineEnd, maxWidth\)\n)/, '$1  if (width !== null && lineEnd.segmentIndex >= internal.widths.length) lineEnd.segmentIndex = Infinity\n']], 'agreement'],
  ['a virtualized list keeping the ranges layoutNextLineRange gives would find every start moved to the last line\'s', 'unknown', 'range-start-shared', 'layout.ts',
    [[/return width === null \? null : \{ width, start: lineStart, end \}/, 'return width === null ? null : { width, start: Object.assign(sharedRangeStart, lineStart), end }'],
      [/(export function layoutNextLineRange\()/, 'const sharedRangeStart = { segmentIndex: 0, graphemeIndex: 0 }\n$1']], 'cursors'],
  ['a rich fragment that ends its item at segment Infinity would name no place in the item\'s text', 'unknown', 'rich-infinite-end', 'rich-inline.ts',
    [[/(start: fragmentStart,\n\s*)end: fragmentEnd,/, '$1end: fragmentEnd.segmentIndex >= flow.items[itemIndex]!.prepared.segments.length ? { segmentIndex: Infinity, graphemeIndex: 0 } : fragmentEnd,']], 'agreement'],
  ['a visitor that edits the range walkLineRanges gives it would change the lines after it (p02)', 'unknown', 'walk-resumes-from-visited', 'layout.ts',
    [[/return walkPreparedLinesRaw\(\n\s*getInternalPrepared\(prepared\),\n\s*maxWidth,\n\s*\(width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex\) => \{\n\s*onLine\(createLayoutLineRange\([\s\S]*?\n\s*\)\)\n\s*\},\n\s*\)/,
      'let count = 0\n  for (let range = layoutNextLineRange(prepared, { segmentIndex: 0, graphemeIndex: 0 }, maxWidth); range !== null; range = layoutNextLineRange(prepared, range.end, maxWidth)) {\n    onLine(range)\n    count++\n  }\n  return count']], 'visitors'],
  ['a list keeping the ranges walkLineRanges visits would find one object, the last line, in every slot', 'unknown', 'walk-reuses-range', 'layout.ts',
    [[/onLine\(createLayoutLineRange\(([\s\S]*?)\n(\s*)\)\)/, 'onLine(Object.assign(walkedRange, createLayoutLineRange($1\n$2)))'],
      [/(export function walkLineRanges\([\s\S]*?\): number \{\n)/, '$1  const walkedRange = { width: 0, start: { segmentIndex: 0, graphemeIndex: 0 }, end: { segmentIndex: 0, graphemeIndex: 0 } }\n']], 'agreement'],
  ['a painter reading a field only layoutNextLine returns would get nothing from layoutWithLines', 'unknown', 'extra-line-field', 'layout.ts',
    [[/return \{ text, width, start: lineStart, end \}/, 'return { text, width, start: lineStart, end, hyphenated: false }']], 'line objects'],
  ['a held handle would move when the same text is prepared again with other letter spacing (p04)', 'blink', 'entry-geometry-in-place', 'layout.ts',
    [[/if \(geometry !== null && complete\) metrics\.entryGeometry = \{ letterSpacing, advances, emojiCorrection, geometry \}/,
      'if (geometry !== null && complete) {\n      if (metrics.entryGeometry !== undefined) {\n        Object.assign(metrics.entryGeometry.geometry, geometry)\n        Object.assign(metrics.entryGeometry, { letterSpacing, advances, emojiCorrection })\n        return metrics.entryGeometry.geometry\n      }\n      metrics.entryGeometry = { letterSpacing, advances, emojiCorrection, geometry }\n    }']], 'held handles'],
  ['a chip would be sized with its padding twice while its line stays right (p11)', 'unknown', 'extra-width-twice', 'rich-inline.ts',
    [[/collectWholeItem\(collectFragment, itemIndex, item, gapBefore, gapItemIndex, occupiedWidth\)/, 'collectWholeItem(collectFragment, itemIndex, item, gapBefore, gapItemIndex, occupiedWidth + item.extraWidth)']], 'rich lines'],
  ['a long word would measure every prefix, so preparing it grows with the square of its length (p08)', 'webkit', 'prefixes-uncapped', 'measurement.ts',
    [[/if \(mode === 'pair-context' \|\| graphemes\.length > MAX_PREFIX_FIT_GRAPHEMES\) \{/, 'if (mode === \'pair-context\' || MAX_PREFIX_FIT_GRAPHEMES < 0) {']], 'growth'],
  ['a message shown at two letter spacings would take the first one\'s fresh-line geometry at the second', 'blink', 'entry-geometry-ignores-letter-spacing', 'layout.ts',
    [[/cached\.letterSpacing === letterSpacing &&\n\s*cached\.advances === advances/, 'cached.advances === advances']], 'held handles'],
  ['a list streaming lines until layoutNextLineRange ends would never stop', 'unknown', 'stream-never-ends', 'layout.ts',
    [[/return width === null \? null : \{ width, start: lineStart, end \}/, 'return width === null ? { width: 0, start: { ...start }, end: { ...start } } : { width, start: lineStart, end }']], 'walkers end'],
]

// Each result's test reports it. A plant whose pattern no longer matches fails its own test only.
const reported = <T>(result: Promise<T>): Promise<T> => {
  result.catch(() => {})
  return result
}
const profiles = Object.keys(PROFILES) as Profile[]
const clean = new Map(profiles.map(profile => [profile, reported(run(profile))]))
const plants = PLANTS.map(([, profile, name, file, patches]) => reported(Promise.resolve().then(() => run(profile, planted(name, file, patches), LIGHT))))

describe('the line APIs offline, in every engine profile', () => {
  for (const profile of profiles) {
    test(`${profile}: every invariant holds on the drawn cases and the fixed inputs`, async () => {
      const result = await clean.get(profile)!
      expect(result.cases).toBeGreaterThan(500)
      expect(result.failures).toEqual([])
    }, 30_000)
  }
})

describe('equal --offline', () => {
  type Equal = { differ: number; parts: Record<string, number>; measuredOtherwise: number }
  const offline = (lib: string): Promise<Equal> => run<Equal>('unknown', undefined, [`--a=${join(import.meta.dir, '../src')}`, `--b=${lib}`, '--draws=500', '--rich=50', '--bench=none'], 'offline-equal.ts')
  test('line text every text API gets wrong alike differs, and a prepare that measures each segment twice is measured otherwise with the same results: a build that paints no hyphen at a soft-hyphen break would equal main, or one that measures more pass unseen', async () => {
    const [hyphen, twice] = await Promise.all([
      offline(planted('offline-hyphen', 'line-text.ts', [[/\? text \+ '-' : text/, '? text : text']])),
      offline(planted('offline-twice', 'measurement.ts', [[/width: ctx\.measureText\(seg\)\.width,/, 'width: (ctx.measureText(seg), ctx.measureText(seg).width),']])),
    ])
    expect([hyphen.differ > 0, hyphen.parts['prepareWithSegments'], hyphen.measuredOtherwise]).toEqual([true, undefined, 0])
    expect([twice.differ, twice.measuredOtherwise > 0]).toEqual([0, true])
  }, 30_000)
})

describe('planted faults', () => {
  for (let i = 0; i < PLANTS.length; i++) {
    const [title, , , , , check] = PLANTS[i]!
    test(`${title}: the ${check} check fails`, async () => {
      const result = await plants[i]!
      expect(result.counts[check] ?? 0).toBeGreaterThan(0)
    }, 30_000)
  }
})
