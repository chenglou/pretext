// WebKit lines on four paths that no recorded case runs, so tier 1 (tests/replay.ts) says nothing of them: the coverage map
// (tests/coverage-map.ts) of the recorded sets lists lastValidBreakingPosition whole, the second shaping of
// shapePartialLineCandidate, placeInlineBoxesOnly, and the line-spanning inline box that gets no display box
// (output.ts nonBidiDisplayBoxes). A case reaches the third only with an empty text leaf inside its spans, since a case
// needs a leaf (lab/cases/case.ts). The stand-in Canvas gives every code unit 8 px and the two joiners none, so the
// expectations follow from the cited source rules by hand: no expectation here is a browser observation.
import { describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type WebKitEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type BoxEdge } from '../../model.js'
import { everyLine, type Insets, type Sized } from '../../test-lines.js'
import type { WebKitDisplayBox } from './geometry.js'
import { fillLine, firstLine, inspectLine, linePieces, prepare } from './index.js'
import { span, treeParagraph } from './test-paragraph.js'

class StandInContext {
  font = ''
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number } {
    let width = 0
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) !== 0x200c && text.charCodeAt(i) !== 0x200d) width += 8
    return { width }
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
const arial = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts: UNKNOWN_FONT_FACTS }

// A box as the tests read it: an inline box as [kind, element, x, width, start edge, end edge], a text box as [kind, run, start,
// end, x, width].
function boxRow(box: WebKitDisplayBox): unknown[] {
  switch (box.kind) {
    case 'inline-box': return ['inline-box', box.element, box.x, box.width, box.hasStartEdge, box.hasEndEdge]
    case 'text':
    case 'soft-line-break': return [box.kind, box.run, box.start, box.end, box.x, box.width]
    case 'atomic':
    case 'line-break': return [box.kind, box.element, box.x, box.width]
  }
}

function layout(p: Sized, insets: Insets[] = []): { range: [number, number]; hasLineBox: boolean; boxes: unknown[][]; gaps: string[] }[] {
  const prepared = prepare(p, env, true, [])
  const { lines } = everyLine({
    first: firstLine(prepared), fill: (start, slot) => fillLine(prepared, start, slot), inspect: line => inspectLine(prepared, line), pieces: line => linePieces(prepared, line),
  }, p.width, insets)
  return lines.map(line => ({ range: [line.start, line.end], hasLineBox: line.hasLineBox, boxes: line.geometry.boxes.map(boxRow), gaps: line.gaps.map(gap => gap.gap) }))
}

describe('lastValidBreakingPosition (InlineContentBreaker.cpp:364-403): word-break: break-all before content that overflows and does not wrap', () => {
  const block = treeParagraph([], arial, { width: 40, wordBreak: 'break-all' })

  test('the run before breaks at its end where the next text allows a break before its first character', () => {
    const lines = layout({ ...block, content: [{ kind: 'text', text: 'abc' }, span(block, [{ kind: 'text', text: 'defgh' }], { whiteSpace: 'nowrap' })] })
    expect(lines.map(line => line.range)).toEqual([[0, 3], [3, 8]])
    expect(lines[1]!.boxes).toEqual([['inline-box', 0, 0, 40, true, true], ['text', 1, 0, 5, 0, 40]])
  })

  test('and inside, at its last break opportunity, where the next text starts with a character no line starts with', () => {
    const lines = layout({ ...block, content: [{ kind: 'text', text: 'abc' }, span(block, [{ kind: 'text', text: ')defg' }], { whiteSpace: 'nowrap' })] })
    expect(lines.map(line => line.range)).toEqual([[0, 2], [2, 8]])
    expect(lines[1]!.boxes).toEqual([['text', 0, 2, 3, 0, 8], ['inline-box', 0, 8, 40, true, true], ['text', 1, 0, 5, 8, 40]])
  })
})

describe('shapePartialLineCandidate (InlineLineBuilder.cpp:981-1028): a line that ends inside a range shaped across inline boxes', () => {
  test('the range is shaped again from its start to the last text kept, and the rest starts the next line', () => {
    const letters = 'بةتثجح'
    const block = treeParagraph([], { ...arial, family: 'Geeza Pro' }, { width: 56, direction: 'rtl', lang: 'ar', wordBreak: 'break-all' })
    const lines = layout({ ...block, content: [{ kind: 'text', text: letters }, span(block, [{ kind: 'text', text: letters }]), { kind: 'text', text: letters }] })
    expect(lines.map(line => line.range)).toEqual([[0, 7], [7, 14], [14, 18]])
    // Visual order, right to left: the first leaf, then the span's first letter at the line's left.
    expect(lines[0]!.boxes).toEqual([['inline-box', 0, 0, 8, true, false], ['text', 1, 0, 1, 0, 8], ['text', 0, 0, 6, 8, 48]])
    expect(lines[1]!.boxes).toEqual([['text', 2, 0, 2, 0, 16], ['inline-box', 0, 16, 40, false, true], ['text', 1, 1, 6, 16, 40]])
    for (let i = 0; i < lines.length; i++) expect(lines[i]!.gaps).toEqual(['rtl-shaping-across-inline-boxes'])
  })
})

describe('placeInlineBoxesOnly (RangeBasedLineBuilder.cpp:51-78): content of inline boxes alone', () => {
  const block = treeParagraph([], arial, { width: 100 })

  test('an empty span is one line without a line box, and its box has both edges', () => {
    expect(layout({ ...block, content: [span(block, [])] })).toEqual([{ range: [0, 0], hasLineBox: false, boxes: [['inline-box', 0, 0, 0, true, true]], gaps: [] }])
  })

  test('decorated spans take LineBuilder instead, and the line has a line box', () => {
    const start: BoxEdge = { margin: 1, border: 2, padding: 3 }
    const end: BoxEdge = { margin: 0, border: 0, padding: 5 }
    expect(layout({ ...block, content: [span(block, [span(block, [])], {}, start, end)] })).toEqual([
      { range: [0, 0], hasLineBox: true, boxes: [['inline-box', 0, 1, 10, true, true], ['inline-box', 1, 6, 0, true, true]], gaps: [] },
    ])
  })
})

describe('a line-spanning inline box on a row beside a float, without content (InlineDisplayContentBuilder.cpp:603-609)', () => {
  test('gets no display box, and neither does its end', () => {
    const block = treeParagraph([], arial, { width: 100 })
    const lines = layout({ ...block, content: [span(block, [{ kind: 'text', text: 'aaaa\n ' }], { whiteSpace: 'pre-line' })] }, [{ left: 5, right: 0 }, { left: 10, right: 0 }])
    expect(lines.map(line => [line.range, line.hasLineBox])).toEqual([[[0, 5], true], [[5, 6], false]])
    expect(lines[0]!.boxes).toEqual([['inline-box', 0, 5, 32, true, false], ['text', 0, 0, 4, 5, 32], ['soft-line-break', 0, 4, 5, 37, 0]])
    expect(lines[1]!.boxes).toEqual([])
  })
})
