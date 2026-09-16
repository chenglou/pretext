// Gecko port tests on the specs' worked examples and installed Firefox 156 verdicts (specs/probes-firefox.md), with a
// stand-in OffscreenCanvas: every code point of 16px Courier New is 576 au (specs/gecko-lines.md §2.5), so widths are
// known without a browser. Break scans come from the groundwork oracle's unit cases
// (runtime-parity/gecko/tools/unit.ts, answered by Firefox's own nsLineBreaker and ICU4X data).
import { beforeAll, describe, expect, test } from 'bun:test'
import { GECKO, type Environment } from '../../env.js'
import { layoutParagraph } from '../../index.js'
import { createMeasurer } from '../../measure/canvas.js'
import type { Paragraph, TextRun } from '../../model.js'
import { BREAK_EMERGENCY_WRAP, BREAK_NORMAL } from './linebreak.js'
import { prepareGecko } from './prepare.js'

// The stand-in's widths in au at apd 60. Any code point is 576 au at 16px, scaled with the size, with these exceptions,
// each modelled on an installed-Firefox measurement:
// - "AV" kerns by −60 au (a GPOS pair across an in-word offset).
// - "(" is 367 au, or 660 au in a string with an Arabic letter, where the itemizer gives it the Arabic script (Amiri,
//   gecko-AUDIT probe A1).
// - U+1F600, U+1F469, U+1F680 and the ligature U+1F469 U+200D U+1F680 take Apple Color Emoji's whole-pixel advances
//   (960, 1260, 1500 and 1920 au at 12, 16, 24 and 32px, specs/gecko-canvas.md §1.9) in every family, except a
//   text-presentation U+1F600 U+FE0E, and U+1F600 alone once `stub.pinned` (probe gecko-port F3), which draw with a text
//   font at 1020 au outside "Apple Color Emoji". U+200D, U+FE0E and U+FE0F have no advance.
const stub = { pinned: false }
function stubAu(font: string, text: string): number {
  const size = Number(/([\d.]+)px/.exec(font)![1])
  const emojiFont = font.includes('Apple Color Emoji')
  const emoji = size === 12 ? 960 : size === 16 ? 1260 : size === 24 ? 1500 : size === 32 ? 1920 : Math.round(size * 60)
  const arabic = /[ء-ي]/.test(text)
  const cps = [...text]
  let au = 0
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]!
    if (c === '‍' || c === '︎' || c === '️') continue
    if (c === '👩' && cps[i + 1] === '‍' && cps[i + 2] === '🚀') {
      au += emoji
      i += 2
      continue
    }
    if (c === '😀' || c === '👩' || c === '🚀') {
      au += !emojiFont && (cps[i + 1] === '︎' || (stub.pinned && c === '😀')) ? 1020 : emoji
      continue
    }
    if (c === '(') {
      au += arabic ? 660 : 367
      continue
    }
    if (c === ' ' && font.includes('Arial')) {
      au += 60 * Math.floor(size / 5 + 0.5) // Arial has no U+2009: Gecko synthesizes it (gfxTextRun.cpp:3032-3043)
      continue
    }
    au += Math.round(576 * size / 16)
    if (c === 'A' && cps[i + 1] === 'V') au -= 60
  }
  return au
}

beforeAll(() => {
  class StubContext {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      return { width: Math.fround(stubAu(this.font, s) / 60) }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    getContext() { return new StubContext() }
  }
})

const env: Environment = {
  engine: GECKO, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en-US',
  preferredLanguages: ['en-US'], dictionaryBreaks: { kind: 'unavailable' },
}
const courier = { family: '"Courier New"', size: 16, weight: 400, style: 'normal' as const }

function run(text: string, node: 'span' | 'text' = 'text', extra: Partial<TextRun> = {}): TextRun {
  return { text, node, font: courier, letterSpacing: 0, wordSpacing: 0, lang: null, ...extra }
}

function paragraph(runs: TextRun[], width: number, extra: Partial<Paragraph> = {}): Paragraph {
  return {
    runs, font: courier, letterSpacing: 0, wordSpacing: 0, width, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...extra,
  }
}

// The first visible character of each line, as the lab derives line starts.
function starts(p: Paragraph): number[] {
  const layout = layoutParagraph(p, env)
  const out: number[] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    const first = line.fragments.find(f => f.kind === 'text' || f.kind === 'hanging' || f.kind === 'trimmed')
    out.push(first === undefined ? line.start : first.start)
  }
  return out
}

function widths(p: Paragraph): number[] {
  return layoutParagraph(p, env).lines.map(l => l.engineWidth.unit === 'gecko-app-unit' ? l.engineWidth.au : -1)
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
    // The line box keeps the non-overflowing part of the spaces (3456 − 2304 au = the hangable 1728 − 576); the visible
    // width leaves them out.
    expect(widths(paragraph([run('aaaa   bb')], 57.6, { whiteSpace: 'pre-wrap' }))).toEqual([3456, 1152])
    expect(layoutParagraph(paragraph([run('aaaa   bb')], 57.6, { whiteSpace: 'pre-wrap' }), env).lines[0]!.width).toBe(38.4)
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
  test('H16 the hyphen letter spacing counts for fit, not width', () => {
    const p = paragraph([run('aaaa­bbbb', 'span', { letterSpacing: 1 })], 53)
    expect(starts(p)).toEqual([0, 5])
    expect(widths(p)[0]).toBe(4 * 636 + 576)
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
    const layout = layoutParagraph(p, env)
    let at = 0
    for (let l = 0; l < layout.lines.length; l++) {
      expect(layout.lines[l]!.start).toBe(at)
      let f = at
      for (const fragment of layout.lines[l]!.fragments) {
        const s = fragment.kind === 'hyphen' ? fragment.at : fragment.start
        expect(s).toBe(f)
        if (fragment.kind !== 'hyphen') f = fragment.end
      }
      expect(f).toBe(layout.lines[l]!.end)
      at = layout.lines[l]!.end
    }
    expect(at).toBe(p.runs.reduce((n, r) => n + r.text.length, 0))
  })
})

describe('gecko Canvas recipes (specs/gecko-AUDIT.md B1-B4)', () => {
  const arial = (size: number) => ({ family: 'Arial', size, weight: 400, style: 'normal' as const })
  const gapNames = (p: Paragraph) => layoutParagraph(p, env).gaps.map(g => g.gap)

  test('B2: in-word-prefix only where a prefix and suffix shaped alone differ from the unit', () => {
    expect(gapNames(paragraph([run('aaaa')], 20, { overflowWrap: 'anywhere' }))).not.toContain('in-word-prefix')
    expect(gapNames(paragraph([run('AVAV')], 20, { overflowWrap: 'anywhere' }))).toContain('in-word-prefix')
  })

  test('B3: a suffix is measured in the script the paragraph gives it', () => {
    // W("ا ((") − W("ا ") = 1320 au for "((" after Arabic, where "((" alone is 734 au: line 1 is لا( at exactly 1812 au.
    const p = paragraph([run('لا((')], 30.2, { direction: 'rtl', overflowWrap: 'anywhere' })
    expect(starts(p)).toEqual([0, 3])
    expect(widths(p)).toEqual([1812, 660])
  })

  test('B1a: the device-size emoji advance applies only where Canvas shows Apple Color Emoji draws the cluster', () => {
    const p = (text: string) => paragraph([run(text, 'span', { font: arial(16) })], 500, { font: arial(16) })
    try {
      expect(widths(p('😀'))).toEqual([960])
      expect(gapNames(p('😀'))).not.toContain('font-fallback')
      expect(widths(p('😀︎'))).toEqual([1020])
      expect(gapNames(p('😀︎'))).not.toContain('font-fallback')
      stub.pinned = true
      expect(widths(p('😀'))).toEqual([1020])
      expect(gapNames(p('😀'))).toContain('font-fallback')
    } finally {
      stub.pinned = false
    }
  })

  test('B1b: a soft hyphen inside a grapheme cluster puts the whole cluster before the break', () => {
    // c-27e5b02212b7324f: natively line 2 holds the ligated cluster (750 au) and the hyphen; U+1F680 starts line 3 at 0 au.
    const p = paragraph([run('a👩‍­🚀b', 'text', { font: arial(12) })], 8, { font: arial(12), whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
    expect(starts(p)).toEqual([0, 1, 5])
    expect(widths(p)).toEqual([432, 750 + 432, 432])
  })

  test('B4: trailing white space trimmed with a negative advance widens the line box, not the painted extent', () => {
    // c-79e5272a2644d9b8: the space is 576 − 60 − 600 = −84 au; TrimTrailingWhiteSpace subtracts floor(−84) unclamped.
    const p = paragraph([run('aaaa', 'span'), run(' bbbb', 'span', { letterSpacing: -1, wordSpacing: -10 })], 57.6)
    const layout = layoutParagraph(p, env)
    expect(starts(p)).toEqual([0, 5])
    expect(layout.lines[0]!.engineWidth).toEqual({ unit: 'gecko-app-unit', au: 2304 + 84 })
    expect(layout.lines[0]!.width).toBe(38.4)
  })

  test('a synthesized Unicode space rounds to whole device pixels', () => {
    // 18px U+2009: Canvas 60 × floor(3.6 + 0.5) = 240 au; the DOM at apd 30 30 × floor(7.2 + 0.5) = 210 au.
    const arial18 = paragraph([run('a b', 'span', { font: arial(18) })], 500, { font: arial(18) })
    expect(widths(arial18)).toEqual([648 + 210 + 648])
    const courier18 = { ...courier, size: 18 }
    expect(widths(paragraph([run('a b', 'span', { font: courier18 })], 500, { font: courier18 }))).toEqual([648 * 3])
  })

  test('B4: a hidden control with letter spacing has a rect', () => {
    // c-92b6963ae4344985: a lone VT with 1px letter spacing is 60 au natively.
    const layout = layoutParagraph(paragraph([run('\v', 'span', { letterSpacing: 1 })], 500), env)
    expect(layout.lines.map(l => [l.engineWidth.unit === 'gecko-app-unit' ? l.engineWidth.au : -1, l.width])).toEqual([[60, 1]])
  })
})

// Break positions of one text node, as the groundwork oracle reports them.
function breaks(text: string, whiteSpace: Paragraph['whiteSpace'] = 'normal', wordBreak: Paragraph['wordBreak'] = 'normal') {
  const p = prepareGecko(paragraph([run(text, 'span')], 100, { whiteSpace, wordBreak }), env, createMeasurer())
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
    const p = prepareGecko(paragraph([run(text, 'span')], 100, { whiteSpace, lang }), env, createMeasurer())
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
