// Splitting case files for parallel browser jobs, and the giants rule.
//
// A giant is a case whose paragraph text exceeds GIANT_UNITS UTF-16 units. Giants stalled round 2's jobs (one case can take
// minutes), so they never sit in a routine case file or a part: they go in their own set, run exclusively with --chunk=1
// (lab/README.md, "Giants"). Parts are contiguous slices in file order, so a part keeps the file's page contexts together
// and a part's cases keep their relative order; slices balance text length, not case count.
import { readFileSync, writeFileSync } from 'node:fs'
import type { BrowserKind, Case } from '../types.ts'

export const GIANT_UNITS = 50000

export type CaseLine = {
  // The case's line exactly as the file holds it, without the line feed.
  line: string
  // Its index among the file's non-empty lines.
  index: number
  id: string
  family: string
  units: number
  browsers: BrowserKind[] | null
}

function paragraphUnits(value: Case): number {
  let units = 0
  for (let i = 0; i < value.paragraph.runs.length; i++) units += value.paragraph.runs[i]!.text.length
  return units
}

// Lines split on LF only: JSON strings can hold U+2028 and U+2029, which other line readers split on.
export function readCaseLines(path: string): CaseLine[] {
  const lines = readFileSync(path, 'utf8').split('\n')
  const out: CaseLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    const value = JSON.parse(line) as Case
    out.push({ line, index: out.length, id: value.id, family: value.family, units: paragraphUnits(value), browsers: value.browsers ?? null })
  }
  return out
}

export function writeCaseLines(path: string, lines: readonly CaseLine[]): void {
  let text = ''
  for (let i = 0; i < lines.length; i++) text += `${lines[i]!.line}\n`
  writeFileSync(path, text)
}

export function isGiant(value: { units: number }): boolean {
  return value.units > GIANT_UNITS
}

// Whether run.ts runs the case in this browser: webkit-host takes Safari's cases.
export function appliesTo(value: { browsers: BrowserKind[] | null }, browser: BrowserKind): boolean {
  return value.browsers === null || value.browsers.includes(browser === 'webkit-host' ? 'safari' : browser)
}

// At most `count` contiguous slices of near-equal weight, none empty. A case weighs its text length plus a constant for
// the per-case work that doesn't depend on length.
export function contiguousParts<T extends { units: number }>(items: readonly T[], count: number): T[][] {
  const n = Math.max(1, Math.min(count, items.length))
  const weight = (item: T): number => 400 + item.units
  let total = 0
  for (let i = 0; i < items.length; i++) total += weight(items[i]!)
  const parts: T[][] = []
  let current: T[] = []
  let sum = 0
  for (let i = 0; i < items.length; i++) {
    current.push(items[i]!)
    sum += weight(items[i]!)
    const left = items.length - i - 1
    const partsLeft = n - parts.length - 1
    // Close the slice once it reaches its share, or when every case left is needed to keep the later slices non-empty.
    if (partsLeft > 0 && (sum >= (total * (parts.length + 1)) / n || left === partsLeft)) {
      parts.push(current)
      current = []
    }
  }
  if (current.length > 0) parts.push(current)
  return parts
}

// ---- Command line ----
//
//   bun rebuild/lab/cases/parts.ts --cases=<cases.ndjson> --parts=N --out-dir=<dir> [--browser=<browser>]
//
// Writes <out-dir>/<name>-part-NN.ndjson, and <name>-giants.ndjson when the file holds giants, and prints counts only (no id,
// family or text), so it can split a sealed file. With --browser, cases that don't apply to that browser are left out.
if (import.meta.main) {
  const { mkdirSync } = await import('node:fs')
  const { basename, join, resolve } = await import('node:path')
  const args = new Map<string, string>()
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null || !['cases', 'parts', 'out-dir', 'browser'].includes(match[1]!)) throw new Error(`Unknown argument ${raw}`)
    args.set(match[1]!, match[2]!)
  }
  const cases = args.get('cases')
  const outDir = args.get('out-dir')
  const count = Number(args.get('parts') ?? 3)
  if (cases === undefined || outDir === undefined || !Number.isInteger(count) || count <= 0) throw new Error('Usage: parts.ts --cases=<cases.ndjson> --parts=N --out-dir=<dir> [--browser=<browser>]')
  const browser = args.get('browser') as BrowserKind | undefined
  mkdirSync(resolve(outDir), { recursive: true })
  const name = basename(cases).replace(/\.ndjson$/, '')
  const lines = readCaseLines(resolve(cases)).filter(line => browser === undefined || appliesTo(line, browser))
  const routine = lines.filter(line => !isGiant(line))
  const giants = lines.filter(isGiant)
  const parts = contiguousParts(routine, count)
  for (let p = 0; p < parts.length; p++) {
    const file = join(resolve(outDir), `${name}-part-${String(p + 1).padStart(2, '0')}.ndjson`)
    writeCaseLines(file, parts[p]!)
    console.log(`${file}: ${parts[p]!.length} cases`)
  }
  if (giants.length > 0) {
    const file = join(resolve(outDir), `${name}-giants.ndjson`)
    writeCaseLines(file, giants)
    console.log(`${file}: ${giants.length} giants (run exclusively with --chunk=1)`)
  }
}
