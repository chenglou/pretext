import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { font, paragraph, text } from './build.ts'
import { makeCase } from './case.ts'
import { familyWidthCases } from './family-widths.ts'
import { appliesTo, contiguousParts, GIANT_UNITS, isGiant, readCaseLines } from './parts.ts'
import { caseIdsOf, inThisRepository } from './used-ids.ts'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function sample(value: string, width: number, browsers?: ['chrome'] | ['safari']): ReturnType<typeof makeCase> {
  return makeCase({ family: 'test/parts', origin: 'test', pageLang: 'en', paragraph: { ...paragraph({ font: font('Arial', 16), lang: 'en' }, [text(value)]), width }, browsers })
}

test('contiguous parts keep file order, leave no part empty and balance text length', () => {
  const items = [100, 100, 100, 100, 5000, 100, 100, 100].map((units, index) => ({ units, index }))
  const parts = contiguousParts(items, 3)
  expect(parts.length).toBe(3)
  expect(parts.flat().map(item => item.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  for (const part of parts) expect(part.length).toBeGreaterThan(0)
  // The long case ends the first part instead of dragging three more short ones with it.
  expect(parts[0]!.map(item => item.index)).toEqual([0, 1, 2, 3, 4])
  expect(contiguousParts(items.slice(0, 2), 5).length).toBe(2)
  expect(contiguousParts([], 3)).toEqual([])
})

test('case lines split on line feeds only, count UTF-16 units and keep each line as written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab-parts-'))
  const file = join(dir, 'cases.ndjson')
  const separator = makeCase({ family: 'test/parts', origin: 'test', pageLang: 'en', paragraph: { ...paragraph({ font: font('Arial', 16), lang: 'en', whiteSpace: 'pre-wrap' }, [text(`a${String.fromCharCode(0x2028)}b${String.fromCodePoint(0x1f600)}`)]), width: 50 } })
  const giant = sample('x'.repeat(GIANT_UNITS + 1), 300, ['chrome'])
  const edge = sample('y'.repeat(GIANT_UNITS), 300, ['safari'])
  writeFileSync(file, `${JSON.stringify(separator)}\n\n${JSON.stringify(giant)}\n${JSON.stringify(edge)}\n`)
  const lines = readCaseLines(file)
  expect(lines.map(line => line.id)).toEqual([separator.id, giant.id, edge.id])
  expect(lines.map(line => line.index)).toEqual([0, 1, 2])
  expect(lines[0]!.units).toBe(5)
  expect(lines[0]!.line).toBe(JSON.stringify(separator))
  expect(lines.map(isGiant)).toEqual([false, true, false])
  expect(caseIdsOf(file)).toEqual([separator.id, giant.id, edge.id])
  // webkit-host takes Safari's cases.
  expect(appliesTo(lines[1]!, 'webkit-host')).toBe(false)
  expect(appliesTo(lines[2]!, 'webkit-host')).toBe(true)
  expect(appliesTo(lines[0]!, 'firefox')).toBe(true)
})

test('family widths are seeded, new, near or between the derived brackets, and keep slot paragraphs above their floor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab-family-widths-'))
  const derived = (role: string, width: number): ReturnType<typeof makeCase> => makeCase({
    family: 'rule/test', origin: `rule-family=test paragraph=p-0123456789abcdef role=${role} target=0:4`, pageLang: 'en',
    paragraph: { ...paragraph({ font: font('Arial', 16), lang: 'en' }, [text('aaaa bbbb cccc')]), width }, browsers: ['chrome'],
  })
  const cases = [derived('A-normal', 1), derived('B', 100000), derived('reach', 40), derived('short', 39.984375), derived('reach', 80)]
  writeFileSync(join(dir, 'family-cases.ndjson'), cases.map(value => `${JSON.stringify(value)}\n`).join(''))
  const first = familyWidthCases('seed-a', [dir], 6, new Set())
  const again = familyWidthCases('seed-a', [dir], 6, new Set())
  const other = familyWidthCases('seed-b', [dir], 6, new Set())
  expect(first.paragraphs).toBe(1)
  expect(first.cases.map(value => value.id)).toEqual(again.cases.map(value => value.id))
  expect(first.cases.map(value => value.id)).not.toEqual(other.cases.map(value => value.id))
  const known = new Set(cases.map(value => value.id))
  for (const value of first.cases) {
    expect(known.has(value.id)).toBe(false)
    expect(value.family).toBe('rule/test')
    expect(value.browsers).toEqual(['chrome'])
    expect(value.paragraph.width).toBeGreaterThanOrEqual(39.984375 - 2)
    expect(value.paragraph.width).toBeLessThanOrEqual(80 + 2)
    expect(value.paragraph.width * 64).toBe(Math.round(value.paragraph.width * 64))
  }
  // A used id is never produced again.
  const used = new Set(first.cases.map(value => value.id))
  const beside = familyWidthCases('seed-a', [dir], 6, used)
  for (const value of beside.cases) expect(used.has(value.id)).toBe(false)
  // The same seed draws the used widths first, so the generator says how often it drew again; nothing used met none.
  expect(beside.usedDraws).toBeGreaterThan(0)
  expect(first.usedDraws).toBe(0)
})

test('a case file named by a worktree that is gone is found in this repository', () => {
  const here = (path: string): boolean => path.startsWith(`${REPO_ROOT}/`)
  // Another worktree's path to the shared artifacts, and to a file of the repository.
  expect(inThisRepository('/Users/x/github/pretext-rebuild-wt/tests/.artifacts/lab/cases/runs.ndjson', here)).toBe(`${REPO_ROOT}/.artifacts/lab/cases/runs.ndjson`)
  expect(inThisRepository('/Users/x/github/pretext-rebuild-charter/rebuild/lab/smoke-cases.ndjson', here)).toBe(`${REPO_ROOT}/rebuild/lab/smoke-cases.ndjson`)
  // A file that exists is taken as named, and one that is nowhere stays as named, so the registry can report it missing.
  expect(inThisRepository(`${REPO_ROOT}/.artifacts/lab/cases/ws.ndjson`, here)).toBe(`${REPO_ROOT}/.artifacts/lab/cases/ws.ndjson`)
  expect(inThisRepository('/tmp/elsewhere/cases.ndjson', here)).toBe('/tmp/elsewhere/cases.ndjson')
  expect(inThisRepository('/Users/x/other/.artifacts/gone.ndjson', () => false)).toBe('/Users/x/other/.artifacts/gone.ndjson')
  // A named file that is a link into a worktree that is gone: the link's target is found in this repository, a relative
  // target from the link's folder, and a link to nowhere stays as named.
  const links: Record<string, string> = {
    [`${REPO_ROOT}/.artifacts/evaluate/final/family-cases.ndjson`]: '/Users/x/github/pretext-rebuild-charter/.artifacts/tests/final/family-cases.ndjson',
    [`${REPO_ROOT}/.artifacts/evaluate/final/relative.ndjson`]: '../../tests/final/family-cases.ndjson',
    [`${REPO_ROOT}/.artifacts/evaluate/final/nowhere.ndjson`]: '/tmp/elsewhere/cases.ndjson',
  }
  const notLinks = (path: string): boolean => here(path) && links[path] === undefined
  const target = (path: string): string | null => links[path] ?? null
  expect(inThisRepository(`${REPO_ROOT}/.artifacts/evaluate/final/family-cases.ndjson`, notLinks, target)).toBe(`${REPO_ROOT}/.artifacts/tests/final/family-cases.ndjson`)
  expect(inThisRepository(`${REPO_ROOT}/.artifacts/evaluate/final/relative.ndjson`, notLinks, target)).toBe(`${REPO_ROOT}/.artifacts/tests/final/family-cases.ndjson`)
  expect(inThisRepository(`${REPO_ROOT}/.artifacts/evaluate/final/nowhere.ndjson`, notLinks, target)).toBe(`${REPO_ROOT}/.artifacts/evaluate/final/nowhere.ndjson`)
})
