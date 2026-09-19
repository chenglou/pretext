// WebKit line output on worked examples of DESIGN.md §2.2-§2.4 and research/observe-webkit.md §4-§5, with a stand-in
// Canvas whose advances are chosen per test. These pin the port's output shape (display boxes from the closed run list,
// fragments, line boxes, font facts and the gaps they report) and the stage-5 rules from source (box edges, atomic inlines,
// <br>, <wbr>, text-indent, text-align, line slots), not browser widths: no expectation here is a browser observation.
import { describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type WebKitEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontFacts } from '../../model.js'
import { everyLine, type Insets, type Sized } from '../../test-lines.js'
import type { WebKitDisplayBox, WebKitLineGeometry, WebKitLineStart, WebKitTextBox } from './geometry.js'
import { fillLine, firstLine, inspectLine, linePieces, paragraphGaps, prepare, type WebKitFilledLine, type WebKitRefusedSlot } from './index.js'
import { atomic, flatParagraph, span, treeParagraph, type FlatNode } from './test-paragraph.js'

// A line as the tests read it: the fill result, the pieces and the inspection together (test-lines.ts everyLine).
type WebKitLine = ReturnType<typeof everyLine<WebKitLineStart, WebKitFilledLine, WebKitRefusedSlot, WebKitLineGeometry>>['lines'][number]

// Advance per code unit: SPACE 4, everything else 8, unless a test sets `advance`. `pairAdjust` stands in for shaping that
// moves a string's total away from the sum of its parts, such as kerning.
let advance = (c: number): number => c === 0x20 ? 4 : 8
let pairAdjust = (_s: string): number => 0
// Sequences the stand-in font draws with one glyph of the given advance, as a liga lookup does. Letter spacing goes once to
// every glyph with an advance, as WidthIterator adds it; U+200C has no advance and keeps a sequence from matching.
let ligatures: Record<string, number> = {}
// A letter's advance in its string, for fonts whose joining forms differ in width; null takes `advance`.
let contextual = (_s: string, _i: number): number | null => null
// The code units the named families draw. In a list that ends with LastResort the others get LastResort's box, 16 wide, the
// space too; in any other list they get a fallback glyph of the usual advance. A list of LastResort alone draws nothing else.
let namedDraws = (c: number): boolean => c < 0x80
// Every question the stand-in was asked since a test emptied the list, as font|letter spacing|text.
let asked: string[] = []
class StandInContext {
  font = ''
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(raw: string): { width: number } {
    asked.push(`${this.font}|${this.letterSpacing}|${raw}`)
    // Canvas turns U+0009-U+000D into spaces before it measures (CanvasRenderingContext2DBase.cpp:2847-2875).
    const s = raw.replace(/[\t\n\v\f\r]/g, ' ')
    const spacing = parseFloat(this.letterSpacing)
    let w = 0
    for (let i = 0; i < s.length; i++) {
      const lastResortBox = this.font.includes('LastResort') && (!this.font.includes(',') || !namedDraws(s.charCodeAt(i)))
      let glyph = s.charCodeAt(i) === 0x200c || s.charCodeAt(i) === 0x200d ? 0 : lastResortBox ? 16 : contextual(s, i) ?? advance(s.charCodeAt(i))
      for (const sequence in ligatures) {
        if (!s.startsWith(sequence, i)) continue
        glyph = ligatures[sequence]!
        i += sequence.length - 1
        break
      }
      w += glyph
      if (glyph !== 0) w += spacing
    }
    return { width: w + pairAdjust(s) }
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

function fontWith(facts: FontFacts = UNKNOWN_FONT_FACTS) {
  return { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts }
}

function paragraph(runs: Array<[string, FlatNode]>, overrides: Partial<Sized> = {}, facts: FontFacts = UNKNOWN_FONT_FACTS): Sized {
  return flatParagraph(runs, fontWith(facts), overrides)
}

function layout(p: Sized, insets: Insets[] = [], environment: WebKitEnvironment = env): { lines: WebKitLine[]; gaps: string[]; belowFloats: number[]; fonts: string[] } {
  const prepared = prepare(p, environment, true)
  const { lines, belowFloats } = everyLine({
    first: firstLine(prepared), fill: (start, slot) => fillLine(prepared, start, slot), inspect: line => inspectLine(prepared, line), pieces: line => linePieces(prepared, line),
  }, p.width, insets)
  // The paragraph's gaps, then every line's and refused slot's: content conditions are reported on the lines that measure them.
  const gaps = paragraphGaps(prepared).map(g => g.gap)
  for (const line of lines) for (const gap of line.gaps) gaps.push(gap.gap)
  for (const refused of belowFloats) for (const gap of refused.gaps) gaps.push(gap.gap)
  return { lines, gaps, belowFloats: belowFloats.map(refused => refused.row), fonts: prepared.contexts.map(context => context.settings.font) }
}

function textBoxes(boxes: WebKitDisplayBox[]): WebKitTextBox[] {
  return boxes.filter((b): b is WebKitTextBox => b.kind === 'text' || b.kind === 'soft-line-break')
}

describe('display boxes from the closed run list (DESIGN.md §2.4)', () => {
  test('foo   bar in one node is two boxes; units 4 and 5 are in no box', () => {
    const { lines } = layout(paragraph([['foo   bar', 'text']]))
    expect(lines.length).toBe(1)
    expect(textBoxes(lines[0]!.geometry.boxes).map(b => [b.start, b.end, b.x, b.width])).toEqual([[0, 4, 0, 28], [6, 9, 28, 24]])
    expect(lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 4, painted: 'foo ', level: 0 },
      { kind: 'collapsed', run: 0, start: 4, end: 6 },
      { kind: 'text', run: 0, start: 6, end: 9, painted: 'bar', level: 0 },
    ])
  })

  test('foo bar broken after the space: the trimmed space is in no box', () => {
    const { lines } = layout(paragraph([['foo bar', 'text']], { width: 30 }))
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 4], [4, 7]])
    expect(textBoxes(lines[0]!.geometry.boxes).map(b => [b.start, b.end, b.width])).toEqual([[0, 3, 24]])
    expect(lines[0]!.geometry.contentWidth).toBe(24)
    expect(lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 3, painted: 'foo', level: 0 },
      { kind: 'trimmed', run: 0, start: 3, end: 4, painted: ' ', level: 0 },
    ])
    expect(textBoxes(lines[1]!.geometry.boxes).map(b => [b.start, b.end, b.x])).toEqual([[4, 7, 0]])
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
    expect(textBoxes(lines[0]!.geometry.boxes).map(b => [b.start, b.end, b.width])).toEqual([[0, 9, 72]])
    expect(lines[0]!.geometry.contentWidth).toBe(72)
    expect(lines[0]!.geometry.hangingWidth).toBe(48)
  })

  test('a preserved newline is its own zero-width box and the forced break', () => {
    const { lines } = layout(paragraph([['a\nb', 'text']], { whiteSpace: 'pre' }))
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 2], [2, 3]])
    expect(textBoxes(lines[0]!.geometry.boxes).map(b => [b.kind, b.start, b.end, b.x, b.width])).toEqual([['text', 0, 1, 0, 8], ['soft-line-break', 1, 2, 8, 0]])
    expect(lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'forced-break'])
  })

  test('an RTL line starts at f32(line box width - content logical right)', () => {
    advance = () => 5.1
    const { lines } = layout(paragraph([['אבג', 'text']], { direction: 'rtl', width: 336 }))
    advance = c => c === 0x20 ? 4 : 8
    const g = lines[0]!.geometry
    expect(g.contentLogicalRight).toBe(Math.fround(15.299999999999999))
    expect(textBoxes(g.boxes)[0]!.x).toBe(Math.fround(336 - Math.fround(15.299999999999999)))
    expect(textBoxes(g.boxes)[0]!.level).toBe(1)
  })
})

describe('line boxes', () => {
  test('a line of span edges and collapsed white space has no line box', () => {
    const { lines } = layout(paragraph([[' ', 'span']]))
    expect(lines.length).toBe(1)
    expect(lines[0]!.hasLineBox).toBe(false)
    expect(lines[0]!.fragments).toEqual([{ kind: 'box-start', element: 0 }, { kind: 'collapsed', run: 0, start: 0, end: 1 }, { kind: 'box-end', element: 0 }])
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
    expect(textBoxes(unknown.lines[0]!.geometry.boxes)[0]!.hyphen).toBe('‐')
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

  test('a fixed-pitch font without a given primary family reports fixed-pitch-path where the Courier New test decides T1', () => {
    const unknownFamily = layout(paragraph([['foo bar', 'text']], { width: 1000 }, { ...UNKNOWN_FONT_FACTS, monospace: true }))
    expect(unknownFamily.lines[0]!.gaps.map(g => g.gap)).toContain('fixed-pitch-path')
    const givenFamily = layout(paragraph([['foo bar', 'text']], { width: 1000 }, { ...UNKNOWN_FONT_FACTS, monospace: true, primaryFamily: 'Menlo' }))
    expect(givenFamily.gaps).not.toContain('fixed-pitch-path')
  })

  test('uniform advances pass T1', () => {
    advance = () => 8
    const { gaps } = layout(paragraph([['foo bar', 'text']]))
    advance = c => c === 0x20 ? 4 : 8
    expect(gaps).not.toContain('fixed-pitch-path')
  })
})

describe('environment facts (DESIGN.md §1.4)', () => {
  test('a Han lang without preferred languages reports ui-language on the line measuring it', () => {
    const p = paragraph([['中文', 'text']], { lang: 'zh' })
    expect(layout(p).gaps).not.toContain('ui-language')
    expect(layout(p, [], { ...env, preferredLanguages: null }).lines[0]!.gaps.map(g => g.gap)).toContain('ui-language')
  })

  test('quotes under a locale without delimiter data report ui-language when the ICU default locale is null', () => {
    const p = paragraph([['“a”', 'text']], { lang: 'und' })
    expect(layout(p, [], { ...env, icuDefaultLocale: null }).gaps).toContain('ui-language')
    expect(layout(p).gaps).not.toContain('ui-language')
    expect(layout(paragraph([['“a”', 'text']]), [], { ...env, icuDefaultLocale: null }).gaps).not.toContain('ui-language')
  })

  test('page zoom not given reports page-zoom on the paragraph', () => {
    expect(paragraphGaps(prepare(paragraph([['a', 'text']]), { ...env, pageZoom: null }, true)).map(g => g.gap)).toContain('page-zoom')
  })

  test('a quoted "system-ui" names a family, not the system design (research/CHARTER-CRITIC.md item 9)', () => {
    const facts = UNKNOWN_FONT_FACTS
    const quoted = { ...paragraph([['a', 'text']]), font: { ...fontWith(facts), family: '"system-ui"' } }
    const keyword = { ...paragraph([['a', 'text']]), font: { ...fontWith(facts), family: 'system-ui' } }
    expect(layout(quoted).gaps).not.toContain('canvas-language')
    expect(layout(keyword).gaps).toContain('canvas-language')
  })
})

describe('line-local gaps (DESIGN.md §2.8)', () => {
  test('a control character reports on the line that measured it, not on the others', () => {
    // Canvas shows a pair adjustment between `c` and a space, so VT after `c` is pieced together (measure.ts).
    pairAdjust = s => s.endsWith('c ') ? -1 : 0
    const { lines } = layout(paragraph([['aaaa bbbb cc\vcc', 'text']], { width: 40 }))
    pairAdjust = () => 0
    expect(lines.length).toBe(3)
    expect(lines[0]!.gaps.map(g => g.gap)).not.toContain('control-character-width')
    expect(lines[2]!.gaps.find(g => g.gap === 'control-character-width')!.at).toEqual({ start: 12, end: 13 })
  })

  test('the content that ended a line counts: a word that overflowed reports on the line it didn\'t fit on', () => {
    pairAdjust = s => s.endsWith('b ') ? -1 : 0
    const { lines } = layout(paragraph([['aaaa b\vb', 'text']], { width: 40 }))
    pairAdjust = () => 0
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 5], [5, 8]])
    expect(lines[0]!.gaps.map(g => g.gap)).toContain('control-character-width')
    expect(lines[1]!.gaps.map(g => g.gap)).toContain('control-character-width')
  })

  test('page-history: an RTL paragraph gives the same Latin text a level boundary before its trailing full stop', () => {
    // The item [8, 12) overflows the line and `ccc` alone fits, so with a cached end at 11 the line ends there: the history
    // world's line differs from this one by the text between the two breaks.
    const overflowing = layout(paragraph([['aaa bbb ccc.', 'text']], { width: 84 }))
    expect(overflowing.lines.map(l => [l.start, l.end])).toEqual([[0, 8], [8, 12]])
    expect(overflowing.lines[0]!.gaps.find(g => g.gap === 'page-history')!.at).toEqual({ start: 8, end: 11 })
    expect(overflowing.lines[1]!.gaps.map(g => g.gap)).not.toContain('page-history')
    // Where `ccc` alone doesn't fit either, the world's line is the same line.
    expect(layout(paragraph([['aaa bbb ccc.', 'text']], { width: 60 })).gaps).not.toContain('page-history')
    // Everything fits: a split changes nothing where the parts measure what the whole does,
    expect(layout(paragraph([['aaa bbb ccc.', 'text']], { width: 1000 })).gaps).not.toContain('page-history')
    // and changes the width where they don't.
    pairAdjust = s => s.includes('c.') ? -1 : 0
    const kerned = layout(paragraph([['aaa bbb ccc.', 'text']], { width: 1000 }))
    pairAdjust = () => 0
    expect(kerned.gaps).toContain('page-history')
    // Interior punctuation between two L letters takes their level in either direction.
    expect(layout(paragraph([['aaa b,bb ccc', 'text']], { width: 60 })).gaps).not.toContain('page-history')
  })

  test('a generic family under a locale is measured as the family the locale resolves it to (fonts.ts), and reports nothing', () => {
    const generic = { ...paragraph([['foo bar', 'text']], { lang: 'ja', width: 1000 }), font: { ...fontWith(), family: 'Arial, serif' } }
    const underJa = layout(generic)
    expect(underJa.gaps).not.toContain('canvas-language')
    expect(underJa.fonts).toContain('normal 400 16px Arial, "Hiragino Mincho ProN"')
    // serif under en is the settings' Times, as in Canvas: the keyword stands; monospace is Menlo, where Canvas has Courier.
    expect(layout({ ...generic, lang: 'en' }).fonts[0]).toBe('normal 400 16px Arial, serif')
    expect(layout({ ...generic, lang: 'en', font: { ...fontWith(), family: 'monospace' } }).fonts[0]).toBe('normal 400 16px "Menlo"')
    expect(layout({ ...generic, lang: 'en', font: { ...fontWith(), family: '"monospace"' } }).fonts[0]).toBe('normal 400 16px "monospace"')
    expect(layout({ ...generic, lang: '', font: { ...fontWith(), family: 'monospace' } }).fonts[0]).toBe('normal 400 16px monospace')
    expect(layout({ ...generic, lang: 'zh-Hant-HK', font: { ...fontWith(), family: 'sans-serif, -webkit-standard' } }).fonts).toContain('normal 400 16px "PingFang HK", "Songti TC"')
  })

  test('page-history: an end inside the placed part of the candidate that ended the line reports on that line', () => {
    // suite/glue c-cf7bb1ee29b5b4cf's shape: in an RTL block the items [2, 4) and [4, 5) split at a level boundary with no wrap
    // opportunity between them, so they form one candidate. An LTR box of the same text ends an item at 3 (NBSP between R and
    // L takes the paragraph level), which would be a wrap opportunity of the decision that places [2, 4).
    const { lines } = layout(paragraph([['ب­ب x', 'text']], { direction: 'rtl', width: 19.25, overflowWrap: 'break-word' }))
    expect(lines.length).toBeGreaterThan(1)
    const placing = lines.find(l => l.start <= 2 && l.end >= 4)!
    // The world's line ends at 3 where this one ends at 4: the text between the two breaks.
    expect(placing.gaps.find(g => g.gap === 'page-history')!.at).toEqual({ start: 3, end: 4 })
  })

  test('page-history: preserved white space of two units, which break-spaces splits per space', () => {
    pairAdjust = s => s.includes('  ') ? -1 : 0
    const kerned = layout(paragraph([['aaa  bbb', 'text']], { whiteSpace: 'pre-wrap', width: 1000 }))
    pairAdjust = () => 0
    expect(kerned.gaps).toContain('page-history')
    expect(layout(paragraph([['aaa  bbb', 'text']], { whiteSpace: 'pre-wrap', width: 1000 })).gaps).not.toContain('page-history')
    expect(layout(paragraph([['aaa bbb c', 'text']], { whiteSpace: 'pre-wrap', width: 1000 })).gaps).not.toContain('page-history')
  })
})

describe('letter spacing and ligatures (measure.ts mergedGlyphs; probe webkit-round3 R1)', () => {
  test('a pair Canvas merges is measured with U+200C between its letters, and the gap sits on the pair', () => {
    ligatures = { fi: 10 }
    const spaced = layout(paragraph([['office', 'text']], { letterSpacing: 1 }))
    const unspaced = layout(paragraph([['office', 'text']]))
    ligatures = {}
    // Six glyphs with 1px each where the DOM turns the ligature off; Canvas alone gives five glyphs, 42 + 5.
    expect(spaced.lines[0]!.geometry.contentWidth).toBe(54)
    expect(spaced.lines[0]!.gaps.find(g => g.gap === 'letter-spacing-ligatures')!.at).toEqual({ start: 2, end: 4 })
    // Without letter spacing the DOM keeps the ligature, and so does the measurement.
    expect(unspaced.lines[0]!.geometry.contentWidth).toBe(42)
    expect(unspaced.gaps).not.toContain('letter-spacing-ligatures')
  })

  test('the code path is the measured string\'s: a pair after a combining mark of the same box is still measured apart', () => {
    // The mark sends the box's whole text to the complex path, but `office` is measured as a range of its own, which
    // FontCascade::width puts on the simple path (FontCascade.cpp:304-309, :708-730; TextUtil.cpp:84-89).
    ligatures = { fi: 10 }
    const text = `a${String.fromCharCode(0x301)} office`
    const { lines } = layout(paragraph([[text, 'text']], { letterSpacing: 1 }))
    ligatures = {}
    // `a` and the mark 18, the space 5, then six glyphs with 1px each.
    expect(lines[0]!.geometry.contentWidth).toBe(77)
    expect(lines[0]!.gaps.filter(g => g.gap === 'letter-spacing-ligatures').map(g => g.at)).toEqual([{ start: 5, end: 7 }])
  })

  test('a pair in a string that holds a complex path character is left as Canvas shapes it', () => {
    ligatures = { fi: 10 }
    const { lines } = layout(paragraph([[`fia${String.fromCharCode(0x301)}`, 'text']], { letterSpacing: 1 }))
    ligatures = {}
    // `fi` stays one glyph: three glyphs with 1px each over 10 + 8 + 8, and the gap on the whole string.
    expect(lines[0]!.geometry.contentWidth).toBe(29)
    expect(lines[0]!.gaps.filter(g => g.gap === 'letter-spacing-ligatures').map(g => g.at)).toEqual([{ start: 0, end: 4 }])
  })

  test('glyphs that merge inside a grapheme cluster are not ligatures the DOM turns off', () => {
    // A base with its mark is one glyph here, alone and in the string.
    ligatures = { 'a\u0301': 8 }
    const { gaps, lines } = layout(paragraph([['xa\u0301y', 'text']], { letterSpacing: 1 }))
    ligatures = {}
    expect(gaps).not.toContain('letter-spacing-ligatures')
    expect(lines[0]!.geometry.contentWidth).toBe(27)
  })

  test('the listed families\' spacing inputs say where letter-spacing changes nothing (ListedFontFacts.spacingInputs)', () => {
    const facts = (inputs: number[]): FontFacts => ({ ...UNKNOWN_FONT_FACTS, fonts: [{ family: 'Arial', realizes: true, coverage: [0x20, 0x7e], ligatures: null, spacingInputs: inputs, scriptLookups: null }] })
    ligatures = { fi: 10 }
    const kept = layout(paragraph([['office', 'text']], { letterSpacing: 1 }, facts([])))
    const off = layout(paragraph([['office', 'text']], { letterSpacing: 1 }, facts([0x66, 0x66])))
    ligatures = {}
    // No input: the merge is one the DOM keeps, five glyphs. `f` is an input: measured apart, six glyphs.
    expect(kept.lines[0]!.geometry.contentWidth).toBe(47)
    expect(kept.gaps).not.toContain('letter-spacing-ligatures')
    expect(off.lines[0]!.geometry.contentWidth).toBe(54)
    expect(off.gaps).toContain('letter-spacing-ligatures')
  })

  test('a letter-spaced string whose glyphs Canvas counts one per character reports nothing', () => {
    expect(layout(paragraph([['office hours', 'text']], { letterSpacing: 2 })).gaps).not.toContain('letter-spacing-ligatures')
  })

  test('a line that starts with a carried width reports what concerns the part of the item before it', () => {
    ligatures = { fi: 10 }
    // `fi` stays on the first line; the rest keeps the whole item's width less what the first line took.
    const { lines } = layout(paragraph([['fiabcdefgh', 'text']], { letterSpacing: 1, width: 40, overflowWrap: 'break-word' }))
    ligatures = {}
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[1]!.start).toBeGreaterThan(1)
    expect(lines[1]!.gaps.find(g => g.gap === 'letter-spacing-ligatures')!.at).toEqual({ start: lines[1]!.start, end: 10 })
  })
})

describe('canvas-language (probes webkit-round3 R3, R3b, R3c, webkit-round4 R7)', () => {
  test('under a Han, kana or Hangul locale a Han, kana or Hangul character no named family draws is concerned', () => {
    const { lines } = layout(paragraph([['ab 中 cd', 'text']], { lang: 'ko' }))
    expect(lines[0]!.gaps.filter(g => g.gap === 'canvas-language').map(g => g.at)).toEqual([{ start: 3, end: 4 }])
  })

  test('a character a named family draws does not depend on the locale', () => {
    namedDraws = () => true
    const { gaps } = layout(paragraph([['ab 中 cd', 'text']], { lang: 'ko' }))
    namedDraws = c => c < 0x80
    expect(gaps).not.toContain('canvas-language')
  })

  test('a list none of whose families resolves draws with the standard family, which is named after it under a Han, kana or Hangul locale', () => {
    namedDraws = () => false
    const underKo = layout(paragraph([['ab cd', 'text']], { lang: 'ko' }))
    const underEn = layout(paragraph([['ab cd', 'text']], { lang: 'en' }))
    namedDraws = c => c < 0x80
    expect(underKo.fonts).toContain('normal 400 16px Arial, "AppleMyungjo"')
    expect(underKo.gaps).not.toContain('canvas-language')
    expect(underEn.fonts[0]).toBe('normal 400 16px Arial')
    expect(underEn.gaps).not.toContain('canvas-language')
  })

  test('a character with default emoji presentation that only a generic family named for Canvas could draw is concerned', () => {
    const p = { ...paragraph([['ab ⚡ cd', 'text']], { lang: 'ja' }), font: { ...fontWith(), family: 'Arial, sans-serif' } }
    expect(layout(p).lines[0]!.gaps.filter(g => g.gap === 'canvas-language').map(g => g.at)).toEqual([{ start: 3, end: 4 }])
  })

  test('Arabic falls back by language under Urdu and Kashmiri, enclosed alphanumerics under Korean (probes webkit-round4 R13, R14)', () => {
    const at = (text: string, lang: string) => layout(paragraph([[text, 'text']], { lang })).lines[0]!.gaps.filter(g => g.gap === 'canvas-language').map(g => g.at)
    expect(at('ab سلام', 'ur')).toEqual([{ start: 3, end: 7 }])
    expect(at('ab سلام', 'ks-Arab')).toEqual([{ start: 3, end: 7 }])
    expect(at('ab سلام', 'ar')).toEqual([])
    expect(at('ab ① cd', 'ko')).toEqual([{ start: 3, end: 4 }])
    expect(at('ab ① cd', 'en')).toEqual([])
  })

  test('a locale of another script leaves system fallback to the preferred languages, as Canvas does', () => {
    expect(layout(paragraph([['ab 中 cd', 'text']], { lang: 'en' })).gaps).not.toContain('canvas-language')
    expect(layout(paragraph([['ab 中 cd', 'text']], { lang: 'th' })).gaps).not.toContain('canvas-language')
  })

  test('a system design family after a named one concerns only what the named one does not draw', () => {
    const p = { ...paragraph([['ab é', 'text']], { lang: 'th' }), font: { ...fontWith(), family: 'Arial, system-ui' } }
    expect(layout(p).lines[0]!.gaps.filter(g => g.gap === 'canvas-language').map(g => g.at)).toEqual([{ start: 3, end: 4 }])
  })
})

describe('VT, FF and CR (measure.ts; probe webkit-round3 R5)', () => {
  test('without a pair adjustment around it, a control is measured in place and reports nothing', () => {
    const { lines, gaps } = layout(paragraph([['ab\fcd', 'text']]))
    expect(gaps).not.toContain('control-character-width')
    expect(lines[0]!.geometry.contentWidth).toBe(40)
  })

  test('the letter before VT or FF is kerned as before a space, not against the letter after the control', () => {
    // `b` loses 1 before a space and 2 before `c`, also across the stand-in.
    pairAdjust = s => (s.includes('b ') ? -1 : 0) + (s.includes('bc') || s.includes('b\u0001c') ? -2 : 0)
    const { lines, gaps } = layout(paragraph([['ab\fcd', 'text']]))
    pairAdjust = () => 0
    expect(lines[0]!.geometry.contentWidth).toBe(39)
    expect(gaps).toContain('control-character-width')
  })

  test('text after a CR in the measured string reports: the adjustment on CR itself is not observable', () => {
    expect(layout(paragraph([['ab\rcd', 'text']])).gaps).toContain('control-character-width')
    expect(layout(paragraph([['ab\r', 'text']])).gaps).not.toContain('control-character-width')
  })

  test('the code path is the measured string\'s: a control in a string without a complex path character reports as on the simple path', () => {
    // The mark sends the box's whole text to the complex path; `ab` FF `cd` and `ab` CR `cd` are measured as strings of their
    // own, which FontCascade::width puts on the simple path (FontCascade.cpp:304-309, :708-730; TextUtil.cpp:84-89).
    const mark = String.fromCharCode(0x301)
    expect(layout(paragraph([[`a${mark} ab\fcd`, 'text']])).gaps).not.toContain('control-character-width')
    expect(layout(paragraph([[`a${mark} ab\rcd`, 'text']])).gaps).toContain('control-character-width')
    // A string that holds the mark is the complex text controller's: VT and FF report, and a CR has no advance there.
    expect(layout(paragraph([[`a${mark}b\fcd`, 'text']])).gaps).toContain('control-character-width')
    expect(layout(paragraph([[`a${mark}b\rcd`, 'text']])).gaps).not.toContain('control-character-width')
  })
})

describe('simplified measuring (probes webkit-round3 R1 and R2)', () => {
  test('a string without a space reports nothing; one measured with its following space reports only without the pairKerning fact', () => {
    const known: FontFacts = { ...UNKNOWN_FONT_FACTS, monospace: false, pairKerning: 'first-advance' }
    const unknown: FontFacts = { ...UNKNOWN_FONT_FACTS, monospace: false }
    pairAdjust = s => s.includes('ab') ? -1 : 0
    expect(layout(paragraph([['abab', 'text']], {}, unknown)).gaps).not.toContain('simplified-measuring')
    expect(layout(paragraph([['abab cd', 'text']], {}, known)).gaps).not.toContain('simplified-measuring')
    expect(layout(paragraph([['abab cd', 'text']], {}, unknown)).gaps).toContain('simplified-measuring')
    // A preserved run of spaces holds a space that is a pair's first glyph.
    expect(layout(paragraph([['ab  cd', 'text']], { whiteSpace: 'pre-wrap' }, known)).gaps).toContain('simplified-measuring')
    pairAdjust = () => 0
  })
})

describe('page history worlds (gaps.ts, "Page history")', () => {
  test('ICU resolves a text without RTL characters at the paragraph level, so another paragraph gives an isolate its own level', () => {
    // `a` SHY LRI `b` PDI `c`: alone every level is 0; in a paragraph with an RTL character `b` is at level 2, so a box of the
    // same text there ends items at 3 and 4 (held-out c-7cc5e3e26ff7c30d).
    const p = paragraph([['a\u00ad\u2066b\u2069c', 'text']], { width: 45, overflowWrap: 'break-word' })
    const { lines } = layout(p)
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 6]])
    expect(lines[0]!.gaps.find(g => g.gap === 'page-history')!.at).toEqual({ start: 3, end: 4 })
  })

  test('the rest of an item another world ends earlier: the carried width comes from another whole', () => {
    // RTL block, `ab((` then Arabic: `((` takes level 1 with the Arabic here and level 0 after `ab` in an LTR paragraph, which
    // ends an item between `((` and the Arabic (triage c-66ae4ab7d56cb0ae).
    const { lines } = layout(paragraph([['ab((بببب', 'text']], { direction: 'rtl', width: 20, overflowWrap: 'break-word' }))
    const carried = lines.filter(l => l.start > 4)
    expect(carried.length).toBeGreaterThan(0)
    for (const line of carried) expect(line.gaps.map(g => g.gap)).toContain('page-history')
  })

  test('a text whose levels no context changes has no world', () => {
    expect(layout(paragraph([['aaa bbb ccc', 'text']], { width: 60 })).gaps).not.toContain('page-history')
  })
})

describe('plain and inspected paragraphs (DESIGN.md §2.9; gaps.ts)', () => {
  // Every fill result with its pieces, and what the paragraph asked of Canvas.
  function walk(p: Sized, inspect: boolean, insets: Insets[] = []) {
    asked = []
    const prepared = prepare(p, env, inspect)
    const out: unknown[] = []
    let row = 0
    for (let start = firstLine(prepared); start !== null;) {
      const inset = row < insets.length ? insets[row]! : { left: 0, right: 0 }
      const filled = fillLine(prepared, start, { width: p.width, left: inset.left, right: inset.right })
      switch (filled.kind) {
        case 'below-floats':
          out.push({ kind: filled.kind, next: filled.next })
          row++
          break
        case 'line':
          out.push({ start: filled.start, end: filled.end, next: filled.next, hasLineBox: filled.hasLineBox, pieces: linePieces(prepared, filled.line) })
          if (filled.hasLineBox) row++
          break
      }
      start = filled.next
    }
    return { prepared, lines: out, fonts: prepared.contexts.map(context => context.settings.font), asked }
  }

  test('a plain paragraph answers neither inspectLine nor paragraphGaps', () => {
    const prepared = prepare(paragraph([['foo bar', 'text']], { width: 30 }), env, false)
    const filled = fillLine(prepared, firstLine(prepared)!, { width: 30, left: 0, right: 0 })
    expect(filled.line.gaps).toBeNull()
    expect(() => inspectLine(prepared, filled.line)).toThrow('prepared plain')
    expect(() => paragraphGaps(prepared)).toThrow('prepared plain')
  })

  test('the lines and pieces of a plain paragraph are the inspected paragraph\'s, from a subset of its Canvas questions', () => {
    advance = c => c === 0x2010 ? 6 : c === 0x20 ? 4 : 8
    const cases: Array<[Sized, Insets[]]> = [
      [paragraph([['super\u00adcalifragilistic expialidocious', 'text']], { width: 45 }), []],
      [paragraph([['aaa bbb ccc.', 'text']], { width: 84 }), []],
      [paragraph([['a\u00ad\u2066b\u2069c', 'text']], { width: 45, overflowWrap: 'break-word' }), []],
      [paragraph([['foo bar baz', 'text']], { width: 60, letterSpacing: 2, textAlign: 'justify' }), []],
      [paragraph([['foo bar', 'text']], { width: 1000 }, { ...UNKNOWN_FONT_FACTS, monospace: true }), []],
      [paragraph([['abcdefghij klm', 'text']], { width: 40 }), [{ left: 30, right: 0 }]],
    ]
    for (const [p, insets] of cases) {
      const inspected = walk(p, true, insets)
      const plain = walk(p, false, insets)
      expect(plain.lines).toEqual(inspected.lines)
      for (const question of plain.asked) expect(inspected.asked).toContain(question)
      expect(plain.asked.length).toBeLessThanOrEqual(inspected.asked.length)
    }
    advance = c => c === 0x20 ? 4 : 8
  })

  test('a plain paragraph asks nothing that only a gap reads: the other hyphen, LastResort beside the coverage test, a world\'s items', () => {
    advance = c => c === 0x2010 ? 6 : c === 0x20 ? 4 : 8
    const hyphenated = paragraph([['super\u00adcalifragilistic', 'text']], { width: 45 })
    expect(walk(hyphenated, true).asked.filter(question => question.endsWith('|-')).length).toBeGreaterThan(0)
    expect(walk(hyphenated, false).asked.filter(question => question.endsWith('|-')).length).toBe(0)
    advance = c => c === 0x20 ? 4 : 8
    const fixedPitch = paragraph([['foo bar', 'text']], { width: 1000 }, { ...UNKNOWN_FONT_FACTS, monospace: true, primaryFamily: 'Menlo' })
    expect(walk(fixedPitch, true).fonts.some(font => font.endsWith('px LastResort'))).toBe(true)
    expect(walk(fixedPitch, false).fonts.some(font => font.endsWith('px LastResort'))).toBe(false)
    const withWorlds = paragraph([['aaa bbb ccc.', 'text']], { width: 84 })
    expect(walk(withWorlds, true).prepared.inspect!.worlds.length).toBeGreaterThan(0)
    expect(walk(withWorlds, false).prepared.inspect).toBeNull()
  })

  test('reading a decided line twice, in either order, gives the same pieces, geometry and gaps', () => {
    const p = paragraph([['aaa bbb ccc.', 'text']], { width: 84 })
    const prepared = prepare(p, env, true)
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width: p.width, left: 0, right: 0 })
      if (filled.kind === 'line') {
        const kept = JSON.stringify(filled.line)
        const inspection = JSON.stringify(inspectLine(prepared, filled.line))
        const pieces = JSON.stringify(linePieces(prepared, filled.line))
        expect(JSON.stringify(linePieces(prepared, filled.line))).toBe(pieces)
        expect(JSON.stringify(inspectLine(prepared, filled.line))).toBe(inspection)
        expect(JSON.stringify(filled.line)).toBe(kept)
      }
      start = filled.next
    }
  })
})

describe('Canvas questions: every read asks Canvas, and a value needed twice in one scope is asked once (measure.ts)', () => {
  // What a plain or an inspected paragraph asked of Canvas, preparing and filling every line at its width.
  function questions(p: Sized, inspect: boolean): string[] {
    asked = []
    const prepared = prepare(p, env, inspect)
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width: p.width, left: 0, right: 0 })
      if (inspect) inspectLine(prepared, filled.line)
      start = filled.next
    }
    return asked
  }
  const times = (list: string[], question: string): number => list.filter(q => q === question).length

  test('a box keeps the space its white-space items were measured with, so the space that follows a word is asked once', () => {
    const list = questions(paragraph([['foo bar baz', 'text']], { width: 1000 }), false)
    expect(times(list, 'normal 400 16px Arial|0px| ')).toBe(1)
    // Every word with the space that follows it, once each.
    expect(times(list, 'normal 400 16px Arial|0px|foo ')).toBe(1)
    expect(times(list, 'normal 400 16px Arial|0px|bar ')).toBe(1)
  })

  test('a hyphen read asks the box\'s hyphen once, and the other hyphen beside it only where an inspected paragraph doesn\'t know the font\'s', () => {
    advance = c => c === 0x2010 ? 6 : c === 0x20 ? 4 : 8
    const hyphenated = paragraph([['super\u00adcalifragilistic', 'text']], { width: 45 })
    const inspected = questions(hyphenated, true)
    const plain = questions(hyphenated, false)
    advance = c => c === 0x20 ? 4 : 8
    expect(times(plain, 'normal 400 16px Arial|0px|-')).toBe(0)
    expect(times(plain, 'normal 400 16px Arial|0px|\u2010')).toBeGreaterThan(0)
    // Whatever asks for the hyphen's width on the inspected paragraph asks the other hyphen once beside it.
    expect(times(inspected, 'normal 400 16px Arial|0px|-')).toBe(times(inspected, 'normal 400 16px Arial|0px|\u2010'))
  })

  test('the primary-font coverage test asks each code point of the text once', () => {
    const list = questions(paragraph([['aab aab', 'text']], { width: 1000 }, { ...UNKNOWN_FONT_FACTS, monospace: true, primaryFamily: 'Menlo' }), false)
    for (const letter of ['a', 'b', ' ']) expect(times(list, `normal 400 16px "Menlo", LastResort|0px|${letter}`)).toBe(1)
  })

  test('a letter-spaced string is totalled once in the count context, where the total says whether it can be counted and counts it', () => {
    const list = questions(paragraph([['abc', 'text']], { width: 1000, letterSpacing: 2 }), false)
    expect(times(list, 'normal 400 16px Arial|64px|abc')).toBe(1)
    expect(times(list, 'normal 400 16px Arial|0px|abc')).toBe(1)
  })
})

describe('inline structure (DESIGN.md §1.1, stage 5)', () => {
  const block = treeParagraph([], fontWith())

  test('an inline box start is margin + border + padding wide and decorates the line (InlineFormattingUtils.cpp:320-324)', () => {
    // "ab cd" in a span with 10px start padding at width 50: "ab" is 16 after 10 of padding; " cd" doesn't fit.
    const p = treeParagraph([span(block, [{ kind: 'text', text: 'ab cd' }], {}, { margin: 0, border: 0, padding: 10 }, { margin: 0, border: 0, padding: 0 })], fontWith(), { width: 40 })
    const { lines } = layout(p)
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5]])
    const box0 = lines[0]!.geometry.boxes
    expect(box0[0]).toEqual({ kind: 'inline-box', element: 0, x: 0, width: 26, hasStartEdge: true, hasEndEdge: false })
    expect(textBoxes(box0)[0]!.x).toBe(10)
    expect(lines[1]!.geometry.boxes[0]).toMatchObject({ kind: 'inline-box', element: 0, x: 0, hasStartEdge: false, hasEndEdge: true })
    expect(lines[0]!.fragments[0]).toEqual({ kind: 'box-start', element: 0 })
    expect(lines[1]!.fragments[lines[1]!.fragments.length - 1]).toEqual({ kind: 'box-end', element: 0 })
  })

  test('a span of only box edges makes a line box; an undecorated one does not (InlineLine.cpp:989-1008)', () => {
    const decorated = layout(treeParagraph([span(block, [], {}, { margin: 0, border: 0, padding: 4 })], fontWith()))
    expect(decorated.lines.map(l => l.hasLineBox)).toEqual([true])
    const plain = layout(treeParagraph([span(block, [])], fontWith()))
    expect(plain.lines.map(l => l.hasLineBox)).toEqual([false])
  })

  test('a nowrap span inside a wrapping block keeps its content together; the space before it is an opportunity', () => {
    const p = treeParagraph([{ kind: 'text', text: 'aa ' }, span(block, [{ kind: 'text', text: 'b c' }], { whiteSpace: 'nowrap' })], fontWith(), { width: 30 })
    const { lines } = layout(p)
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 6]])
  })

  test('an atomic inline is a soft wrap opportunity on both sides (InlineFormattingUtils.cpp:446-450)', () => {
    const p = treeParagraph([{ kind: 'text', text: 'abc' }, atomic(20), { kind: 'text', text: 'def' }], fontWith(), { width: 30 })
    const { lines } = layout(p)
    expect(lines.map(l => l.fragments.map(f => f.kind))).toEqual([['text'], ['atomic'], ['text']])
    expect(lines[1]!.geometry.boxes).toEqual([{ kind: 'atomic', element: 0, level: 0, x: 0, width: 20 }])
  })

  test('<br> ends the line and is its zero-width line break box; the simple builder takes it', () => {
    const p = treeParagraph([{ kind: 'text', text: 'ab' }, { kind: 'br' }, { kind: 'text', text: 'cd' }], fontWith())
    const { lines } = layout(p)
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 2], [2, 4]])
    expect(lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'br'])
    expect(lines[0]!.geometry.boxes[1]).toEqual({ kind: 'line-break', element: 0, x: 16, width: 0 })
    expect(lines[0]!.align).toBe('start')
  })

  test('<wbr> is a break opportunity without a character and no display box', () => {
    const p = treeParagraph([{ kind: 'text', text: 'abc' }, { kind: 'wbr' }, { kind: 'text', text: 'def' }], fontWith(), { width: 30 })
    const { lines } = layout(p)
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 6]])
    expect(lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'wbr'])
    expect(lines[0]!.geometry.boxes.every(b => b.kind === 'text')).toBe(true)
  })
})

describe('bidi lines with inline structure (InlineDisplayContentBuilder.cpp:728-1088)', () => {
  test('an RTL span with start padding: the box ends at the content edge and its text sits past the padding', () => {
    const block = treeParagraph([], fontWith(), { direction: 'rtl', width: 100 })
    const p = treeParagraph([span(block, [{ kind: 'text', text: 'אב' }], {}, { margin: 0, border: 0, padding: 6 })], fontWith(), { direction: 'rtl', width: 100 })
    const { lines } = layout(p)
    const boxes = lines[0]!.geometry.boxes
    // Content 16 + 6 of padding right-aligned in 100: the box spans [78, 100], the text [78, 94].
    expect(boxes.find(b => b.kind === 'inline-box')).toEqual({ kind: 'inline-box', element: 0, x: 78, width: 22, hasStartEdge: true, hasEndEdge: true })
    expect(textBoxes(boxes)[0]!.x).toBe(78)
  })

  test('a span in two places on a reordered line: only its first display box is its first box (computeIsFirstIsLastBox)', () => {
    // rule/box-edges c-20592b0063422319: in an RTL block the span's hanging space goes to the line's left at the root level
    // and its word stays with the LTR text at the right, so the span has two display boxes on line 0. The start padding goes
    // on the first one in box order alone (InlineDisplayContentBuilder.cpp:1036-1060, :770-782).
    const block = treeParagraph([], fontWith(), { direction: 'rtl', width: 100, whiteSpace: 'pre-wrap' })
    const p = { ...block, content: [{ kind: 'text' as const, text: 'xx aaaa ' }, span(block, [{ kind: 'text', text: 'bbbb cccc' }], {}, { margin: 0, border: 0, padding: 6 }), { kind: 'text' as const, text: ' dddd' }] }
    const { lines } = layout(p)
    expect([lines[0]!.start, lines[0]!.end]).toEqual([0, 13])
    const inlineBoxes = lines[0]!.geometry.boxes.filter(b => b.kind === 'inline-box')
    expect(inlineBoxes.map(b => [b.width, b.hasStartEdge, b.hasEndEdge])).toEqual([[10, true, false], [32, false, false]])
  })

  test('an RTL atomic inline follows visual order with its line-left margin', () => {
    const p = treeParagraph([{ kind: 'text', text: 'אב ' }, atomic(20, 3, 5), { kind: 'text', text: ' גד' }], fontWith(), { direction: 'rtl', width: 200 })
    const { lines } = layout(p)
    const atom = lines[0]!.geometry.boxes.find(b => b.kind === 'atomic')!
    // Visually: "גד" (16), " " (4), margin end 5, the box, margin start 3, " " (4), "אב" (16); content 68 from 132.
    expect(atom).toMatchObject({ kind: 'atomic', element: 0, x: 157, width: 20 })
  })
})

describe('text shaping across inline boxes (InlineLineBuilder.cpp:780-1028)', () => {
  test('a run takes the joined text from the run on less the text after it, each after U+200D where the edge joins', () => {
    // A beh followed by a joiner or a letter is 5 wide (initial or medial form); a last one is 7 after one (final), else 8.
    contextual = (s, i) => s.charCodeAt(i) !== 0x628 ? null : i + 1 < s.length ? 5 : i > 0 ? 7 : null
    const block = treeParagraph([], fontWith(), { direction: 'rtl', width: 500 })
    const p = treeParagraph([{ kind: 'text', text: 'بب' }, span(block, [{ kind: 'text', text: 'بب' }])], fontWith(), { direction: 'rtl', width: 500 })
    const { lines } = layout(p)
    contextual = () => null
    // The first run's last letter joins the span's first: 5 + 5, where the run alone is 5 + 7.
    expect(textBoxes(lines[0]!.geometry.boxes).map(b => [b.run, b.width])).toEqual([[1, 12], [0, 10]])
  })

  test('a letter whose form follows the letters after it is measured with them, and the shares add up to the joined text', () => {
    // A beh with two or more behs after it is 6 wide, with one 5, a last one after a letter or a joiner 7.
    contextual = (s, i) => {
      if (s.charCodeAt(i) !== 0x628) return null
      let after = 0
      for (let k = i + 1; k < s.length; k++) if (s.charCodeAt(k) === 0x628) after++
      return after >= 2 ? 6 : after === 1 || i + 1 < s.length ? 5 : i > 0 ? 7 : null
    }
    const block = treeParagraph([], fontWith(), { direction: 'rtl', width: 500 })
    const p = treeParagraph([{ kind: 'text', text: 'بب' }, span(block, [{ kind: 'text', text: 'ببب' }])], fontWith(), { direction: 'rtl', width: 500 })
    const { lines } = layout(p)
    contextual = () => null
    // The joined text is 6 + 6 + 6 + 5 + 7; the span's run after a joiner 6 + 5 + 7; the first run alone before a joiner 5 + 5.
    expect(textBoxes(lines[0]!.geometry.boxes).map(b => [b.run, b.width])).toEqual([[1, 18], [0, 12]])
    expect(lines[0]!.geometry.contentWidth).toBe(30)
  })

  test('letters that do not join across the edge get no joiner (Joining_Type)', () => {
    // A beh or reh before a joiner or after one takes a joined form, 5 wide; else 8.
    contextual = (s, i) => (s.charCodeAt(i) === 0x628 || s.charCodeAt(i) === 0x631) && (s.charCodeAt(i + 1) === 0x200d || s.charCodeAt(i - 1) === 0x200d) ? 5 : null
    const block = treeParagraph([], fontWith(), { direction: 'rtl', width: 500 })
    const widths = (first: string, second: string) => textBoxes(layout(treeParagraph([{ kind: 'text', text: first }, span(block, [{ kind: 'text', text: second }])], fontWith(), { direction: 'rtl', width: 500 })).lines[0]!.geometry.boxes).map(b => b.width)
    const joined = widths('ب', 'ب')
    const afterReh = widths('ر', 'ب')
    const afterMark = widths('بِ', 'ب')
    const afterNonJoiner = widths('ب\u200c', 'ب')
    contextual = () => null
    // The span's run is measured after U+200D only where the letter before the edge joins forward: reh is Right_Joining,
    // a mark is Transparent, U+200C is Non_Joining.
    expect([joined[0], afterReh[0], afterMark[0], afterNonJoiner[0]]).toEqual([5, 8, 5, 8])
  })

  test('RTL complex text joined over an undecorated span edge is one shaping range: one run per box, the line gap', () => {
    // The stand-in Canvas is additive, so the widths equal separate measurement; the ranges, run splits and gap are the rule.
    const block = treeParagraph([], fontWith(), { direction: 'rtl', width: 500 })
    const p = treeParagraph([{ kind: 'text', text: 'بب' }, span(block, [{ kind: 'text', text: 'بب' }]), { kind: 'text', text: 'بب' }], fontWith(), { direction: 'rtl', width: 500 })
    const { lines } = layout(p)
    expect(lines[0]!.gaps.map(g => g.gap)).toEqual(['rtl-shaping-across-inline-boxes'])
    const boxes = textBoxes(lines[0]!.geometry.boxes)
    expect(boxes.map(b => [b.run, b.width, b.shapedAcrossBoxes])).toEqual([[2, 16, true], [1, 16, true], [0, 16, true]])
  })

  test('a decorated span edge breaks the range', () => {
    const block = treeParagraph([], fontWith(), { direction: 'rtl', width: 500 })
    const p = treeParagraph([{ kind: 'text', text: 'بب' }, span(block, [{ kind: 'text', text: 'بب' }], {}, { margin: 0, border: 0, padding: 2 }, { margin: 0, border: 0, padding: 2 })], fontWith(), { direction: 'rtl', width: 500 })
    const { lines } = layout(p)
    expect(lines[0]!.gaps.map(g => g.gap)).toEqual([])
    expect(textBoxes(lines[0]!.geometry.boxes).every(b => !b.shapedAcrossBoxes)).toBe(true)
  })
})

describe('text-indent, text-align and line slots (DESIGN.md §2.9)', () => {
  test('text-indent narrows the first formatted line only and moves its content (InlineLineBuilder.cpp:453-478)', () => {
    const { lines } = layout(paragraph([['aa bb cc', 'text']], { width: 50, textIndent: 20 }))
    expect(lines.map(l => [l.start, l.end, l.indented])).toEqual([[0, 3, true], [3, 8, false]])
    expect(lines[0]!.geometry.lineBoxWidth).toBe(30)
    expect(textBoxes(lines[0]!.geometry.boxes)[0]!.x).toBe(20)
    expect(textBoxes(lines[1]!.geometry.boxes)[0]!.x).toBe(0)
  })

  test('text-align end moves boxes by the available space; center by half (InlineFormattingUtils.cpp:198-276)', () => {
    const end = layout(paragraph([['ab', 'text']], { width: 100, textAlign: 'end' }))
    expect(end.lines[0]!.geometry.alignmentOffset).toBe(84)
    expect(textBoxes(end.lines[0]!.geometry.boxes)[0]!.x).toBe(84)
    expect(end.lines[0]!.align).toBe('end')
    const center = layout(paragraph([['ab', 'text']], { width: 100, textAlign: 'center' }))
    expect(center.lines[0]!.geometry.alignmentOffset).toBe(42)
  })

  test('text-align justify spreads the space over the opportunities of all but the last line (InlineContentAligner.cpp:150-267)', () => {
    const { lines } = layout(paragraph([['ab cd ef', 'text']], { width: 45, textAlign: 'justify' }))
    expect(lines.map(l => [l.start, l.end, l.align])).toEqual([[0, 6, 'justify'], [6, 8, 'start']])
    const box = textBoxes(lines[0]!.geometry.boxes)[0]!
    expect([box.start, box.end, box.width, box.expansion]).toEqual([0, 5, 45, 9])
    expect(box.expansionBehavior).toEqual({ left: 'forbid', right: 'forbid' })
    expect(lines[0]!.geometry.contentWidth).toBe(45)
    expect(lines[0]!.geometry.alignmentOffset).toBe(0)
    expect(textBoxes(lines[1]!.geometry.boxes)[0]!.expansion).toBe(0)
  })

  test('a slot inset narrows the line through floatAvoidingRect (InlineLineBuilder.cpp:1185-1216)', () => {
    const { lines } = layout(paragraph([['aa bb', 'text']], { width: 50 }), [{ left: 20, right: 0 }])
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5]])
    expect(lines[0]!.geometry.lineBoxWidth).toBe(30)
    expect(textBoxes(lines[0]!.geometry.boxes)[0]!.x).toBe(20)
    expect(lines[0]!.slot).toEqual({ width: 50, left: 20, right: 0 })
  })

  test('content that does not fit beside floats moves below them (InlineFormattingUtils.cpp:54-103)', () => {
    const { lines, belowFloats } = layout(paragraph([['aaaaa', 'text']], { width: 50 }), [{ left: 30, right: 0 }])
    expect(belowFloats).toEqual([0])
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 5]])
  })

  test('the first build places the slot floats: its tab stops count from the indented line start, later builds from the content box (InlineLineBuilder.cpp:478, :1394-1396)', () => {
    // SPACE 4, tab-size 4: stops every 16px. 'a' is 8 wide.
    const p = paragraph([['a\tb\na\tb', 'text']], { width: 100, whiteSpace: 'pre-wrap', tabSize: 4 })
    const { lines } = layout(p, [{ left: 20, right: 0 }, { left: 20, right: 0 }])
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 4], [4, 7]])
    expect(lines.map(l => l.geometry.contentEdgeOffset)).toEqual([0, 20])
    // First build: position 0 + 8, the tab is 8 wide. Second: position 20 + 8, the tab is 4 wide.
    expect(textBoxes(lines[0]!.geometry.boxes)[0]!.width).toBe(24)
    expect(textBoxes(lines[1]!.geometry.boxes)[0]!.width).toBe(20)
  })

  test('a refused first build hands on the placed floats: the retried line counts tab stops from the content box', () => {
    const p = paragraph([['aaaa\tb', 'text']], { width: 100, whiteSpace: 'pre-wrap', tabSize: 4 })
    const { lines, belowFloats } = layout(p, [{ left: 95, right: 0 }, { left: 20, right: 0 }])
    expect(belowFloats).toEqual([0])
    expect(lines[0]!.geometry.contentEdgeOffset).toBe(20)
    // Position 20 + 32 = 52: the tab is 12 wide.
    expect(textBoxes(lines[0]!.geometry.boxes)[0]!.width).toBe(52)
  })
})
