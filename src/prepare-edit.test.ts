import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'

// Small targeted cases for prepareEdit(). The random differential lives in
// scripts/edit-differential.ts.

type LayoutModule = typeof import('./layout.ts')
type EditModule = typeof import('./prepare-edit.ts')
type PrepareOptions = import('./layout.ts').PrepareOptions

const FONT = '16px Test'
let L: LayoutModule
let E: EditModule

class TestContext {
  font = ''
  measureText(text: string): { width: number } {
    let width = 0
    for (const ch of text) width += ch === ' ' ? 4 : /\p{Default_Ignorable_Code_Point}/u.test(ch) ? 0 : 10
    return { width }
  }
}

beforeAll(async () => {
  if (!('OffscreenCanvas' in globalThis)) {
    Reflect.set(globalThis, 'OffscreenCanvas', class { getContext() { return new TestContext() } })
  }
  ;[L, E] = await Promise.all([import('./layout.ts'), import('./prepare-edit.ts')])
})

beforeEach(() => {
  L.setLocale(undefined)
})

const base = Array.from({ length: 12 }, (_, i) => `Sentence ${i} has some words, e.g. don't stop.`).join(' ')

// Each text is an edit of the one before it.
const EDITS = [
  base,
  base.replace('Sentence 5 has', 'Sentence 5 hasx'),
  base.replace('Sentence 5 has', 'Sentence 5 h'),
  base.replace('Sentence 5 has', 'Sentence 5 pasted text, with\nnew lines\r\nhas'),
  base.replace('Sentence 5 has', 'Sentence 5 שלום has'),
  base.replace('Sentence 5 has', 'Sentence 5 has'),
  base + ' and a streamed',
  base + ' and a streamed token',
  base.slice(0, 200) + base.slice(260),
  '',
  'x',
  base,
]

describe('prepareEdit', () => {
  for (const options of [{}, { whiteSpace: 'pre-wrap' }, { wordBreak: 'keep-all', letterSpacing: 1.5 }] as PrepareOptions[]) {
    test(`equals a fresh prepare after each edit with ${JSON.stringify(options)}`, () => {
      const reasons = new Set<string>()
      let opaque = L.prepare(EDITS[0]!, FONT, { ...options, editable: true })
      let rich = L.prepareWithSegments(EDITS[0]!, FONT, { ...options, editable: true })
      for (let i = 1; i < EDITS.length; i++) {
        opaque = L.prepareEdit(opaque, EDITS[i]!)
        reasons.add(E.editHooks.reason)
        expect(opaque).toStrictEqual(L.prepare(EDITS[i]!, FONT, options))
        rich = L.prepareEdit(rich, EDITS[i]!)
        expect(rich).toStrictEqual(L.prepareWithSegments(EDITS[i]!, FONT, options))
      }
      expect(reasons.has('splice')).toBe(true)
      expect(reasons.has('empty')).toBe(true)
    })
  }

  test('leaves the previous state unchanged and needs an editable state', () => {
    const previous = L.prepareWithSegments(base, FONT, { editable: true })
    const snapshot = structuredClone(previous)
    L.prepareEdit(previous, base.replace('words', 'letters'))
    expect(E.editHooks.reason).toBe('splice')
    expect(previous).toStrictEqual(snapshot)
    expect(() => L.prepareEdit(L.prepare(base, FONT), base + '!')).toThrow(TypeError)
  })

  test('prepares fully after clearCache()', () => {
    const previous = L.prepare(base, FONT, { editable: true })
    L.clearCache()
    const edited = L.prepareEdit(previous, base.replace('words', 'letters'))
    expect(E.editHooks.reason).toBe('generation')
    expect(edited).toStrictEqual(L.prepare(base.replace('words', 'letters'), FONT))
  })
})

function runEngineCases(userAgent: string, cases: [string, string, PrepareOptions][]): { equal: boolean, reason: string, changed: boolean }[] {
  // The engine profile is computed once per process, so each engine runs in a
  // child process. Letters are 10px and spaces 4px, or 3px after `o`.
  const script = `
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    class Context {
      font = ''
      measureText(text) {
        let width = 0
        let previous = ''
        for (const ch of text) {
          if (/\\p{Default_Ignorable_Code_Point}/u.test(ch)) continue
          width += ch === ' ' ? (previous === 'o' ? 3 : 4) : 10
          previous = ch
        }
        return { width }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const L = await import(${JSON.stringify(new URL('./layout.ts', import.meta.url).href)})
    const E = await import(${JSON.stringify(new URL('./prepare-edit.ts', import.meta.url).href)})
    const rows = []
    for (const [before, after, options] of ${JSON.stringify(cases)}) {
      const previous = L.prepareWithSegments(before, '16px Test', { ...options, editable: true })
      const edited = L.prepareEdit(previous, after)
      const expected = L.prepareWithSegments(after, '16px Test', options)
      rows.push({
        equal: Bun.deepEquals(edited, expected, true),
        reason: E.editHooks.reason,
        changed: previous.widths.some((width, i) => previous.segments[i] === expected.segments[i] && width !== expected.widths[i]),
      })
    }
    console.log(JSON.stringify(rows))
  `
  const child = Bun.spawnSync([process.execPath, '-e', script])
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  return JSON.parse(child.stdout.toString()) as { equal: boolean, reason: string, changed: boolean }[]
}

const filler = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')

test('the Safari profile splices around words whose kerning reads past a separator', () => {
  const rows = runEngineCases('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', [
    // A word ending in a format character scans commas and spaces for the
    // direction after its space, so Hebrew typed four separators later takes
    // away its kerning with the space.
    [`${filler} fo\u200D , , , , bar ${filler}`, `${filler} fo\u200D , , , , עב ${filler}`, {}],
    // A hyphen after a collapsed TAB is read from the source.
    [`${filler} a\t-אb ${filler}`, `${filler} a\t-אbc ${filler}`, {}],
  ])
  expect(rows).toEqual([
    { equal: true, reason: 'splice', changed: true },
    { equal: true, reason: 'splice', changed: false },
  ])
})

test('the Firefox profile splices around a line feed before a combining mark', () => {
  const rows = runEngineCases('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0', [
    [`${filler}\na\n\u0301$5 ${filler}`, `${filler}\na\n\u0301$55 ${filler}`, { whiteSpace: 'pre-wrap' }],
  ])
  expect(rows).toEqual([{ equal: true, reason: 'splice', changed: false }])
})
