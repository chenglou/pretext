import { expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../src/env.js'
import { fillLine, fillLineRange, firstLine, prepare } from '../../src/engines/gecko/index.js'
import { createContextPool } from '../../src/measure/canvas.js'
import { installStandInCanvas } from '../../tools/stand-in-canvas.ts'
import { cases } from './cases.ts'

const env: GeckoEnvironment = { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en',
  contentLanguage: null, regionalPrefsLocale: 'en-US', dictionaryBreaks: { kind: 'intl-segmenter-word' } }
const userAgent = 'Mozilla/5.0 Firefox/156.0'
type ExpectedLines = Array<[end: number, consulted: number[]]>
type Control = { id: string; text?: string; at37: ExpectedLines; at14: ExpectedLines }
// Captured under the checked-in deterministic Canvas from the frozen 1981939 baseline. These small expected cuts and
// consultation sequences run without that checkout; the explicit cross-tree driver covers complete pieces and geometry.
const controls: Control[] = [
  { id: 'endpoint/overlapping-ffi-fff', text: 'fffiffi', at37: [[4, []], [7, []]],
    at14: [[1, [1]], [2, [2, 1, 3, 2, 2, 1]], [3, [3, 2, 3, 3, 2]], [4, [3, 3]], [5, [5]], [6, [6, 5, 6, 6, 5]], [7, [6, 6]]] },
  { id: 'endpoint/inside-group-frame-bounds', at37: [[4, [1, 1, 2, 1, 2, 1, 2, 5, 2]], [8, [5, 5, 6, 5, 6, 5]], [11, []]],
    at14: [[1, [1, 1, 2, 1]], [2, [2, 1, 2, 1, 2]], [4, [2, 5, 2]], [5, [5, 5, 6, 5]], [6, [6, 5, 6, 6, 5]], [8, [6, 6]], [9, [9]], [10, [10, 9, 10, 10, 9]], [11, [10, 10]]] },
  { id: 'endpoint/soft-hyphen-inside-group', at37: [[5, []], [10, []], [14, []]],
    at14: [[2, [1]], [3, [2, 1, 2, 2, 1]], [5, [2, 2]], [6, [5]], [8, [6, 5, 6, 6, 5]], [10, [6, 6]], [11, [9]], [12, [10, 9, 11, 10, 10, 9]], [13, [11, 10, 11, 11, 10]], [14, [11, 11]]] },
  { id: 'endpoint/arabic-signed-tracking', text: 'للَّهِ بَ', at37: [[9, []]], at14: [[1, []], [7, []], [9, []]] },
  { id: 'endpoint/tabs-signed-tracking', at37: [[4, []], [9, []], [10, []], [16, [14, 14]], [22, []]],
    at14: [[1, []], [3, []], [4, []], [5, []], [6, []], [9, []], [10, []], [11, []], [12, [14]], [14, [14, 14, 14]], [16, [14, 14]], [17, []], [18, []], [19, []], [22, []]] },
]

for (const control of controls) test(`${control.id}: fixed cuts and duplicate consultation sequence across retained widths`, () => {
  const c = cases([]).find(c => c.id === control.id)
  if (c === undefined) throw new Error(`Missing fixed input: ${control.id}`)
  const paragraph = structuredClone(c.paragraph)
  if (control.text !== undefined) paragraph.content = [{ kind: 'text', text: control.text }]
  const canvas = installStandInCanvas({ userAgent, devicePixelRatio: 2, pageLang: paragraph.lang })
  try {
    const p = prepare(paragraph, { ...env, pageLang: paragraph.lang }, true, createContextPool())
    for (const width of [37, 14, 37, 14]) {
      const actual: ExpectedLines = []
      for (let start = firstLine(p); start !== null;) {
        const slot = { width, left: 0, right: 0 }
        const full = fillLine(p, start, slot)
        if (full.kind !== 'line') throw new Error('unexpected refusal')
        const range = fillLineRange(p, start, slot)
        expect(range).toEqual({ kind: full.kind, start: full.start, end: full.end, next: full.next, hasLineBox: full.hasLineBox })
        actual.push([full.end, [...full.line.inspect!.consulted]])
        start = full.next
      }
      expect(actual).toEqual(width === 37 ? control.at37 : control.at14)
    }
  } finally { canvas.restore() }
})

test('warm adjacent scanning reads each owned source-to-unit entry within the reduced work budget', () => {
  const c = cases([]).find(c => c.id === 'long-word')!
  const paragraph = { ...c.paragraph, font: { ...c.paragraph.font, family: '"Helvetica Neue"' }, content: [{ kind: 'text' as const, text: 'abcd'.repeat(32) }] }
  const canvas = installStandInCanvas({ userAgent, devicePixelRatio: 2, pageLang: paragraph.lang })
  try {
    const p = prepare(paragraph, env, false, createContextPool())
    const drain = (): number[] => {
      const ends: number[] = []
      for (const width of [24, 36, 48]) for (let start = firstLine(p); start !== null;) {
        const f = fillLineRange(p, start, { width, left: 0, right: 0 })
        if (f.kind !== 'line') throw new Error('unexpected refusal')
        ends.push(f.end)
        start = f.next
      }
      return ends
    }
    const expected = drain()
    let reads = 0
    p.unitOf = new Proxy(p.unitOf, { get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, target) as unknown
    } })
    canvas.reset()
    expect(drain()).toEqual(expected)
    expect(canvas.asked().calls).toBe(0)
    // The original adjacent-interval implementation reads 2,247 entries here; endpoint reuse reads 1,485, and the word
    // scan (lines.ts wordScan) one more a scan to find that the scan starts inside the word: 1,613.
    expect(reads).toBeLessThanOrEqual(1700)
  } finally { canvas.restore() }
})
