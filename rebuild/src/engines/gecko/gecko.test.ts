// Gecko port tests on the specs' worked examples and installed Firefox 156 verdicts (specs/probes-firefox.md), with a
// stand-in OffscreenCanvas: every code point of 16px Courier New is 576 au (specs/gecko-lines.md §2.5), so widths are
// known without a browser. Break scans come from the groundwork oracle's unit cases
// (runtime-parity/gecko/tools/unit.ts, answered by Firefox's own nsLineBreaker and ICU4X data). Widths here are Gecko's
// own line boxes and frames; what a Range reports is lab/observe/gecko.ts's business.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { paragraphGaps, prepare } from '../../index.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type Gap, type InlineNode, type LineOf, type Paragraph } from '../../model.js'
import { everyLine, type Insets, type Sized } from '../../test-lines.js'
import { parseFamilyList, sameFontForTextRun } from './fonts.js'
import type { GeckoLineGeometry, GeckoLineStart, GeckoTextFrame } from './geometry.js'
import { fillLine, firstLine, inspectLine, linePieces, paragraphGaps as geckoParagraphGaps } from './index.js'
import { BREAK_EMERGENCY_WRAP, BREAK_NORMAL } from './linebreak.js'
import { prepareGecko } from './prepare.js'

// A line as the tests read it: what everyLine gathers of a decided line (test-lines.ts).
type GeckoLine = LineOf<GeckoLineStart, GeckoLineGeometry>

// The stand-in's widths in au at apd 60. Any code point is 576 au at 16px, scaled with the size, with these exceptions,
// each modelled on an installed-Firefox measurement:
// - "AV" kerns by −60 au (a GPOS pair across an in-word offset).
// - "(" is 367 au, or 660 au in a string with an Arabic letter, where the itemizer gives it the Arabic script (Amiri,
//   gecko-AUDIT probe A1).
// - U+1F600, U+1F469, U+1F680 and the ligature U+1F469 U+200D U+1F680 take Apple Color Emoji's whole-pixel advances
//   (960, 1260, 1500 and 1920 au at 12, 16, 24 and 32px, specs/gecko-canvas.md §1.9) in every family, except a
//   text-presentation U+1F600 U+FE0E, and U+1F600 alone once `stub.pinned` (probe gecko-port F3), which draw with a text
//   font at 1020 au outside "Apple Color Emoji". U+200D, U+FE0E and U+FE0F have no advance.
// - Beh (U+0628) is 40 au narrower on each side it joins: next to another beh, a hah (U+062D) or U+200D. Before a hah it
//   takes a form 100 au narrower still, which no U+200D gives (a contextual form, as Amiri's meem before reh in probe
//   gecko-port F15).
const stub = { pinned: false }
// What the stand-in was asked since the last reset: its contexts as the library set them, and every measureText string.
type StubSettings = { font: string; lang: string; letterSpacing: string }
type StubLog = { contexts: StubSettings[]; calls: { text: string }[] }
let asked: StubLog = { contexts: [], calls: [] }
function stubAu(font: string, text: string, lang: string): number {
  const size = Number(/([\d.]+)px/.exec(font)![1])
  const emojiFont = font.includes('Apple Color Emoji')
  const emoji = size === 12 ? 960 : size === 16 ? 1260 : size === 24 ? 1500 : size === 32 ? 1920 : Math.round(size * 60)
  const arabic = /[ء-ي]/.test(text)
  const cps = [...text]
  let au = 0
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]!
    if (c === '‍' || c === '‌' || c === '︎' || c === '️') continue
    if (c === '👩' && cps[i + 1] === '‍' && cps[i + 2] === '🚀') {
      au += emoji
      i += 2
      continue
    }
    if (c === '😀' || c === '👩' || c === '🚀') {
      au += !emojiFont && (cps[i + 1] === '︎' || (stub.pinned && c === '😀')) ? 1020 : emoji
      // Synthetic bold: NS_round(offset × 60) at weight 700, offset = 0.25 + 0.75 × size / 48 (gfxFont.h:1899-1904).
      if (/ 700 /.test(font)) au += Math.floor((0.25 + 0.75 * size / 48) * 60 + 0.5)
      continue
    }
    if (c === '(') {
      au += arabic ? 660 : 367
      continue
    }
    // `ff` is a ligature of 1140 au, taken from the start of the text: `fff` is `ff` and `f`.
    if (c === 'f' && cps[i + 1] === 'f') {
      au += Math.round(1140 * size / 16)
      i++
      continue
    }
    // `To` under a kern table: T is 576.4 au and o 576.8 au at 16px, the pair adjustment −45 au, half on each glyph, and each
    // glyph's advance is rounded on its own (hb-kern.hh:102-106, gfxHarfBuzzShaper.cpp:1699-1702): 554 + 554 at 16px.
    if (c === 'T' || c === 'o') {
      const kerned = (c === 'T' && cps[i + 1] === 'o') || (c === 'o' && cps[i - 1] === 'T')
      au += Math.floor(((c === 'T' ? 576.4 : 576.8) - (kerned ? 22.5 : 0)) * size / 16 + 0.5)
      continue
    }
    // Lam with alef madda is one glyph of 1001 au: the alef adds 425 au after a lam.
    if (c === 'آ' && cps[i - 1] === 'ل') {
      au += Math.round(425 * size / 16)
      continue
    }
    if (c === 'ب') {
      const before = cps[i - 1]
      const after = cps[i + 1]
      au += Math.round(576 * size / 16) - (before === 'ب' || before === 'ح' || before === '‍' ? 40 : 0) - (after === 'ب' || after === 'ح' || after === '‍' ? 40 : 0) - (after === 'ح' ? 100 : 0)
      continue
    }
    if (c === ' ' && font.includes('Arial')) {
      au += 60 * Math.floor(size / 5 + 0.5) // Arial has no U+2009: Gecko synthesizes it (gfxTextRun.cpp:3032-3043)
      continue
    }
    au += Math.round(576 * size / 16)
    if (c === 'A' && cps[i + 1] === 'V') au -= 60
    // "7:" kerns by −40 au, except where Common text resolves to Hangul from the language and CJK scripts turn kerning off
    // (probe gecko-port F8): a string without a Latin letter under lang="ko".
    if (c === '7' && (cps[i + 1] === ':' || cps[i + 1] === '7') && !(lang.startsWith('ko') && !/[A-Za-z]/.test(text))) au -= 40
  }
  return au
}

beforeAll(() => {
  class StubContext {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      asked.calls.push({ text: s })
      // Letter spacing goes after every ligature group (CanvasRenderingContext2D.cpp:4759-4790): a code point, with the
      // joiners and selectors after it; lam with alef is one group (a required ligature, as wide as its parts here), and so
      // is U+0E24 U+0E32 (Thonburi, probe gecko-port F17).
      let groups = 0
      const cps = [...s]
      for (let i = 0; i < cps.length; i++) {
        if (i > 0 && (cps[i] === '‍' || cps[i] === '‌' || cps[i] === '︎' || cps[i] === '️' || /\p{M}/u.test(cps[i]!))) continue
        if (((cps[i] === 'ا' || cps[i] === 'آ') && cps[i - 1] === 'ل') || (cps[i] === 'า' && cps[i - 1] === 'ฤ')) continue
        groups++
      }
      const spacing = this.letterSpacing === '2px' ? 120 * groups : 0
      const width = Math.fround((stubAu(this.font, s, this.lang) + spacing) / 60)
      // "fi" forms a ligature as wide as its parts whose ink box ends 0.36 au further with ligatures off (probe gecko-port F9).
      // So does "ff", which the stub keeps as wide with ligatures off.
      const right = (s === 'fi' || s === 'ff') && this.letterSpacing !== '0px' ? width + 0.006 : width
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: right }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    getContext() {
      const context = new StubContext()
      asked.contexts.push(context)
      return context
    }
  }
})

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}
const facts = { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false }
const courier: FontDecl = { family: '"Courier New"', size: 16, weight: 400, style: 'normal', facts }
const arial = (size: number): FontDecl => ({ family: 'Arial', size, weight: 400, style: 'normal', facts })

// The flat form the probe verdicts were written in: runs that are spans or bare text nodes, the block's wrapping styles
// everywhere (DESIGN.md §1.1, "Flat paragraphs").
type Run = { text: string; node: 'span' | 'text'; font: FontDecl; letterSpacing: number; wordSpacing: number; lang: string | null }
type Flat = Omit<Sized, 'content'>

function run(text: string, node: 'span' | 'text' = 'text', extra: Partial<Run> = {}): Run {
  return { text, node, font: courier, letterSpacing: 0, wordSpacing: 0, lang: null, ...extra }
}

function paragraph(runs: Run[], width: number, extra: Partial<Flat> = {}): Sized {
  const block: Flat = {
    font: courier, letterSpacing: 0, wordSpacing: 0, width, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', ...extra,
  }
  const content: InlineNode[] = runs.map(r => r.node === 'text' ? { kind: 'text', text: r.text } : {
    kind: 'span', font: r.font, letterSpacing: r.letterSpacing, wordSpacing: r.wordSpacing, whiteSpace: block.whiteSpace, wordBreak: block.wordBreak,
    overflowWrap: block.overflowWrap, lineBreak: block.lineBreak, tabSize: block.tabSize, lang: r.lang, inlineStart: NO_BOX_EDGE,
    inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: r.text }],
  })
  return { ...block, content }
}

function textFrames(l: GeckoLine): GeckoTextFrame[] {
  return l.geometry.frames.filter((f): f is GeckoTextFrame => f.kind === 'text')
}

type GeckoLayout = { lines: GeckoLine[]; belowFloats: { row: number; gaps: Gap[] }[]; measure: StubLog; gaps: Gap[] }

// The lab's line loop (lab/predictor-core.ts) over a paragraph prepared through src/index.ts, font checks included.
function layout(p: Sized, e: GeckoEnvironment = env, insets: Insets[] = []): GeckoLayout {
  const measure: StubLog = asked = { contexts: [], calls: [] }
  const prepared = prepare(p, e, true)
  if (prepared.engine !== 'gecko') throw new Error('expected a gecko paragraph')
  const state = prepared.state
  const { lines, belowFloats } = everyLine({
    first: firstLine(state), fill: (start, slot) => fillLine(state, start, slot), inspect: line => inspectLine(state, line), pieces: line => linePieces(state, line),
  }, p.width, insets)
  return { lines, belowFloats, measure, gaps: paragraphGaps(prepared) }
}

// The first laid-out character of each line with a line box.
function starts(p: Sized): number[] {
  const out: number[] = []
  const lines = layout(p).lines
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!
    if (!line.hasLineBox) continue
    const first = line.fragments.find(f => f.kind === 'text' || f.kind === 'hanging' || f.kind === 'trimmed')
    out.push(first === undefined ? line.start : first.start)
  }
  return out
}

// Gecko's line box widths (psd->mICoord after TrimTrailingWhiteSpaceIn) of the lines with a line box, in au.
function widths(p: Sized): number[] {
  return layout(p).lines.filter(l => l.hasLineBox).map(l => l.geometry.width)
}

function allGaps(l: GeckoLayout): Gap[] {
  return l.gaps.concat(...l.lines.map(line => line.gaps))
}

describe('gecko line filling (probes-firefox verdicts)', () => {
  test('H1 fit uses <= in au', () => {
    expect(starts(paragraph([run('aaaa bbbb')], 86.4))).toEqual([0])
    expect(starts(paragraph([run('aaaa bbbb')], 86.38))).toEqual([0, 5])
  })
  test('H2 trailing spaces do not count', () => {
    expect(starts(paragraph([run('aaaa bbbb cccc')], 86.4))).toEqual([0, 10])
  })
  test('H4 letter spacing 1 au per cluster, kept at the line end', () => {
    expect(starts(paragraph([run('aaaa bbbb', 'span', { letterSpacing: 0.01 })], 86.55))).toEqual([0])
    expect(starts(paragraph([run('aaaa bbbb', 'span', { letterSpacing: 0.01 })], 86.5))).toEqual([0, 5])
  })
  test('H5 letter spacing 1px', () => {
    expect(starts(paragraph([run('aaaa bbbb', 'span', { letterSpacing: 1 })], 95.4))).toEqual([0])
    expect(starts(paragraph([run('aaaa bbbb', 'span', { letterSpacing: 1 })], 95.35))).toEqual([0, 5])
  })
  test('H8 after-hyphen emergency break only without an ordinary break', () => {
    expect(starts(paragraph([run('x aaaa-1111')], 57.6))).toEqual([0, 2, 7])
    expect(starts(paragraph([run('aaaa-1111')], 57.6))).toEqual([0, 5])
    expect(starts(paragraph([run('aaaa-1111')], 57.6, { whiteSpace: 'nowrap' }))).toEqual([0])
  })
  test('coverage facts settle the emergency break after a hyphen (gfxFont.cpp:741-753, gfxTextRun.cpp:2930-3000)', () => {
    const listed = (coverage: number[] | null): FontDecl => ({ ...courier, facts: { ...facts, fonts: [{ family: '"Courier New"', realizes: true, coverage, ligatures: null, scriptLookups: null }] } })
    const broken = (font: FontDecl, text: string) => layout(paragraph([run(text, 'span', { font })], 57.6, { font }))
    // One font draws a, the hyphen and 1: the break exists, and nothing is reported.
    const ascii = broken(listed([0x20, 0x7e]), 'aaaa-1111')
    expect(ascii.lines.map(line => line.start)).toEqual([0, 5])
    expect(allGaps(ascii).map(g => g.gap)).not.toContain('font-fallback')
    // The letter before the hyphen falls back: the hyphen starts another shaped word, and no break follows it.
    const fallback = broken(listed([0x20, 0x7e]), '中中中中-1111')
    expect(fallback.lines.map(line => line.start)).toEqual([0, 3]) // 中-1111 stays whole: six characters fit
    expect(allGaps(fallback).map(g => g.gap)).not.toContain('font-fallback')
    // Without the fact the break stays, under font-fallback.
    expect(allGaps(broken(listed(null), 'aaaa-1111')).map(g => g.gap)).toContain('font-fallback')
    expect(allGaps(broken(courier, 'aaaa-1111')).map(g => g.gap)).toContain('font-fallback')
  })
  test('H9 overflow-wrap splits a word only on a line without an ordinary break', () => {
    expect(starts(paragraph([run('aa bbbbbbbbbb')], 57.6, { overflowWrap: 'anywhere' }))).toEqual([0, 3, 9])
    expect(starts(paragraph([run('aa bbbbbbbbbb')], 57.6, { overflowWrap: 'break-word' }))).toEqual([0, 3, 9])
  })
  test('H10 backup across a span edge', () => {
    expect(starts(paragraph([run('aa b'), run('bbbbb', 'span')], 57.6))).toEqual([0, 3])
  })
  test('H11 no break between styled runs', () => {
    const bold = { ...courier, weight: 700 }
    expect(starts(paragraph([run('foo', 'span', { font: bold }), run('bar')], 28.8))).toEqual([0])
  })
  test('H13 pre-wrap hangs trailing spaces; H14 break-spaces moves the third space', () => {
    expect(starts(paragraph([run('aaaa   bb')], 57.6, { whiteSpace: 'pre-wrap' }))).toEqual([0, 7])
    // The line box keeps the non-overflowing part of the spaces: 3456 − 2304 au of the hangable 1728.
    expect(widths(paragraph([run('aaaa   bb')], 57.6, { whiteSpace: 'pre-wrap' }))).toEqual([3456, 1152])
    const first = layout(paragraph([run('aaaa   bb')], 57.6, { whiteSpace: 'pre-wrap' })).lines[0]!
    expect(first.fragments.map(f => f.kind)).toEqual(['text', 'hanging'])
    expect(first.geometry.hang).toBe(1152)
    expect(starts(paragraph([run('aaaa   bb')], 57.6, { whiteSpace: 'break-spaces' }))).toEqual([0, 6])
  })
  test('H15 tab stops', () => {
    expect(widths(paragraph([run('a\tb')], 500, { whiteSpace: 'pre' }))).toEqual([4608 + 576])
    expect(widths(paragraph([run('aaaaaaa\tb')], 500, { whiteSpace: 'pre' }))).toEqual([4608 + 576])
    expect(widths(paragraph([run('aaaaaaaa\tb')], 500, { whiteSpace: 'pre' }))).toEqual([9216 + 576])
  })
  test('tab widths: tab-size 0 and a negative tab width leave tabs at 0 (nsTextFrame.cpp:4306-4309)', () => {
    expect(widths(paragraph([run('a\tb')], 500, { whiteSpace: 'pre', tabSize: 0 }))).toEqual([1152])
    // letter-spacing -10px: 8 × (576 − 600) au is negative, so no tab stops; `a` and `b` each get −600 au, and the frame
    // width is ceil(max(0, −48)) = 0 (nsTextFrame.cpp:11272-11273).
    expect(widths(paragraph([run('a\tb', 'text', { letterSpacing: -10 })], 500, { whiteSpace: 'pre', letterSpacing: -10 }))).toEqual([0])
  })
  test('a tab counts only clusters that start in its frame, and is a stand-in after one (nsTextFrame.cpp:4349-4357)', () => {
    // A span starts at U+0301 inside the cluster of `e`: the frame before it takes the cluster (a stand-in), the mark adds
    // nothing to the tab's position, and the tab is the stop less a position that rests on the stand-in.
    const l = layout(paragraph([run('ae'), run('\u0301x\tb', 'span')], 500, { whiteSpace: 'pre' }))
    const frames = textFrames(l.lines[0]!)
    expect(frames.map(f => f.width)).toEqual([1728, 576 + 2304 + 576])
    expect(frames[1]!.characters.map(c => c.standInBefore)).toEqual([true, false, false, true])
    expect(frames[1]!.standInAtEnd).toBe(true)
    expect(l.lines[0]!.gaps.filter(g => g.at !== undefined && g.at.end === g.at.start + 1).map(g => [g.gap, g.at])).toEqual([['in-word-prefix', { start: 4, end: 5 }]])
    // Without a stand-in before it, a tab is exact.
    const plain = layout(paragraph([run('ae'), run('x\tb', 'span')], 500, { whiteSpace: 'pre' }))
    expect(plain.lines[0]!.gaps).toEqual([])
    expect(textFrames(plain.lines[0]!)[1]!.characters.map(c => c.standInBefore)).toEqual([false, false, false])
  })
  test('a tab position takes spacing one character at a time: a mark is its own base (nsTextFrame.cpp:4345-4347, :4203-4213)', () => {
    // Beh with fatha under 1px of letter spacing: the cluster takes none (a cursive base), but CalcTabWidths asks for the
    // fatha alone, script Inherited, so the tab counts from 1152 + 60 au: the stop at 8 × (576 + 60) au less that, and the
    // tab ends 60 au before the stop. The block is right-to-left, so the tab stays in the letter's frame, whose text run it
    // ends: a text run's last character takes letter spacing whatever it is (CanAddSpacingAfter, :3860-3873).
    const spaced = { letterSpacing: 1 }
    expect(widths(paragraph([run('\u0628\u064e\tb')], 500, { whiteSpace: 'pre', direction: 'rtl', ...spaced }))).toEqual([1152 + (5088 - 1212) + 60 + 636])
    expect(widths(paragraph([run('a\u0301\tb')], 500, { whiteSpace: 'pre', ...spaced }))).toEqual([5088 + 636])
  })
  test('H16 the hyphen letter spacing counts for fit, not width', () => {
    const p = paragraph([run('aaaa­bbbb', 'span', { letterSpacing: 1 })], 53)
    expect(starts(p)).toEqual([0, 5])
    expect(widths(p)[0]).toBe(4 * 636 + 576)
    const frame = textFrames(layout(p).lines[0]!)[0]!
    expect(frame.usedHyphen).toBe(true)
    expect(frame.characters.map(c => [c.skipped, c.advance])).toEqual([[false, 636], [false, 636], [false, 636], [false, 636], [true, 0]])
  })
  test('H22 soft hyphen at a frame end plus backup', () => {
    expect(starts(paragraph([run('aaaa­'), run('bbbb', 'span')], 57.6))).toEqual([0, 5])
  })
  test('H23 the first candidate is taken even when it overflows', () => {
    const p = paragraph([run('aaaaaaaa bb')], 57.6)
    expect(starts(p)).toEqual([0, 9])
    expect(widths(p)[0]).toBe(4608)
  })
  test('H24 pre-line removes spaces around a newline', () => {
    const p = paragraph([run('aaaa \n bb', 'span')], 500, { whiteSpace: 'pre-line' })
    expect(starts(p)).toEqual([0, 7])
    expect(widths(p)).toEqual([2304, 1152])
  })
  test('W3 VT stays at the end of line 1 with the space kept', () => {
    const p = paragraph([run('aaaa bbbbb')], 57.6)
    expect(starts(p)).toEqual([0, 6])
    expect(widths(p)[0]).toBe(2880)
  })
  test('H12b end padding control: aaa aaa fits exactly', () => {
    expect(starts(paragraph([run('aaa aaa b', 'span')], 67.2))).toEqual([0, 8])
  })
  test('gecko-text H1, H2, H7, H19, H26 at 1px', () => {
    const bold = { ...courier, weight: 700 }
    expect(starts(paragraph([run('foo', 'span', { font: bold }), run('bar')], 1))).toEqual([0])
    expect(starts(paragraph([run('foo'), run(' ', 'span', { font: bold }), run('bar')], 1))).toEqual([0, 4])
    expect(starts(paragraph([run('foo bar')], 1))).toEqual([0])
    expect(starts(paragraph([run('foo​bar')], 1))).toEqual([0, 4])
    expect(starts(paragraph([run('1-2')], 1))).toEqual([0, 2])
    expect(starts(paragraph([run('12')], 1))).toEqual([0])
  })
  test('tiling: lines cover the source', () => {
    const p = paragraph([run('  Hello  '), run(' world ', 'span'), run('  ')], 60)
    const l = layout(p)
    let at = 0
    for (let k = 0; k < l.lines.length; k++) {
      expect(l.lines[k]!.start).toBe(at)
      let f = at
      for (const fragment of l.lines[k]!.fragments) {
        if (fragment.kind === 'box-start' || fragment.kind === 'box-end' || fragment.kind === 'atomic' || fragment.kind === 'br' || fragment.kind === 'wbr') continue
        const s = fragment.kind === 'hyphen' ? fragment.at : fragment.start
        expect(s).toBe(f)
        if (fragment.kind !== 'hyphen') f = fragment.end
      }
      expect(f).toBe(l.lines[k]!.end)
      at = l.lines[k]!.end
    }
    expect(at).toBe('  Hello  '.length + ' world '.length + 2)
  })
})

describe('gecko engine output', () => {
  test('a line of only collapsed white space is returned without a line box (nsLineLayout.cpp:1690-1712)', () => {
    const l = layout(paragraph([run('aaa\n   ', 'span')], 500, { whiteSpace: 'pre-line' }))
    expect(l.lines.map(line => [line.start, line.end, line.hasLineBox])).toEqual([[0, 4, true], [4, 7, false]])
    expect(l.lines[1]!.fragments.map(f => f.kind)).toEqual(['collapsed', 'box-end'])
    expect(textFrames(l.lines[1]!).map(f => [f.contentStart, f.contentEnd, f.measuredStart, f.width, f.hasHeight])).toEqual([[4, 7, 7, 0, false]])
  })
  test('hanging white space is CharIsSpace only: a trailing TAB stays text (gfxTextRun.cpp:1152-1159, gfxFont.cpp:749-750)', () => {
    const l = layout(paragraph([run('aaaa\t ')], 500, { whiteSpace: 'pre-wrap' }))
    expect(l.lines[0]!.fragments.map(f => [f.kind, 'start' in f ? f.start : -1])).toEqual([['text', 0], ['hanging', 5]])
  })
  test('trimmed at a break and by TrimTrailingWhiteSpace', () => {
    const broken = layout(paragraph([run('aaaa bbbb')], 57.6)).lines[0]!
    expect(broken.fragments.map(f => f.kind)).toEqual(['text', 'trimmed'])
    expect(broken.geometry.frames[0]!.width).toBe(2304)
    const trailing = layout(paragraph([run('aaaa '), run(' ', 'span')], 500)).lines[0]!
    expect(trailing.fragments.map(f => f.kind)).toEqual(['text', 'trimmed', 'box-start', 'collapsed', 'box-end'])
    expect(trailing.geometry.width).toBe(2304)
  })
  test('an RTL block places frames from the right edge (nsBidiPresUtils.cpp:1860-1866)', () => {
    const line = layout(paragraph([run('אב גד')], 500, { direction: 'rtl' })).lines[0]!
    expect(textFrames(line).map(f => [f.level, f.x, f.width])).toEqual([[1, 30000 - 2880, 2880]])
  })
  test('an RTL line places its visual order from the right edge (nsBidiPresUtils.cpp:1882-1905)', () => {
    // "אב cd": אב and the space at level 1 at the right edge, cd at level 2 to their left.
    const line = layout(paragraph([run('אב cd')], 500, { direction: 'rtl' })).lines[0]!
    expect(textFrames(line).map(f => [f.contentStart, f.level, f.x, f.width])).toEqual([[0, 1, 30000 - 1728, 1728], [3, 2, 30000 - 1728 - 1152, 1152]])
  })
  test('a wrapped line whose trailing white space hangs against the line direction moves by the hang (nsLineLayout.cpp:3598-3605)', () => {
    // "a אב " fits 48px exactly; the space after אב is at level 1, so its hangable 576 au sits at the start edge.
    const l = layout(paragraph([run('a אב גד')], 48, { whiteSpace: 'pre-wrap' }))
    const first = l.lines[0]!.geometry
    expect(first.hang).toBe(-576)
    expect(textFrames(l.lines[0]!).map(f => [f.contentStart, f.contentEnd, f.level, f.x, f.width])).toEqual([[0, 2, 0, -576, 1152], [2, 5, 1, 576, 1728]])
    expect(textFrames(l.lines[1]!).map(f => [f.contentStart, f.x])).toEqual([[5, 0]])
  })
  test('characters carry cluster flags and advances from the measured start', () => {
    const frame = textFrames(layout(paragraph([run('é b')], 500)).lines[0]!)[0]!
    // The stand-in gives U+0301 576 au, so the cluster e U+0301 is 1152 au on its first character.
    expect(frame.characters.map(c => [c.clusterStart, c.advance])).toEqual([[true, 1152], [false, 0], [true, 576], [true, 576]])
  })
  test('in-word-prefix goes on the line whose breaks consult the offset; the prepared paragraph never changes', () => {
    const p = paragraph([run('AVAV')], 20, { overflowWrap: 'anywhere' })
    const prepared = prepareGecko(p, env, true)
    const before = geckoParagraphGaps(prepared).length
    const slot = { width: p.width, left: 0, right: 0 }
    const first = inspectLine(prepared, fillLine(prepared, firstLine(prepared)!, slot).line).gaps
    const again = inspectLine(prepared, fillLine(prepared, firstLine(prepared)!, slot).line).gaps
    expect(first.map(g => g.gap)).toContain('in-word-prefix')
    expect(again).not.toBe(first)
    expect(again.map(g => g.gap)).toEqual(first.map(g => g.gap))
    expect(geckoParagraphGaps(prepared).length).toBe(before)
    expect(allGaps(layout(paragraph([run('aaaa')], 20, { overflowWrap: 'anywhere' }))).map(g => g.gap)).not.toContain('in-word-prefix')
  })
  test('letters joined across an in-word offset: both sides are measured with U+200D, and the prefix is exact where they add up', () => {
    // بببب is 536 + 496 + 496 + 536 au; ب alone is 576 au, and بب with U+200D after it 1032 au, its advance in the word.
    const p = paragraph([run('بببب')], 20, { overflowWrap: 'anywhere', direction: 'rtl' })
    const l = layout(p)
    expect(allGaps(l).map(g => g.gap)).not.toContain('in-word-prefix')
    expect(l.measure.calls.some(c => c.text === 'بب‍')).toBe(true)
    expect(starts(p)).toEqual([0, 2])
    expect(widths(p)).toEqual([1032, 1032])
  })
  test('a ligature group: Canvas letter spacing counts one group fewer, and its clusters share its advance (gfxTextRun.cpp:238-322)', () => {
    // دلآد: lam and alef madda form one group of 1001 au, which the DOM shares 500 and 501; the group's two ends add up.
    const l = layout(paragraph([run('دلآد')], 500, { direction: 'rtl' }))
    const frame = textFrames(l.lines[0]!)[0]!
    expect(frame.characters.map(c => c.advance)).toEqual([576, 500, 501, 576])
    expect(frame.characters.map(c => c.standInBefore)).toEqual([false, false, false, false])
    expect(allGaps(l).map(g => g.gap)).not.toContain('in-word-prefix')
  })
  test('the break scan takes a ligature group whole on its first character (gfxTextRun.cpp:989-1000, :1139-1159)', () => {
    // 20px holds د and half the group, 1076 au, but the scan adds the group's 1001 au at lam: 1577 au overflows, so the
    // line ends before lam. The next line starts with the group and ends inside it only when the scan says so.
    const p = paragraph([run('دلآد')], 20, { direction: 'rtl', overflowWrap: 'anywhere' })
    expect(starts(p)).toEqual([0, 1, 3])
    expect(widths(p)).toEqual([576, 1001, 576])
  })
  test('glyph-clusters names a letter-spaced unit only where Canvas counts fewer ligature groups than clusters', () => {
    const spaced = (text: string) => layout(paragraph([run(text, 'span', { letterSpacing: 1 })], 500))
    expect(allGaps(spaced('abc ฤา')).filter(g => g.gap === 'glyph-clusters').map(g => g.at)).toEqual([{ start: 4, end: 6 }])
    expect(allGaps(spaced('abc def')).map(g => g.gap)).not.toContain('glyph-clusters')
  })
  test('letters joined across an in-word offset whose sides do not add up report in-word-prefix on both lines of the break', () => {
    // ببحب: the second beh takes a narrower form before hah, 396 au, so W(بب U+200D) + W(U+200D حب) is 2144 au and the word 2044.
    const l = layout(paragraph([run('ببحب')], 20, { overflowWrap: 'anywhere', direction: 'rtl' }))
    expect(l.lines.map(line => line.start)).toEqual([0, 2])
    for (const line of l.lines) {
      expect(line.gaps.filter(g => g.gap === 'in-word-prefix' && g.detail.includes('letters join')).map(g => g.at)).toEqual([{ start: 2, end: 2 }])
    }
  })
  test('font facts: optical-size is reported where opsz is true or not given', () => {
    const unknown = { ...courier, facts: UNKNOWN_FONT_FACTS }
    expect(allGaps(layout(paragraph([run('a', 'text', { font: unknown })], 500, { font: unknown }))).map(g => g.gap)).toContain('optical-size')
    expect(allGaps(layout(paragraph([run('a')], 500))).map(g => g.gap)).not.toContain('optical-size')
  })
  test('nsLineBreaker takes Chinese or Japanese from likely subtags (specs/gecko-oracle-replay.md §4.1)', () => {
    const p = (lang: string) => prepareGecko(paragraph([run('あ；', 'span')], 100, { lineBreak: 'loose', lang }), env, true)
    expect(p('yue').breakFlags[1]).toBe(BREAK_NORMAL)
    expect(p('ko').breakFlags[1]).not.toBe(BREAK_NORMAL)
  })
})

describe('gecko font declarations (servo font.rs)', () => {
  test('family lists compare parsed, with syntax', () => {
    expect(parseFamilyList('"Times New Roman", Times  New Roman, serif, "serif", -moz-fixed')).toEqual([
      { kind: 'named', name: 'Times New Roman', syntax: 'quoted' }, { kind: 'named', name: 'Times New Roman', syntax: 'identifiers' },
      { kind: 'generic', name: 'serif' }, { kind: 'named', name: 'serif', syntax: 'quoted' }, { kind: 'generic', name: 'monospace' },
    ])
    expect(sameFontForTextRun({ ...courier, family: 'Arial,serif' }, { ...courier, family: 'Arial , serif' })).toBe(true)
    expect(sameFontForTextRun({ ...courier, family: 'Arial' }, { ...courier, family: '"Arial"' })).toBe(false)
  })
})

describe('gecko Canvas recipes (specs/gecko-AUDIT.md B1-B4)', () => {
  test('B3: a suffix is measured in the script the paragraph gives it', () => {
    // W("ا ((") − W("ا ") = 1320 au for "((" after Arabic, where "((" alone is 734 au: line 1 is لا( at exactly 1812 au.
    const p = paragraph([run('لا((')], 30.2, { direction: 'rtl', overflowWrap: 'anywhere' })
    expect(starts(p)).toEqual([0, 3])
    expect(widths(p)).toEqual([1812, 660])
  })

  test('B1a: the device-size emoji advance applies only where Canvas shows Apple Color Emoji draws the cluster', () => {
    const p = (text: string) => paragraph([run(text, 'span', { font: arial(16) })], 500, { font: arial(16) })
    const gapNames = (q: Sized) => allGaps(layout(q)).map(g => g.gap)
    try {
      expect(widths(p('😀'))).toEqual([960])
      expect(gapNames(p('😀'))).not.toContain('page-history')
      // U+FE0E on an emoji-default character: only the system-wide search finds a glyph without color, among the families
      // whose character maps the process has loaded by then (gfxPlatformFontList.cpp:1474-1486), unless a listed family has it.
      expect(widths(p('😀︎'))).toEqual([1020])
      expect(gapNames(p('😀︎'))).toContain('page-history')
      const listed = { ...arial(16), facts: { ...facts, fonts: [{ family: 'Arial', realizes: true, coverage: [0x20, 0x7e, 0x1f600, 0x1f600], ligatures: null, scriptLookups: null }] } }
      expect(gapNames(paragraph([run('😀︎', 'span', { font: listed })], 500, { font: listed }))).not.toContain('page-history')
      stub.pinned = true
      expect(widths(p('😀'))).toEqual([1020])
      expect(gapNames(p('😀'))).toContain('page-history')
    } finally {
      stub.pinned = false
    }
  })

  test('a position before a mark that starts a cluster is a stand-in (hb-ot-shaper-syllabic.cc:32-99, probe gecko-port F23)', () => {
    // U+102B and U+1038 are spacing marks outside Grapheme_Cluster_Break=SpacingMark, so each starts a cluster, but a string
    // that starts with one is a broken syllable to HarfBuzz and gets a dotted circle.
    const frame = textFrames(layout(paragraph([run('ငါးမ')], 500)).lines[0]!)[0]!
    expect(frame.characters.map(c => c.clusterStart)).toEqual([true, true, true, true])
    expect(frame.characters.map(c => c.standInBefore)).toEqual([false, true, true, false])
    expect(frame.characters.map(c => c.advance)).toEqual([576, 576, 576, 576])
  })

  test('B1c: a bitmap emoji under a bold font takes the DOM\'s synthetic bold step (gfxFont.cpp:3551-3562, probe gecko-port F24)', () => {
    // 20px: the device size is 40px, where the stub's emoji is 2400 au and Canvas's step NS_round(0.875 × 60) = 53; the DOM
    // has 1200 au and NS_round(0.875 × 30) = 26, where 2453 au × 30 / 60 rounds to 1227.
    const bold = { ...arial(20), weight: 700 }
    const l = layout(paragraph([run('😀', 'span', { font: bold })], 500, { font: bold }))
    expect(l.lines[0]!.geometry.width).toBe(1226)
    expect(allGaps(l).map(g => g.gap)).not.toContain('bitmap-emoji-size')
  })

  test('the space-in-shaping test reads Canvas widths only below 2^18 px (CanvasRenderingContext2D.cpp:5277)', () => {
    // 9,134 words of `aa ` are 15,783,552 au, 263,059.2px: measureText's float width is 1/32 px steps there and reads back
    // as 15,783,551 au. The test runs in windows under 2^18 px, which read back exactly, so nothing is reported.
    const long = prepareGecko(paragraph([run('aa '.repeat(9134))], 500), env, true)
    expect(Math.round(Math.fround(15783552 / 60) * 60)).toBe(15783551)
    expect(geckoParagraphGaps(long).map(g => g.gap)).toEqual([])
  })

  test('B1b: a soft hyphen inside a grapheme cluster puts the whole cluster before the break', () => {
    // c-27e5b02212b7324f: natively line 2 holds the ligated cluster (750 au) and the hyphen; U+1F680 starts line 3 at 0 au.
    const p = paragraph([run('a👩‍­🚀b', 'text', { font: arial(12) })], 8, { font: arial(12), whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
    expect(starts(p)).toEqual([0, 1, 5])
    expect(widths(p)).toEqual([432, 750 + 432, 432])
  })

  test('B4: trailing white space trimmed with a negative advance widens the line box', () => {
    // c-79e5272a2644d9b8: the space is 576 − 60 − 600 = −84 au; TrimTrailingWhiteSpace subtracts floor(−84) unclamped.
    const p = paragraph([run('aaaa', 'span'), run(' bbbb', 'span', { letterSpacing: -1, wordSpacing: -10 })], 57.6)
    expect(starts(p)).toEqual([0, 5])
    expect(textFrames(layout(p).lines[0]!).map(f => f.width)).toEqual([2304, 84])
    expect(widths(p)[0]).toBe(2304 + 84)
  })

  test('a synthesized Unicode space rounds to whole device pixels', () => {
    // 18px U+2009: Canvas 60 × floor(3.6 + 0.5) = 240 au; the DOM at apd 30 30 × floor(7.2 + 0.5) = 210 au.
    const arial18 = paragraph([run('a b', 'span', { font: arial(18) })], 500, { font: arial(18) })
    expect(widths(arial18)).toEqual([648 + 210 + 648])
    const courier18 = { ...courier, size: 18 }
    expect(widths(paragraph([run('a b', 'span', { font: courier18 })], 500, { font: courier18 }))).toEqual([648 * 3])
  })

  test('a hidden control with letter spacing has an advance', () => {
    // c-92b6963ae4344985: a lone VT with 1px letter spacing is 60 au natively.
    expect(widths(paragraph([run('\v', 'span', { letterSpacing: 1 })], 500))).toEqual([60])
  })
})

// Break positions of one text node, as the groundwork oracle reports them.
function breaks(text: string, whiteSpace: Paragraph['whiteSpace'] = 'normal', wordBreak: Paragraph['wordBreak'] = 'normal') {
  const p = prepareGecko(paragraph([run(text, 'span')], 100, { whiteSpace, wordBreak }), env, true)
  const normal: number[] = []
  const emergency: number[] = []
  for (let t = 1; t < p.tUnits.length; t++) {
    if (p.breakFlags[t] === BREAK_NORMAL) normal.push(p.tSource[t]!)
    else if (p.breakFlags[t] === BREAK_EMERGENCY_WRAP && p.clusterStart[t] === 1) emergency.push(p.tSource[t]!)
  }
  return { normal, emergency }
}

describe('gecko break opportunities (groundwork oracle unit cases)', () => {
  test('slashes, hyphens, spaces', () => {
    expect(breaks('https://example.com').normal).toEqual([8])
    expect(breaks('example.com/docs').normal).toEqual([12])
    expect(breaks('and/or').normal).toEqual([4])
    expect(breaks('a/(b)').normal).toEqual([2])
    expect(breaks('see /docs').normal).toEqual([4, 5])
    expect(breaks('1/2').normal).toEqual([])
    expect(breaks('example.com/2026').normal).toEqual([])
    expect(breaks('a/"b"').normal).toEqual([])
    expect(breaks('log-2026')).toEqual({ normal: [], emergency: [4] })
    expect(breaks('2025-08-01')).toEqual({ normal: [], emergency: [5, 8] })
    expect(breaks('crash-log-2026-09-12.txt')).toEqual({ normal: [6], emergency: [10, 15, 18] })
    expect(breaks('ab‐12').normal).toEqual([3])
    expect(breaks('x?-b').normal).toEqual([3])
    expect(breaks('a|b').normal).toEqual([2])
    expect(breaks('a​b').normal).toEqual([2])
    expect(breaks('a b').normal).toEqual([])
    expect(breaks('« word').normal).toEqual([2])
    expect(breaks('( word').normal).toEqual([2])
    expect(breaks('a   b').normal).toEqual([4])
    expect(breaks('a​\nb').normal).toEqual([3])
    expect(breaks('a\nb').normal).toEqual([2])
    expect(breaks('a \n\t b').normal).toEqual([5])
  })
  test('keep-all and pre-wrap', () => {
    expect(breaks('א|文', 'normal', 'keep-all').normal).toEqual([])
    expect(breaks('文א|文', 'normal', 'keep-all').normal).toEqual([1])
    expect(breaks('ab-cd', 'normal', 'keep-all')).toEqual({ normal: [], emergency: [3] })
    expect(breaks('a\tb', 'pre-wrap').normal).toEqual([2])
    expect(breaks('a  b', 'pre-wrap').normal).toEqual([3])
  })
  test('spec §9.5 oracle outputs', () => {
    expect(breaks('foo bar').normal).toEqual([4])
    expect(breaks('foo/bar').normal).toEqual([4])
    expect(breaks('http://ex.com/a-b?c=d').normal).toEqual([7, 14, 16, 18])
    expect(breaks('foo—bar').normal).toEqual([3, 4])
    expect(breaks('日本語テキスト').normal).toEqual([1, 2, 3, 4, 5, 6])
    expect(breaks('アァア').normal).toEqual([2])
    expect(breaks('$100 100%').normal).toEqual([5])
    expect(breaks('1,000.5').normal).toEqual([])
    expect(breaks('£€').normal).toEqual([1])
    expect(breaks('한국어 텍스트').normal).toEqual([1, 2, 4, 5, 6])
    expect(breaks('한국어 텍스트', 'normal', 'keep-all').normal).toEqual([4])
    expect(breaks('a😀b').normal).toEqual([1, 3])
    expect(breaks('漢字。漢字').normal).toEqual([1, 3, 4])
    expect(breaks('漢「字」漢').normal).toEqual([1, 4])
    expect(breaks('a⁠b c').normal).toEqual([4])
  })
})

describe('gecko TransformText (specs/gecko-text.md §6.3)', () => {
  const transformed = (text: string, whiteSpace: Paragraph['whiteSpace'] = 'normal', lang = 'en') => {
    const p = prepareGecko(paragraph([run(text, 'span')], 100, { whiteSpace, lang }), env, true)
    return String.fromCharCode(...p.tUnits)
  }
  test('collapsing and segment breaks', () => {
    expect(transformed('a  \t b')).toBe('a b')
    expect(transformed('a \n b')).toBe('a b')
    expect(transformed('日本\n語')).toBe('日本語')
    expect(transformed('abc\n日本')).toBe('abc 日本')
    expect(transformed('。\na', 'normal', 'ja')).toBe('。a')
    expect(transformed('。\na', 'normal', 'en')).toBe('。 a')
    expect(transformed('a​\nb')).toBe('a​b')
    expect(transformed('a \r b')).toBe('a \r b')
    expect(transformed('a  \n  b', 'pre-line')).toBe('a\nb')
    expect(transformed('a\n\nb', 'pre-line')).toBe('a\n\nb')
    expect(transformed('a­b  c', 'pre-wrap')).toBe('ab  c')
  })
})

// Inline structure, line slots and alignment (DESIGN.md §8.3 stage 5), over the stand-in's 576 au glyphs: expectations
// from probe verdicts where one exists (specs/gecko-lines.md §10), else from the cited source arithmetic.
describe('gecko inline structure', () => {
  const block = (content: InlineNode[], width: number, extra: Partial<Flat> = {}): Sized => ({ ...paragraph([], width, extra), content })
  const span = (children: InlineNode[], edges: { start?: number; end?: number; whiteSpace?: Paragraph['whiteSpace'] } = {}): InlineNode => ({
    kind: 'span', font: courier, letterSpacing: 0, wordSpacing: 0, whiteSpace: edges.whiteSpace ?? 'normal', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, lang: null, inlineStart: { margin: 0, border: 0, padding: edges.start ?? 0 },
    inlineEnd: { margin: 0, border: 0, padding: edges.end ?? 0 }, verticalAlign: 'baseline', children,
  })
  const leaf = (text: string): InlineNode => ({ kind: 'text', text })

  test('H12b: every continuation reserves the end padding (nsInlineFrame.cpp:514-521)', () => {
    const lineStarts = (p: Sized) => layout(p).lines.filter(l => l.hasLineBox).map(l => l.start)
    expect(lineStarts(block([span([leaf('aaa aaa b')], { end: 9.6 })], 67.2))).toEqual([0, 4])
    expect(lineStarts(block([span([leaf('aaa aaa b')])], 67.2))).toEqual([0, 8])
  })

  test('a span with start padding places its text after the edge; box-start and box-end go on its first and last lines', () => {
    const l = layout(block([span([leaf('aa bb')], { start: 9.6, end: 9.6 })], 57.6))
    expect(l.lines.map(line => line.fragments.map(f => f.kind))).toEqual([['box-start', 'text', 'trimmed'], ['text', 'box-end']])
    expect(l.lines[0]!.geometry.frames.map(f => [f.kind, f.x, f.width])).toEqual([['inline', 0, 1728], ['text', 576, 1152]])
    expect(l.lines[1]!.geometry.frames.map(f => [f.kind, f.x, f.width])).toEqual([['inline', 0, 1728], ['text', 0, 1152]])
    expect(l.lines.map(line => line.geometry.width)).toEqual([1728, 1728])
  })

  test('<br> ends the line after itself and trimming skips it (BRFrame.cpp:98-166, nsLineLayout.cpp:2851-2985)', () => {
    const l = layout(block([leaf('aaa '), { kind: 'br' }, leaf('bbb')], 500))
    expect(l.lines.map(line => [line.start, line.end])).toEqual([[0, 4], [4, 7]])
    expect(l.lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'trimmed', 'br'])
    expect(l.lines[0]!.geometry.width).toBe(1728)
  })

  test('<wbr> records a break after itself, taken by the redo (nsLineLayout.cpp:1057-1071)', () => {
    const l = layout(block([leaf('aaaa'), { kind: 'wbr' }, leaf('bbbb')], 57.6))
    expect(l.lines.map(line => [line.start, line.fragments.map(f => f.kind)])).toEqual([[0, ['text', 'wbr']], [4, ['text']]])
  })

  test('an atomic inline that overflows is pushed, and the text after it backs up to the break after it', () => {
    const atomic: InlineNode = { kind: 'atomic', width: 28.8, height: 20, marginInlineStart: 0, marginInlineEnd: 0 }
    const l = layout(block([leaf('aaa '), atomic, leaf(' bbb')], 57.6))
    expect(l.lines.map(line => [line.start, line.fragments.map(f => f.kind)])).toEqual([
      [0, ['text', 'trimmed']], [4, ['atomic', 'trimmed']], [5, ['text']],
    ])
    expect(l.lines[1]!.geometry.frames.map(f => [f.kind, f.x, f.width])).toEqual([['atomic', 0, 1728], ['text', 1728, 0]])
  })

  test('an atomic inline in an RTL block resolves as U+FFFC and is walked with its start margin on the right (nsBidiPresUtils.cpp:1385-1400, :1855-1867)', () => {
    const atomic: InlineNode = { kind: 'atomic', width: 28.8, height: 20, marginInlineStart: 9.6, marginInlineEnd: 0 }
    const l = layout(block([leaf('ab '), atomic, leaf(' cd')], 500, { direction: 'rtl' }))
    // "ab ￼ cd": the neutrals sit between two L runs, so everything is level 2 and keeps its logical order left to right.
    expect(l.lines[0]!.geometry.frames.map(f => [f.kind, f.kind === 'br' || f.kind === 'inline' ? -1 : f.level, f.x, f.width])).toEqual([
      ['text', 2, 30000 - 1728 - 576 - 1728 - 1728, 1728], ['atomic', 2, 30000 - 1728 - 576 - 1728, 1728], ['text', 2, 30000 - 1728, 1728],
    ])
  })

  test('a padded span in an RTL block splits at a level change and takes its edges by visual order (nsBidiPresUtils.cpp:612-758, :1561-1868)', () => {
    const l = layout(block([span([leaf('ab גד')], { start: 9.6, end: 9.6 })], 500, { direction: 'rtl' }))
    const line = l.lines[0]!
    // "ab" is level 2 and " גד" level 1, so the span splits between them. Reflow gives the first continuation the start edge
    // and the second the end edge (nsInlineFrame.cpp:510, :670); the walk from the right places the level 2 continuation
    // first, so the start edge is on the right and the end edge on the left.
    expect(line.geometry.frames.map(f => f.kind === 'inline' ? [f.kind, f.x, f.width, f.hasStartEdge, f.hasEndEdge] : [f.kind, f.x, f.width])).toEqual([
      ['inline', 28272, 1728, true, false], ['text', 28272, 1152], ['inline', 25968, 2304, false, true], ['text', 26544, 1728],
    ])
    expect(line.geometry.width).toBe(4032)
    expect(line.fragments.filter(f => f.kind === 'box-start' || f.kind === 'box-end').map(f => f.kind)).toEqual(['box-start', 'box-end'])
  })

  test('a <br> in an RTL block appends U+2028 and ends the bidi paragraph, so the space before it takes the paragraph level (nsBidiPresUtils.cpp:1381-1384)', () => {
    const p = block([leaf('ab '), { kind: 'br' }, leaf('cd')], 500, { direction: 'rtl' })
    expect(prepareGecko(p, env, true).elements.map(e => e.kind === 'span' ? -1 : e.level)).toEqual([1])
    const l = layout(p)
    expect(l.lines.map(line => textFrames(line).map(f => [f.level, f.x, f.width]))).toEqual([[[2, 30000 - 1152, 1152], [1, 30000 - 1152, 0]], [[2, 30000 - 1152, 1152]]])
    expect(l.lines[0]!.geometry.frames.find(f => f.kind === 'br')!.x).toBe(30000 - 1152)
  })

  test('H15: tab stops count from the block edge, text-indent included (nsTextFrame.cpp:11063-11067)', () => {
    const l = layout(block([leaf('a\tb')], 500, { whiteSpace: 'pre', textIndent: 57.6 }))
    const line = l.lines[0]!
    expect(line.indented).toBe(true)
    const frame = textFrames(line)[0]!
    expect(frame.x + frame.characters[0]!.advance + frame.characters[1]!.advance).toBe(4608)
  })

  test('H13: pre-wrap with text-align right moves the line by the remaining width plus the hang (nsLineLayout.cpp:3604-3629)', () => {
    const l = layout(paragraph([run('aaaa   bb')], 57.6, { whiteSpace: 'pre-wrap', textAlign: 'right' }))
    expect(textFrames(l.lines[0]!)[0]!.x).toBe(1152)
    expect(l.lines[0]!.geometry.alignOffset).toBe(1152)
  })

  test('text-align center halves the remaining width (nsLineLayout.cpp:3622-3625)', () => {
    const l = layout(paragraph([run('aa')], 57.6, { textAlign: 'center' }))
    expect(textFrames(l.lines[0]!)[0]!.x).toBe(1152)
  })

  test('a slot too narrow for the first word moves the line below the floats (nsBlockFrame.cpp:5289-5299, :5549-5555)', () => {
    const p = paragraph([run('aaaa bbbb')], 57.6)
    const l = layout(p, env, [{ left: 38.4, right: 0 }])
    expect(l.belowFloats.map(b => b.row)).toEqual([0])
    expect(l.lines.map(line => [line.start, line.geometry.lineLeft, line.geometry.availableWidth, line.geometry.impactedByFloats])).toEqual([[0, 0, 3456, false], [5, 0, 3456, false]])
  })

  test('a slot that holds the line places it after the float', () => {
    const l = layout(paragraph([run('aa bb')], 57.6), env, [{ left: 19.2, right: 0 }])
    expect(l.belowFloats).toEqual([])
    expect(l.lines.map(line => [line.start, line.geometry.lineLeft, line.geometry.availableWidth])).toEqual([[0, 1152, 2304], [3, 0, 3456]])
    expect(textFrames(l.lines[0]!)[0]!.x).toBe(1152)
  })

  test('justify spreads the remaining width over the line\'s inner opportunities; the last line starts (nsLineLayout.cpp:3531-3570)', () => {
    // "aa bb cc" at 72px (4320 au) breaks before "cc": line 1 is "aa bb" at 2880 au, and the one frame takes the remaining
    // 1440 au. Spread over its characters, the space's two gaps take it all.
    const l = layout(paragraph([run('aa bb cc')], 72, { textAlign: 'justify' }))
    expect(l.lines.map(line => [line.align, line.geometry.width])).toEqual([['justify', 4320], ['start', 1152]])
    const frame = textFrames(l.lines[0]!)[0]!
    expect(frame.width).toBe(4320)
    expect(frame.characters.map(c => c.advance)).toEqual([576, 576, 576 + 1440, 576, 576, 576])
  })

  test('pre-wrap justify leaves the trailing spaces out of the opportunities and spreads their width too (nsLineLayout.cpp:3531-3570)', () => {
    // "aa bb cc" at 72px under pre-wrap: line 1 "aa bb " holds 3 inner opportunities, the trailing space's one is taken off
    // (trimCount 1), and the 576 au hanging space adds to the 1440 au remaining width.
    const l = layout(paragraph([run('aa bb cc')], 72, { textAlign: 'justify', whiteSpace: 'pre-wrap' }))
    expect(l.lines.map(line => line.align)).toEqual(['justify', 'start'])
    expect(l.lines[0]!.geometry.alignOffset).toBe(0)
  })
})

describe('ceiling round 2', () => {
  test('an 8-bit text run without letters shapes as Latin: digits kern under lang="ko" (probe gecko-port F8)', () => {
    // InitTextRun's signed `c - 'A' <= 'Z' - 'A'` (gfxTextRun.cpp:2744-2747) makes ` 7:00` Latin, so `7:` kerns; Canvas's
    // 16-bit string needs a Latin letter in front to itemize the same way.
    const digits = paragraph([run('7:00', 'span', { lang: 'ko' })], 500, { lang: 'ko' })
    expect(widths(digits)).toEqual([576 * 4 - 40])
    expect(layout(digits).measure.calls.some(call => call.text === 'a 7:00')).toBe(true)
    // With a letter in the same script run, that letter gives Canvas the script.
    const letters = paragraph([run('x 7:00', 'span', { lang: 'ko' })], 500, { lang: 'ko' })
    expect(widths(letters)).toEqual([576 * 6 - 40])
  })

  test('an in-word break inside a ligature as wide as its parts: the ink box shows it, and its letters share its advance (probe gecko-port F9)', () => {
    const l = layout(paragraph([run('fi')], 2, { overflowWrap: 'anywhere' }))
    expect(l.lines.map(line => line.start)).toEqual([0, 1])
    expect(l.lines.map(line => line.geometry.width)).toEqual([576, 576])
    expect(allGaps(l).map(g => g.gap)).not.toContain('in-word-prefix')
    expect(l.measure.contexts.some(c => c.letterSpacing === '0.001px')).toBe(true)
  })

  test('lang="" measures under the given regional-prefs locale and reports ui-language only without it (nsFontCache.cpp:61-63)', () => {
    const p = paragraph([run('abc', 'span', { lang: '' })], 500)
    const given = layout(p)
    expect(allGaps(given).some(g => g.gap === 'ui-language')).toBe(false)
    expect(given.measure.contexts.some(c => c.lang === 'en-us')).toBe(true)
    const unknown = layout(p, { ...env, regionalPrefsLocale: null })
    expect(unknown.gaps.filter(g => g.gap === 'ui-language').map(g => g.at)).toEqual([{ start: 0, end: 3 }])
  })

  test('a split pair kerning fact gives the glyph before an in-word offset half the adjustment (hb-kern.hh:102-106, probe gecko-port F12)', () => {
    // The stub kerns `AV` by −60 au. At 11px `A` alone overflows, so overflow-wrap breaks between A and V.
    const split = { ...courier, facts: { ...facts, pairKerning: 'split' as const } }
    const splitLines = layout(paragraph([run('AV', 'span', { font: split })], 11, { overflowWrap: 'anywhere', font: split }))
    expect(splitLines.lines.map(line => line.geometry.width)).toEqual([576 - 30, 576 - 30])
    const first = layout(paragraph([run('AV', 'span')], 11, { overflowWrap: 'anywhere' }))
    expect(first.lines.map(line => line.geometry.width)).toEqual([576 - 60, 576])
    // An even adjustment divides in halves exactly; without the fact the position stays a stand-in.
    expect(splitLines.lines[0]!.gaps.some(g => g.gap === 'in-word-prefix')).toBe(false)
    expect(first.lines[0]!.gaps.some(g => g.gap === 'in-word-prefix')).toBe(true)
  })

  test('an odd split adjustment: the fractions come from the context at 64 times the size (probe gecko-port F16)', () => {
    // `To` is 554 + 554 au where T and o alone are 576 and 577: −22 on T and −23 on o, since 576.4 − 22.5 rounds up and
    // 576.8 − 22.5 down. Halving −45 au gives −23 on T.
    const split = { ...courier, facts: { ...facts, pairKerning: 'split' as const } }
    const l = layout(paragraph([run('To', 'span', { font: split })], 11, { overflowWrap: 'anywhere', font: split }))
    expect(l.lines.map(line => line.geometry.width)).toEqual([554, 554])
    expect(allGaps(l).map(g => g.gap)).not.toContain('in-word-prefix')
    expect(l.measure.contexts.some(c => c.font.includes(' 1024px '))).toBe(true)
  })

  test('ligature candidates in a row: the ligatures fact divides them, and without it the row stands in as one group (hb-ot-layout.cc:1917-1945)', () => {
    // `ff` alone tests as a ligature at both boundaries of `fff`; the unit takes the first pair and leaves the third `f`.
    const unknown = layout(paragraph([run('fff')], 2, { overflowWrap: 'anywhere' }))
    expect(unknown.lines.map(line => line.start)).toEqual([0, 1, 2])
    expect(unknown.lines.map(line => line.geometry.width)).toEqual([572, 572, 572])
    expect(unknown.lines.map(line => line.gaps.some(g => g.gap === 'in-word-prefix'))).toEqual([true, true, true])
    const pattern = (positions: string[][]) => ({ positions, exact: true, spaced: false, everyContext: true, acrossMark: null })
    const listed = (patterns: ReturnType<typeof pattern>[], languageSystems: string[] = []): FontDecl => ({ ...courier, facts: { ...facts, fonts: [{
      family: '"Courier New"', realizes: true, coverage: [0x20, 0x7e], ligatures: { patterns, complete: true, languageSystems }, scriptLookups: [],
    }] } })
    const broken = (font: FontDecl, lang = 'en') => layout(paragraph([run('fff', 'span', { font, lang })], 2, { overflowWrap: 'anywhere', font, lang }))
    const pairs = broken(listed([pattern([['f'], ['f', 'i']])]))
    expect(pairs.lines.map(line => line.geometry.width)).toEqual([570, 570, 576])
    expect(allGaps(pairs).map(g => g.gap)).not.toContain('in-word-prefix')
    // A listed ligature of three takes the row whole.
    const three = broken(listed([pattern([['f'], ['f', 'i']]), pattern([['f'], ['f'], ['f']])]))
    expect(three.lines.map(line => line.geometry.width)).toEqual([572, 572, 572])
    expect(allGaps(three).map(g => g.gap)).not.toContain('in-word-prefix')
    // A language system the fact left untried: settled under English only.
    expect(allGaps(broken(listed([pattern([['f'], ['f', 'i']])], ['GSUB/latn/TRK ']))).map(g => g.gap)).not.toContain('in-word-prefix')
    expect(allGaps(broken(listed([pattern([['f'], ['f', 'i']])], ['GSUB/latn/TRK ']), 'tr')).map(g => g.gap)).toContain('in-word-prefix')
  })

  test('the pair kerning fact describes Latin lookups: a pair in a Hebrew script run stays a stand-in (hb-ot-shape.cc:134, :173-184)', () => {
    // The stub kerns `77` by −40 au. Digits alone take the language's likely script (gfxTextRun.cpp:2581-2640, :2755-2756).
    const split = { ...courier, facts: { ...facts, pairKerning: 'split' as const } }
    const latin = layout(paragraph([run('77', 'span', { font: split })], 11, { overflowWrap: 'anywhere', font: split }))
    expect(latin.lines.map(line => line.geometry.width)).toEqual([556, 556])
    expect(allGaps(latin).map(g => g.gap)).not.toContain('in-word-prefix')
    // U+2014 makes the text run 16-bit; an 8-bit run counts digits as Latin letters (textRunScripts).
    const hebrew = layout(paragraph([run('77 —', 'span', { font: split, lang: 'he' })], 11, { overflowWrap: 'anywhere', font: split, lang: 'he' }))
    expect(hebrew.lines.slice(0, 2).map(line => line.geometry.width)).toEqual([536, 576])
    expect(hebrew.lines.slice(0, 2).map(line => line.gaps.some(g => g.gap === 'in-word-prefix'))).toEqual([true, true])
    const english = layout(paragraph([run('77 —', 'span', { font: split })], 11, { overflowWrap: 'anywhere', font: split }))
    expect(english.lines.slice(0, 2).map(line => line.geometry.width)).toEqual([556, 556])
  })

  test('a span that starts inside a ligature group: a mark ending the group takes the letter spacing (gfxTextRun.cpp:306-320)', () => {
    // Lam and alef madda are one group of 1001 au in the stub. The span starts at the alef: its part of the group reaches the
    // group's end, and the spacing after it is asked for the group's last character alone, the kasra, which isn't cursive.
    const split = (text: string) => layout(paragraph([run('ل', 'text', { letterSpacing: 4 }), run(text, 'span', { letterSpacing: 4 })], 500, { letterSpacing: 4 })).lines[0]!.geometry.width
    const whole = (text: string) => layout(paragraph([run('ل' + text, 'text', { letterSpacing: 4 })], 500, { letterSpacing: 4 })).lines[0]!.geometry.width
    expect(split('آِ') - whole('آِ')).toBe(240)
    // Without the mark the group ends in the alef, a cursive letter.
    expect(split('آ') - whole('آ')).toBe(0)
  })

  test('paragraph gaps name the source range they concern', () => {
    const system = { ...courier, facts: { ...facts, opticalSizeAxis: null } }
    const p = paragraph([run('aa '), run('bb', 'span', { font: { ...system, size: 16.8 } })], 500)
    const l = layout(p)
    for (const g of l.gaps) expect(g.at).toBeDefined()
    expect(l.gaps.filter(g => g.gap === 'optical-size').map(g => g.at)).toEqual([{ start: 3, end: 5 }])
    expect(l.gaps.filter(g => g.gap === 'font-size-quantization').map(g => g.at)).toEqual([{ start: 3, end: 5 }])
  })
})

describe('round 4c', () => {
  test('tab-size comes from the text frame, the space and spacing from the block (nsTextFrame.cpp:3875-3906)', () => {
    // Courier New at 16px: 576 au a character. The block's tab-size is 8, the span's 4: its tab stops every 2304 au.
    const spanWith = (tabSize: number, blockTabSize: number): Sized => {
      const p = paragraph([run('a\tb', 'span'), run('\tc')], 500, { whiteSpace: 'pre', tabSize: blockTabSize })
      const span = p.content[0]!
      if (span.kind !== 'span') throw new Error('expected a span')
      span.tabSize = tabSize
      return p
    }
    // `a`, a tab to 2304, `b`, then the block's own tab to 4608, `c`.
    expect(textFrames(layout(spanWith(4, 8)).lines[0]!).map(f => f.width)).toEqual([2304 + 576, 4608 - 2880 + 576])
    // The span's tab-size 0 leaves its tab at 0 (:4306-4309); the block's text node still stops at 4608.
    expect(textFrames(layout(spanWith(0, 8)).lines[0]!).map(f => f.width)).toEqual([1152, 4608 - 1152 + 576])
    // And the other way round: the block's tab-size 0 doesn't reach the span.
    expect(textFrames(layout(spanWith(4, 0)).lines[0]!).map(f => f.width)).toEqual([2304 + 576, 576])
  })

  test('a text frame that ends in a preserved newline ends its line like a <br> (nsTextFrame.cpp:11472-11476)', () => {
    // "aa bb\ncc dd ee" under pre-wrap and justify at 72px: line 0 ends in the newline, so it takes the last line's
    // alignment, start, and keeps its 2880 au; line 1 wraps before "ee" and is justified to 4320 au.
    const l = layout(paragraph([run('aa bb\ncc dd ee')], 72, { textAlign: 'justify', whiteSpace: 'pre-wrap' }))
    expect(l.lines.map(line => [line.start, line.align])).toEqual([[0, 'start'], [6, 'justify'], [12, 'start']])
    expect(textFrames(l.lines[0]!)[0]!.characters.map(c => c.advance)).toEqual([576, 576, 576, 576, 576, 0])
    expect(textFrames(l.lines[1]!)[0]!.characters.slice(0, 5).map(c => c.advance)).toEqual([576, 576, 576 + 1440, 576, 576])
  })

  test('a line that ends in a preserved newline isn\'t wrapped, so TextAlignLine reads no hang on it (nsBlockFrame.cpp:5604-5606, nsLineLayout.cpp:3505-3516)', () => {
    // "aa bb    \ncc" under pre-wrap at 57.6px (3456 au): "aa bb" and one of the four spaces fit, and the line box keeps
    // that space's 576 au. On a wrapped line text-align: end would move the text by that hang; this line ends in a BR.
    const l = layout(paragraph([run('aa bb    \ncc')], 57.6, { textAlign: 'end', whiteSpace: 'pre-wrap' }))
    expect(l.lines.map(line => [line.start, line.geometry.width, line.geometry.hang, line.geometry.alignOffset])).toEqual([[0, 3456, 0, 0], [10, 1152, 0, 2304]])
    // The same spaces before a soft wrap do hang: the text moves to the line's end.
    const wrapped = layout(paragraph([run('aa bb    cc')], 57.6, { textAlign: 'end', whiteSpace: 'pre-wrap' }))
    expect(wrapped.lines.map(line => [line.start, line.geometry.width, line.geometry.hang, line.geometry.alignOffset])).toEqual([[0, 3456, 576, 576], [9, 1152, 0, 2304]])
  })
})

describe('plain and inspected paragraphs (research/ARCHITECTURE-PLAN-2.md §5.2)', () => {
  // Every line of a paragraph as an application reads it: the fill result and the pieces.
  function plainWalk(p: Sized, inspect: boolean): { lines: unknown[]; calls: number } {
    const measure: StubLog = asked = { contexts: [], calls: [] }
    const prepared = prepareGecko(p, env, inspect)
    const lines: unknown[] = []
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width: p.width, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('a slot without insets refused its line')
      lines.push({ start: filled.start, end: filled.end, next: filled.next, hasLineBox: filled.hasLineBox, pieces: linePieces(prepared, filled.line) })
      start = filled.next
    }
    return { lines, calls: measure.calls.length }
  }

  test('a plain paragraph gives the inspected one\'s lines and pieces, and asks Canvas less', () => {
    // Breaks inside words (in-word positions), a letter-spaced span (the ligature group count) and several words (the
    // space-in-shaping window): what only gaps and the characters ask goes.
    const p = paragraph([run('AVAVAV aaaa bbbb '), run('cccc dddd', 'span', { letterSpacing: 1 })], 40, { overflowWrap: 'anywhere' })
    const plain = plainWalk(p, false)
    const inspected = plainWalk(p, true)
    expect(plain.lines).toEqual(inspected.lines)
    expect(plain.lines.length).toBeGreaterThan(3)
    expect(plain.calls).toBeLessThan(inspected.calls)
  })

  test('inspectLine and paragraphGaps throw on a plain paragraph', () => {
    const prepared = prepareGecko(paragraph([run('aaaa bbbb')], 40), env, false)
    const filled = fillLine(prepared, firstLine(prepared)!, { width: 40, left: 0, right: 0 })
    expect(prepared.inspect).toBeNull()
    expect(() => inspectLine(prepared, filled.line)).toThrow('prepared plain')
    expect(() => geckoParagraphGaps(prepared)).toThrow('prepared plain')
  })

  test('linePieces and inspectLine don\'t write the decided line: justified, trimmed and read twice in either order', () => {
    const p = paragraph([run('aa bb cc dd ee ff')], 60, { textAlign: 'justify' })
    const prepared = prepareGecko(p, env, true)
    const filled = fillLine(prepared, firstLine(prepared)!, { width: p.width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets refused its line')
    const before = JSON.stringify(filled.line.root, (key, value: unknown) => key === 'parent' || key === 'run' ? undefined : value)
    const pieces = linePieces(prepared, filled.line)
    const inspection = inspectLine(prepared, filled.line)
    expect(linePieces(prepared, filled.line)).toEqual(pieces)
    expect(inspectLine(prepared, filled.line)).toEqual(inspection)
    expect(inspection.geometry!.width).toBe(3600)
    expect(JSON.stringify(filled.line.root, (key, value: unknown) => key === 'parent' || key === 'run' ? undefined : value)).toBe(before)
  })

  test('a redo\'s dropped pass still tells the line what it consulted past its end', () => {
    // `aa A` and a span `VAVAV` at 50px: the first pass places `aa A`, whose end is a stand-in (`AV` kerns across offset 4),
    // then the span overflows without a break inside, and the redo forces the break after the space. Only the dropped pass
    // consulted offset 4, the first stand-in past the line's end.
    const l = layout(paragraph([run('aa A'), run('VAVAV', 'span')], 50))
    expect(l.lines.map(line => [line.start, line.end])).toEqual([[0, 3], [3, 9]])
    expect(l.lines[0]!.gaps.filter(g => g.gap === 'in-word-prefix').map(g => g.at)).toEqual([{ start: 4, end: 4 }])
  })
})

describe('what measuring found is kept per offset, and nothing by string (research/ARCHITECTURE-PLAN-2.md §5.3)', () => {
  // Every line of a paragraph at a width, as an application fills them.
  function fillAll(prepared: ReturnType<typeof prepareGecko>, width: number): number[] {
    const ends: number[] = []
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('a slot without insets refused its line')
      linePieces(prepared, filled.line)
      ends.push(filled.end)
      start = filled.next
    }
    return ends
  }

  test('an offset inside a unit is measured once: filling the paragraph again asks Canvas nothing', () => {
    const p = paragraph([run('abcdefgh ijklmnop')], 40, { overflowWrap: 'anywhere' })
    const measure: StubLog = asked = { contexts: [], calls: [] }
    const prepared = prepareGecko(p, env, false)
    const first = fillAll(prepared, 40)
    const calls = measure.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(fillAll(prepared, 40)).toEqual(first)
    expect(measure.calls.length).toBe(calls)
    // Another width consults the offsets its own breaks need: at 80px a word is a line, and the scan that finds so reads
    // offsets the narrow lines asked.
    expect(fillAll(prepared, 80).length).toBe(2)
    expect(measure.calls.length).toBe(calls)
  })

  test('the suffix an offset measured is the next offset\'s, read and not asked again', () => {
    // Offset 2 of `abcdefgh` measures W(`cdefgh`), and offset 3 measures its cluster `c` in front of its own suffix: the same
    // string, which the offset's record hands over.
    const l = layout(paragraph([run('abcdefgh')], 20, { overflowWrap: 'anywhere' }))
    expect(l.lines.length).toBe(4)
    expect(l.measure.calls.filter(c => c.text === 'cdefgh').length).toBe(1)
    expect(l.measure.calls.filter(c => c.text === 'efgh').length).toBe(1)
  })
})

describe('the model clean-up (research/ARCHITECTURE-PLAN-2.md §8, X3)', () => {
  test('text nodes without frames are collapsed fragments of their own leaves, and an empty leaf makes none', () => {
    // The block's first and last children are white space alone and get no frame; two empty text nodes sit beside the span.
    const l = layout(paragraph([run(' '), run(''), run('ab', 'span'), run(''), run(' ')], 500))
    expect(l.lines.length).toBe(1)
    expect(l.lines[0]!.fragments.map(f => f.kind === 'collapsed' || f.kind === 'text' ? [f.kind, f.run, f.start, f.end] : [f.kind])).toEqual([
      ['collapsed', 0, 0, 1], ['box-start'], ['text', 2, 1, 3], ['box-end'], ['collapsed', 4, 3, 4],
    ])
  })

  test('a unit holds nothing of its inside until a line asks, and a line start is plain data', () => {
    const prepared = prepareGecko(paragraph([run('abcdefgh ijkl')], 40, { overflowWrap: 'anywhere' }), env, false)
    expect(prepared.units.map(u => u.inWord)).toEqual([null, null, null])
    const filled = fillLine(prepared, firstLine(prepared)!, { width: 40, left: 0, right: 0 })
    expect(prepared.units[0]!.inWord).not.toBeNull()
    expect(prepared.units[2]!.inWord).toBeNull()
    expect(filled.next).toEqual(JSON.parse(JSON.stringify(filled.next)))
  })
})
