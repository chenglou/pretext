// WebKit line output on worked examples of DESIGN.md §2.2-§2.4 and research/observe-webkit.md §4-§5, with a stand-in
// Canvas whose advances are chosen per test. These pin the port's output shape (display boxes from the closed run list,
// fragments, line boxes, font facts and the gaps they report), not browser widths: no expectation here is a browser
// observation.
import { describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type WebKitEnvironment } from '../../env.js'
import { createMeasurer } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type FontFacts, type Paragraph, type TextRun, type WebKitLine } from '../../model.js'
import { webkitEngine } from './index.js'

// Advance per code unit: SPACE 4, everything else 8, unless a test sets `advance`.
let advance = (c: number): number => c === 0x20 ? 4 : 8
class StandInContext {
  font = ''
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(s: string): { width: number } {
    let w = 0
    for (let i = 0; i < s.length; i++) w += advance(s.charCodeAt(i))
    return { width: w }
  }
}
;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
  getContext(): StandInContext {
    return new StandInContext()
  }
}

const env: WebKitEnvironment = {
  engine: 'webkit', build: PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null,
  preferredLanguages: ['en-US'], icuDefaultLocale: 'en_US_POSIX', dictionaryBreaks: { kind: 'unavailable' },
}

function paragraph(runs: Array<[string, TextRun['node']]>, overrides: Partial<Paragraph> = {}, facts: FontFacts = UNKNOWN_FONT_FACTS): Paragraph {
  const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts }
  return {
    runs: runs.map(([text, node]) => ({ text, node, font, letterSpacing: 0, wordSpacing: 0, lang: null })),
    font, letterSpacing: 0, wordSpacing: 0, width: 1000, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...overrides,
  }
}

function layout(p: Paragraph): { lines: WebKitLine[]; gaps: string[] } {
  const m = createMeasurer()
  const prepared = webkitEngine.prepare(p, env, m)
  const lines: WebKitLine[] = []
  for (let start = webkitEngine.firstLine(prepared); start !== null;) {
    const line = webkitEngine.nextLine(prepared, start, p.width, m)
    lines.push(line)
    start = line.next
  }
  return { lines, gaps: webkitEngine.gaps(prepared).map(g => g.gap) }
}

describe('display boxes from the closed run list (DESIGN.md §2.4)', () => {
  test('foo   bar in one node is two boxes; units 4 and 5 are in no box', () => {
    const { lines } = layout(paragraph([['foo   bar', 'text']]))
    expect(lines.length).toBe(1)
    expect(lines[0]!.geometry.boxes.map(b => [b.start, b.end, b.x, b.width])).toEqual([[0, 4, 0, 28], [6, 9, 28, 24]])
    expect(lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 4, painted: 'foo ', level: 0 },
      { kind: 'collapsed', run: 0, start: 4, end: 6 },
      { kind: 'text', run: 0, start: 6, end: 9, painted: 'bar', level: 0 },
    ])
  })

  test('foo bar broken after the space: the trimmed space is in no box', () => {
    const { lines } = layout(paragraph([['foo bar', 'text']], { width: 30 }))
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 4], [4, 7]])
    expect(lines[0]!.geometry.boxes.map(b => [b.start, b.end, b.width])).toEqual([[0, 3, 24]])
    expect(lines[0]!.geometry.contentWidth).toBe(24)
    expect(lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 3, painted: 'foo', level: 0 },
      { kind: 'trimmed', run: 0, start: 3, end: 4, painted: ' ', level: 0 },
    ])
    expect(lines[1]!.geometry.boxes.map(b => [b.start, b.end, b.x])).toEqual([[4, 7, 0]])
  })

  test('pre-wrap spaces hang inside their box; the conditional hang of the last line stops', () => {
    advance = () => 8
    const { lines } = layout(paragraph([['abc      def', 'text']], { whiteSpace: 'pre-wrap', width: 32 }))
    advance = c => c === 0x20 ? 4 : 8
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 9], [9, 12]])
    expect(lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 3, painted: 'abc', level: 0 },
      { kind: 'hanging', run: 0, start: 3, end: 9, painted: '      ', level: 0 },
    ])
    expect(lines[0]!.geometry.boxes.map(b => [b.start, b.end, b.width])).toEqual([[0, 9, 72]])
    expect(lines[0]!.geometry.contentWidth).toBe(72)
    expect(lines[0]!.geometry.hangingWidth).toBe(48)
  })

  test('a preserved newline is its own zero-width box and the forced break', () => {
    const { lines } = layout(paragraph([['a\nb', 'text']], { whiteSpace: 'pre' }))
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 2], [2, 3]])
    expect(lines[0]!.geometry.boxes.map(b => [b.kind, b.start, b.end, b.x, b.width])).toEqual([['text', 0, 1, 0, 8], ['soft-line-break', 1, 2, 8, 0]])
    expect(lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'forced-break'])
  })

  test('an RTL line starts at f32(line box width - content logical right)', () => {
    advance = () => 5.1
    const { lines } = layout(paragraph([['אבג', 'text']], { direction: 'rtl', width: 336 }))
    advance = c => c === 0x20 ? 4 : 8
    const g = lines[0]!.geometry
    expect(g.contentLogicalRight).toBe(Math.fround(15.299999999999999))
    expect(g.boxes[0]!.x).toBe(Math.fround(336 - Math.fround(15.299999999999999)))
    expect(g.boxes[0]!.level).toBe(1)
  })
})

describe('line boxes', () => {
  test('a line of span edges and collapsed white space has no line box', () => {
    const { lines } = layout(paragraph([[' ', 'span']]))
    expect(lines.length).toBe(1)
    expect(lines[0]!.hasLineBox).toBe(false)
    expect(lines[0]!.fragments).toEqual([{ kind: 'collapsed', run: 0, start: 0, end: 1 }])
  })

  test('a block whose only node gets no renderer makes no line', () => {
    expect(layout(paragraph([[' \n ', 'text']])).lines).toEqual([])
  })
})

describe('font facts (DESIGN.md §1.2)', () => {
  test('mapsHyphen false paints "-", null paints U+2010', () => {
    const narrow = { width: 45 }
    const unknown = layout(paragraph([['super­califragilistic', 'text']], narrow))
    const hyphen = unknown.lines[0]!.fragments.find(f => f.kind === 'hyphen')!
    expect(hyphen).toEqual({ kind: 'hyphen', run: 0, at: 6, painted: '‐', letterSpacing: 0, level: 0 })
    expect(unknown.lines[0]!.geometry.boxes[0]!.hyphen).toBe('‐')
    const without = layout(paragraph([['super­califragilistic', 'text']], narrow, { ...UNKNOWN_FONT_FACTS, mapsHyphen: false }))
    expect(without.lines[0]!.fragments.find(f => f.kind === 'hyphen')!).toMatchObject({ painted: '-' })
  })

  test('hyphen-glyph is reported on a line that reads the hyphen when the fact is null and the glyphs differ', () => {
    advance = c => c === 0x2010 ? 6 : c === 0x20 ? 4 : 8
    const unknown = layout(paragraph([['super­califragilistic', 'text']], { width: 45 }))
    const known = layout(paragraph([['super­califragilistic', 'text']], { width: 45 }, { ...UNKNOWN_FONT_FACTS, mapsHyphen: true }))
    advance = c => c === 0x20 ? 4 : 8
    expect(unknown.lines[0]!.gaps.map(g => g.gap)).toEqual(['hyphen-glyph'])
    expect(known.lines[0]!.gaps).toEqual([])
  })

  test('monospace null reports fixed-pitch-path where test T1 fails; true takes the width shortcut', () => {
    const unknown = layout(paragraph([['foo bar', 'text']], { width: 1000 }))
    expect(unknown.gaps).toContain('fixed-pitch-path')
    expect(unknown.lines[0]!.geometry.contentWidth).toBe(52)
    const mono = layout(paragraph([['foo bar', 'text']], { width: 1000 }, { ...UNKNOWN_FONT_FACTS, monospace: true, primaryFamily: 'Menlo' }))
    expect(mono.gaps).not.toContain('fixed-pitch-path')
    expect(mono.gaps).not.toContain('simplified-measuring')
    expect(mono.lines[0]!.geometry.contentWidth).toBe(28)
    const courier = layout(paragraph([['foo bar', 'text']], { width: 1000 }, { ...UNKNOWN_FONT_FACTS, monospace: true, primaryFamily: 'Courier New' }))
    expect(courier.lines[0]!.geometry.contentWidth).toBe(52)
    expect(courier.gaps).toContain('simplified-measuring')
  })

  test('uniform advances pass T1', () => {
    advance = () => 8
    const { gaps } = layout(paragraph([['foo bar', 'text']]))
    advance = c => c === 0x20 ? 4 : 8
    expect(gaps).not.toContain('fixed-pitch-path')
  })
})

describe('environment facts (DESIGN.md §1.4)', () => {
  test('a Han lang without preferred languages reports ui-language', () => {
    const p = paragraph([['中文', 'text']], { lang: 'zh' })
    const m = createMeasurer()
    const given = webkitEngine.gaps(webkitEngine.prepare(p, env, m)).map(g => g.gap)
    const unknown = webkitEngine.gaps(webkitEngine.prepare(p, { ...env, preferredLanguages: null }, m)).map(g => g.gap)
    expect(given).not.toContain('ui-language')
    expect(unknown).toContain('ui-language')
  })

  test('quotes under a locale without delimiter data report ui-language when the ICU default locale is null', () => {
    const p = paragraph([['“a”', 'text']], { lang: 'und' })
    const m = createMeasurer()
    expect(webkitEngine.gaps(webkitEngine.prepare(p, { ...env, icuDefaultLocale: null }, m)).map(g => g.gap)).toContain('ui-language')
    expect(webkitEngine.gaps(webkitEngine.prepare(p, env, m)).map(g => g.gap)).not.toContain('ui-language')
    expect(webkitEngine.gaps(webkitEngine.prepare(paragraph([['“a”', 'text']]), { ...env, icuDefaultLocale: null }, m)).map(g => g.gap)).not.toContain('ui-language')
  })

  test('page zoom not given reports page-zoom', () => {
    const m = createMeasurer()
    expect(webkitEngine.gaps(webkitEngine.prepare(paragraph([['a', 'text']]), { ...env, pageZoom: null }, m)).map(g => g.gap)).toContain('page-zoom')
  })
})
