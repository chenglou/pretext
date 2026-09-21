import { beforeEach, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type LigaturePattern, type ListedFontFacts, type Paragraph } from '../../model.js'
import { fillLine, firstLine, linePieces, prepare } from './index.js'
import { fontFactsOfText, LIGATURE_MERGED, LIGATURE_NONE, LIGATURE_UNCERTAIN } from './ligatures.js'

let questions: string[] = []
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'
  fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    questions.push(text)
    return { width: text.length / 65536, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}
beforeEach(() => {
  questions = []
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}
function font(family: string, coverage: number[], patterns: LigaturePattern[] = []): ListedFontFacts {
  return { family, realizes: true, coverage, spacingInputs: null, scriptLookups: null,
    ligatures: { complete: true, languageSystems: [], patterns } }
}
function pattern(first: string, second: string): LigaturePattern {
  return { positions: [[first], [second]], exact: true, spaced: true, everyContext: true, acrossMark: true }
}
function paragraph(text: string, fonts: ListedFontFacts[]): Paragraph {
  return {
    font: { family: fonts.map(f => f.family).join(', '), size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, fonts } },
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

describe('blink supplied ligature facts', () => {
  test('a long known-font stretch with no ligatures keeps every boundary breakable with one shaping question', () => {
    const text = 'a'.repeat(8192)
    const p = prepare(paragraph(text, [font('Mono', [0, 0x10ffff])]), env, false, createContextPool())
    expect(questions).toEqual([text])
    expect(Array.from(p.fontRun)).toEqual(new Array(text.length).fill(0))
    expect(Array.from(p.ligature.slice(1, -1))).toEqual(new Array(text.length - 1).fill(LIGATURE_NONE))
    const start = firstLine(p)!
    const result = fillLine(p, start, { width: 100, left: 0, right: 0 })
    expect(result.kind).toBe('line')
    if (result.kind !== 'line') throw new Error('expected one decided line')
    expect([result.start, result.end, result.next]).toEqual([0, text.length, null])
    expect(linePieces(p, result.line).fragments.map(f => f.kind)).toEqual(['text'])
    expect(questions).toEqual([text])
  })

  test('ligatures restart at each known font stretch, including a later return to the first font', () => {
    const p = prepare(paragraph('aabbaa', [font('First', [97, 97], [pattern('a', 'a')]),
      font('Second', [98, 98], [pattern('b', 'b')])]), env, false, createContextPool())
    expect(Array.from(p.fontRun)).toEqual([0, 0, 1, 1, 0, 0])
    expect(Array.from(p.ligature)).toEqual([0, LIGATURE_MERGED, LIGATURE_NONE, LIGATURE_MERGED, LIGATURE_NONE, LIGATURE_MERGED, 0])
  })

  test('a same-font script edge bounds ligature matching and later Latin candidates recover', () => {
    const p = prepare(paragraph('aaकaa', [font('Mono', [0, 0x10ffff], [pattern('a', 'a'), pattern('a', 'क')])]), env, false, createContextPool())
    expect(p.scripts[0]).not.toBe(p.scripts[2])
    expect(p.ligature[1]).toBe(LIGATURE_MERGED)
    expect(p.ligature[2]).toBe(LIGATURE_NONE)
    expect(p.ligature[3]).toBe(LIGATURE_NONE)
    expect(p.ligature[4]).toBe(LIGATURE_MERGED)
  })

  test('shared supplied facts stay usable under the selected locale for each shaping group', () => {
    const input = paragraph('', [font('Mono', [0, 0x10ffff], [pattern('f', 'i')])])
    input.font.facts.fonts![0]!.ligatures!.languageSystems = ['GSUB/latn/TRK ']
    const atom = { kind: 'atomic' as const, width: 0, height: 0, marginInlineStart: 0, marginInlineEnd: 0 }
    input.content = ['en', 'tr', 'en'].flatMap((lang, i) => {
      const span = { kind: 'span' as const, font: input.font, letterSpacing: 0, wordSpacing: 0,
        whiteSpace: 'normal' as const, wordBreak: 'normal' as const, overflowWrap: 'normal' as const,
        lineBreak: 'auto' as const, tabSize: 8, lang, inlineStart: { margin: 0, border: 0, padding: 0 },
        inlineEnd: { margin: 0, border: 0, padding: 0 }, verticalAlign: 'baseline' as const,
        children: [{ kind: 'text' as const, text: 'fi' }] }
      return i === 2 ? [span] : [span, atom]
    })
    const p = prepare(input, env, false, createContextPool())
    expect(p.text).toBe('fi\ufffcfi\ufffcfi')
    expect([p.ligature[1], p.ligature[4], p.ligature[7]]).toEqual([LIGATURE_MERGED, 0, LIGATURE_MERGED])
    expect(questions).toEqual(['fi', 'fi', 'fi'])
  })

  test('first alternatives keep across-mark matching and UTF16 prefixes rather than codepoint dispatch', () => {
    const acrossMarks: LigaturePattern = { ...pattern('a', 'b'), positions: [['ab']] }
    const marks = prepare(paragraph('a\u0301ba\u0301b', [font('Mono', [0, 0x10ffff], [acrossMarks])]), env, false, createContextPool())
    expect([marks.ligature[2], marks.ligature[5]]).toEqual([LIGATURE_MERGED, LIGATURE_MERGED])
    const utf16 = prepare(paragraph('\ud834\udd1ea', [font('Mono', [0, 0x10ffff], [pattern('\ud834', '\udd1ea')])]), env, false, createContextPool())
    expect(utf16.ligature[2]).toBe(LIGATURE_MERGED)
  })

  test('unused supplied facts across many groups do not change the selected font or native questions', () => {
    const fonts = [font('Mono', [0, 0x10ffff]), ...Array.from({ length: 8191 }, (_, i) => ({
      ...font('Unavailable' + i, [0, 0x10ffff]), realizes: false,
    }))]
    const input = paragraph('', fonts)
    input.content = Array.from({ length: 128 }, () => [{ kind: 'text' as const, text: 'a' },
      { kind: 'atomic' as const, width: 0, height: 0, marginInlineStart: 0, marginInlineEnd: 0 }]).flat()
    const p = prepare(input, env, false, createContextPool())
    expect(p.groups.length).toBe(128)
    expect(p.groups.every(g => p.fontRun[g.start] === 0)).toBe(true)
    expect(questions).toEqual(new Array(128).fill('a'))
  })

  test('unrelated and empty patterns leave a long complete-fact stretch with every visible boundary known', () => {
    const empty: LigaturePattern = { ...pattern('a', 'b'), positions: [] }
    const repeated = pattern('z', 'x')
    const p = prepare(paragraph('a'.repeat(512), [font('Mono', [0, 0x10ffff], [
      empty, { ...empty, positions: [['']] }, ...new Array<LigaturePattern>(8192).fill(repeated),
    ])]), env, false, createContextPool())
    expect(Array.from(p.ligature.slice(1, -1))).toEqual(new Array(511).fill(LIGATURE_NONE))
    expect(questions).toEqual(['a'.repeat(512)])
  })
})


test('many realized families covering separate cluster parts keep whole-cluster font selection and one shaping question', () => {
  let reads = 0
  const sources = Array.from({ length: 8192 }, (_, i) => {
    const coverage = new Proxy(i % 2 ? [769, 769] : [97, 97], { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    } })
    return font('Family' + i, coverage)
  })
  sources.push(font('Whole', [97, 97, 769, 769]))
  const text = 'a\u0301'.repeat(512)
  const p = prepare(paragraph(text, sources), env, false, createContextPool())
  expect(Array.from(p.fontRun)).toEqual(new Array(text.length).fill(8192))
  expect(questions).toEqual([text])
  expect(reads).toBeLessThan(900000)
})

test('overlapping uncertain strings write each newly reached boundary once while certain recovery still wins', () => {
  const uncertain: LigaturePattern = { ...pattern('a', 'a'), positions: [['aaa']], exact: false }
  const p = prepare(paragraph('aaaaabaaaaab', [font('Mono', [0, 0x10ffff], [uncertain, pattern('a', 'b')])]), env, false, createContextPool())
  expect(Array.from(p.ligature)).toEqual([0, LIGATURE_UNCERTAIN, LIGATURE_UNCERTAIN, LIGATURE_UNCERTAIN,
    LIGATURE_UNCERTAIN, LIGATURE_MERGED, LIGATURE_NONE, LIGATURE_UNCERTAIN, LIGATURE_UNCERTAIN,
    LIGATURE_UNCERTAIN, LIGATURE_UNCERTAIN, LIGATURE_MERGED, 0])
  expect(questions).toEqual(['aaaaabaaaaab'])
})

test('a long uncertain source string has linear boundary bookkeeping and keeps the same emitted text', () => {
  const text = 'a'.repeat(512)
  const uncertain: LigaturePattern = { ...pattern('a', 'a'), positions: [['a'.repeat(128)]], exact: false }
  const p = prepare(paragraph(text, [font('Mono', [0, 0x10ffff], [uncertain])]), env, false, createContextPool())
  const flags = p.ligature
  let operations = 0
  p.ligature = new Proxy(flags, {
    get(target, key): unknown {
      if (typeof key === 'string' && /^\d+$/.test(key)) operations++
      return Reflect.get(target, key, target)
    },
    set(target, key, value: unknown): boolean {
      if (typeof key === 'string' && /^\d+$/.test(key)) operations++
      return Reflect.set(target, key, value, target)
    },
  })
  fontFactsOfText(p)
  p.ligature = flags
  expect(operations).toBeLessThan(text.length * 8)
  expect(Array.from(flags.slice(1, -1))).toEqual(new Array(511).fill(LIGATURE_UNCERTAIN))
  const result = fillLine(p, firstLine(p)!, { width: 100, left: 0, right: 0 })
  expect(result.kind).toBe('line')
  if (result.kind !== 'line') throw new Error('expected one decided line')
  expect([result.start, result.end, result.next]).toEqual([0, text.length, null])
  expect(linePieces(p, result.line).fragments.map(f => f.kind)).toEqual(['text'])
  expect(questions).toEqual([text])
})

test('length-ineligible across-mark literals do not walk each shrinking source suffix', () => {
  const text = 'a'.repeat(512)
  const tooLong: LigaturePattern = { ...pattern('a', 'a'), positions: [['a'.repeat(1024)]], exact: false }
  const p = prepare(paragraph(text, [font('Mono', [0, 0x10ffff], [tooLong])]), env, false, createContextPool())
  const original = p.text
  let codepoints = 0
  // A test-only source-text facade observes the real font-fact pass, without changing global string methods.
  p.text = { length: original.length, charCodeAt: (at: number) => original.charCodeAt(at),
    startsWith: (value: string, at: number) => original.startsWith(value, at),
    codePointAt: (at: number) => { codepoints++; return original.codePointAt(at) } } as unknown as string
  try { fontFactsOfText(p) } finally { p.text = original }
  expect(codepoints).toBeLessThan(text.length * 8)
  expect(Array.from(p.fontRun)).toEqual(new Array(text.length).fill(0))
  expect(Array.from(p.ligature.slice(1, -1))).toEqual(new Array(text.length - 1).fill(LIGATURE_NONE))
  const result = fillLine(p, firstLine(p)!, { width: 100, left: 0, right: 0 })
  expect(result.kind).toBe('line')
  if (result.kind !== 'line') throw new Error('expected one decided line')
  expect([result.start, result.end, result.next]).toEqual([0, text.length, null])
  expect(linePieces(p, result.line).fragments.map(f => f.kind)).toEqual(['text'])
  expect(questions).toEqual([text])
})

test('across-mark matching keeps its final astral codepoint over a UTF16 style boundary', () => {
  const input = paragraph('', [font('Mono', [0, 0x10ffff], [
    { ...pattern('a', 'b'), positions: [['a\ud834\udd1e']] },
  ])])
  input.content = [{ kind: 'text', text: 'a\u034f\ud834' }, { kind: 'span', font: input.font,
    letterSpacing: 1, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, lang: 'en', inlineStart: { margin: 0, border: 0, padding: 0 },
    inlineEnd: { margin: 0, border: 0, padding: 0 }, verticalAlign: 'baseline',
    children: [{ kind: 'text', text: '\udd1e' }] }]
  const p = prepare(input, env, false, createContextPool())
  expect(p.groups.map(g => [g.start, g.end])).toEqual([[0, 3], [3, 4]])
  expect(Array.from(p.ligature)).toEqual([0, 0, LIGATURE_MERGED, LIGATURE_MERGED, 0])
  expect(questions).toEqual(['a\u034f\ud834', '\udd1e'])
})
