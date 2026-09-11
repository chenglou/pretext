import { expect, test } from 'bun:test'
import type { Prediction } from './contracts.ts'
import { assess } from './observe.ts'
import type { NativeExtraction, NativeObservation, NativePoint, WrappingCase } from './types.ts'

const base: WrappingCase = {
  id: 'observer', family: 'observer', origins: ['observer-unit-test'], text: '',
  font: '16px Arial', width: 100, lineHeight: 48, whiteSpace: 'normal', wordBreak: 'normal',
  letterSpacing: 0, direction: 'ltr', scope: 'supported',
}

function prediction(normalized: string, spans: Array<[string, number, number]>): Extract<Prediction, { detail: 'full' }> {
  return {
    detail: 'full', normalized, height: spans.length * 48, countedHeight: spans.length * 48, lineCount: spans.length, contracts: [], passedContracts: [], diagnostics: [],
    lines: spans.map(([text, sourceStart, sourceEnd]) => ({
      text, sourceStart, sourceEnd, width: 10,
      start: { segmentIndex: sourceStart, graphemeIndex: 0 },
      end: { segmentIndex: sourceEnd, graphemeIndex: 0 },
    })),
  }
}

function point(text: string, start: number, line: number): NativePoint {
  return { text, start, end: start + text.length, rects: [{ x: 0, y: 15 + line * 48, width: 10, height: 17 }] }
}

function native(points: NativePoint[], lineCount: number): NativeObservation {
  return { points, lineCount, height: lineCount * 48, lineRects: [] }
}

function extraction(source: string, units: NativePoint[], count: number, method: 'range' | 'span' = 'range'): NativeExtraction {
  return { method, source, units, points: units, height: count * 48, usedLineHeight: 48, lineRects: [] }
}

test('rich inline height is independently observed and cannot inherit a flat or API pass', () => {
  const input: WrappingCase = { ...base, text: '\u200Bhello', parts: ['\u200B', 'hello'], nativeItems: true }
  const oracle = { ...native([], 2), richHeight: 3 * 48 }
  const flat = prediction(input.text, [['\u200Bhel', 0, 4], ['lo', 4, 6]])
  const wrongRich = assess(input, oracle, { ...flat, richLineCount: 2 }, 'safari')
  expect(wrongRich.height.status).toBe('pass')
  expect(wrongRich.api.status).toBe('pass')
  expect(wrongRich.richHeight.status).toBe('fail')
  expect(assess(input, oracle, { ...flat, richLineCount: 3 }, 'safari').richHeight.status).toBe('pass')
  expect(assess(input, oracle, flat, 'safari').richHeight.status).toBe('unobserved')
  expect(assess(input, native([], 2), { ...flat, richLineCount: 3 }, 'safari').richHeight.status).toBe('unobserved')
  expect(assess(base, oracle, flat, 'safari').richHeight.status).toBe('not-applicable')
})

test('fractional CSS line boxes use an independently observed native advance', () => {
  const input: WrappingCase = { ...base, text: 'abc', lineHeight: 20.96 }
  const oracle: NativeObservation = { height: 60, lineCount: 3, usedLineHeight: 20, lineRects: [], points: [
    { text: 'c', start: 2, end: 3, rects: [{ x: 0, y: 43, width: 10, height: 14 }] },
  ] }
  const predicted = { ...prediction('abc', [['a', 0, 1], ['b', 1, 2], ['c', 2, 3]]), height: 62.88, countedHeight: 62.88 }
  expect(assess(input, oracle, predicted, 'safari').height.status).toBe('pass')
  expect(assess(input, oracle, predicted, 'safari').lineCount.status).toBe('pass')
  expect(assess(input, oracle, predicted, 'safari').source.status).toBe('pass')
  expect(assess(input, oracle, { ...predicted, height: 41.92 }, 'safari').height.status).toBe('fail')
})

test('raw collapsed whitespace and astral scalars retain normalized source coordinates', () => {
  const input = { ...base, text: ' \tab \ncd  ' }
  const oracle = native([point('a', 2, 0), point('b', 3, 0), point('c', 6, 1), point('d', 7, 1)], 2)
  expect(assess(input, oracle, prediction('ab cd', [['ab', 0, 3], ['cd', 3, 5]]), 'chrome').source.status).toBe('pass')
  expect(assess(input, oracle, prediction('abcd', [['ab', 0, 2], ['cd', 2, 4]]), 'chrome').source.status).toBe('fail')
  const astral = { ...base, text: '🙂b' }
  expect(assess(astral, native([point('🙂', 0, 0), point('b', 2, 1)], 2), prediction('🙂b', [['🙂', 0, 2], ['b', 2, 3]]), 'chrome').source.status).toBe('pass')
})

test('ambiguous observations stay unknown, while an observed mismatch is still a failure', () => {
  const input = { ...base, text: 'ab' }
  const ambiguous = point('b', 1, 0)
  ambiguous.rects.push(...point('b', 1, 1).rects)
  const oracle = native([point('a', 0, 0), ambiguous], 2)
  expect(assess(input, oracle, prediction('ab', [['a', 0, 1], ['b', 1, 2]]), 'chrome').source.status).toBe('unobserved')
  expect(assess(input, oracle, prediction('ab', [['', 0, 0], ['ab', 0, 2]]), 'chrome').source.status).toBe('fail')
})

test('normalized native corpus observations retain the raw preparation contract', () => {
  const input: WrappingCase = { ...base, text: '\nab\ncd\n', nativeSource: 'normalized' }
  const oracle = native([point('a', 0, 0), point('b', 1, 0), point('c', 3, 1), point('d', 4, 1)], 2)
  expect(assess(input, oracle, prediction('ab cd', [['ab', 0, 3], ['cd', 3, 5]]), 'chrome').source.status).toBe('pass')
  expect(assess(input, oracle, prediction('abcd', [['ab', 0, 2], ['cd', 2, 4]]), 'chrome').source.status).toBe('fail')
})

test('Safari selected SHY uses corroborating whole-line geometry despite overlapping scalar rectangles', () => {
  // Captured Safari Arial 16, pre-wrap, width 14.233333110809326. Range assigns
  // part of the a advance to SHY; individual rectangles are not glyph boxes.
  const input = { ...base, text: 'a\u00adb', whiteSpace: 'pre-wrap' as const, width: 14.233333110809326 }
  const oracle: NativeObservation = {
    height: 96, lineCount: 2,
    points: [
      { text: 'a', start: 0, end: 1, rects: [{ x: 0, y: 15, width: 5, height: 17 }] },
      { text: '\u00ad', start: 1, end: 2, rects: [{ x: 4, y: 15, width: 10.21875, height: 17 }] },
      { text: 'b', start: 2, end: 3, rects: [{ x: 14, y: 15, width: 0, height: 17 }, { x: 0, y: 63, width: 8.8984375, height: 17 }] },
    ],
    lineRects: [{ x: 0, y: 15, width: 14.2265625, height: 17 }, { x: 0, y: 63, width: 8.8984375, height: 17 }],
  }
  expect(assess(input, oracle, prediction(input.text, [['a-', 0, 2], ['b', 2, 3]]), 'safari').hyphen.status).toBe('pass')
  expect(assess(input, oracle, prediction(input.text, [['a', 0, 1], ['b', 1, 3]]), 'safari').hyphen.status).toBe('fail')
  expect(assess(input, { ...oracle, lineRects: [] }, prediction(input.text, [['a-', 0, 2], ['b', 2, 3]]), 'safari').hyphen.status).toBe('unobserved')
})

test('keep-all SHY source rectangles do not prove marker paint; the explicit contract still rejects it', () => {
  // Captured Safari Arial 16, pre-wrap, keep-all, width 10. The engine trace
  // and screenshot establish a / b; Range divides the a advance with SHY.
  const input: WrappingCase = { ...base, text: 'a\u00adb', whiteSpace: 'pre-wrap', wordBreak: 'keep-all', width: 10 }
  const oracle: NativeObservation = {
    height: 96, lineCount: 2,
    points: [
      { text: 'a', start: 0, end: 1, rects: [{ x: 0, y: 15, width: 5, height: 17 }] },
      { text: '\u00ad', start: 1, end: 2, rects: [{ x: 4, y: 15, width: 4.890625, height: 17 }] },
      { text: 'b', start: 2, end: 3, rects: [{ x: 0, y: 63, width: 8.8984375, height: 17 }] },
    ],
    lineRects: [{ x: 0, y: 15, width: 8.8984375, height: 17 }, { x: 0, y: 63, width: 8.8984375, height: 17 }],
  }
  const wrong = prediction(input.text, [['a-', 0, 2], ['b', 2, 3]])
  expect(assess(input, oracle, wrong, 'safari').hyphen.status).toBe('unobserved')
  const verified: WrappingCase = { ...input, discretionary: { expectedText: ['a', 'b'] } }
  expect(assess(verified, oracle, wrong, 'safari').hyphen.status).toBe('fail')
  expect(assess(verified, oracle, prediction(input.text, [['a', 0, 2], ['b', 2, 3]]), 'safari').hyphen.status).toBe('pass')
})

test('same-line SHY is hidden; repeated SHY requires a different native selection oracle', () => {
  const input = { ...base, text: 'a\u00adb' }
  const oracle = native([point('a', 0, 0), point('\u00ad', 1, 0), point('b', 2, 0)], 1)
  expect(assess(input, oracle, prediction(input.text, [['ab', 0, 3]]), 'safari').hyphen.status).toBe('pass')
  expect(assess(input, oracle, prediction(input.text, [['a-b', 0, 3]]), 'safari').hyphen.status).toBe('fail')
  expect(assess({ ...input, text: 'a\u00ad\u00adb' }, oracle, prediction('a\u00ad\u00adb', [['ab', 0, 4]]), 'safari').hyphen.status).toBe('unobserved')
})

test('maintained discretionary text and whole-line widths remain independent enforced checks', () => {
  const input: WrappingCase = { ...base, text: 'abc\u00ad', letterSpacing: -1, discretionary: { expectedText: ['abc'] } }
  const oracle = native([point('a', 0, 0), point('b', 1, 0), point('c', 2, 0)], 1)
  oracle.lineRects = [{ x: 0, y: 15, width: 10, height: 17 }]
  const correct = prediction(input.text, [['abc', 0, 4]])
  expect(assess(input, oracle, correct, 'safari').widths.status).toBe('pass')
  expect(assess(input, oracle, correct, 'safari').hyphen.status).toBe('pass')
  const wrongText = prediction(input.text, [['abc-', 0, 4]])
  expect(assess(input, oracle, wrongText, 'safari').hyphen.status).toBe('fail')
  const wrongWidth = { ...oracle, lineRects: [{ x: 0, y: 15, width: 10.03, height: 17 }] }
  expect(assess(input, wrongWidth, correct, 'safari').widths.status).toBe('fail')
  const { discretionary: _checked, ...genericInput } = input
  expect(assess(genericInput, oracle, correct, 'safari').widths.status).toBe('unobserved')
})

test('nonfinite predicted widths cannot pass through a NaN tolerance comparison', () => {
  const input = { ...base, text: 'a' }
  const predicted = prediction('a', [['a', 0, 1]])
  predicted.lines[0]!.width = Number.NaN
  const oracle = native([point('a', 0, 0)], 1)
  oracle.lineRects = [{ x: 0, y: 15, width: 10, height: 17 }]
  expect(assess(input, oracle, predicted, 'chrome').widths.status).toBe('fail')
})

test('maintained height criteria keep their original exact and rounding semantics', () => {
  const input = { ...base, text: 'a' }
  const predicted = prediction('a', [['a', 0, 1]])
  const oracle = { ...native([point('a', 0, 0)], 1), height: predicted.height - 0.75 }
  expect(assess({ ...input, heightMode: 'exact' }, oracle, predicted, 'chrome').height.status).toBe('fail')
  expect(assess({ ...input, heightMode: 'accuracy' }, oracle, predicted, 'chrome').height.status).toBe('pass')
  expect(assess({ ...input, heightMode: 'corpus' }, oracle, predicted, 'chrome').height.status).toBe('fail')
  expect(assess({ ...input, heightMode: 'accuracy' }, { ...oracle, height: predicted.height - 1 }, predicted, 'chrome').height.status).toBe('fail')
})

test('selected extraction keeps its own height and proves unambiguous visible boundaries', () => {
  const input: WrappingCase = { ...base, text: 'abcd', lineMethod: 'span' }
  const units = [point('a', 0, 0), point('b', 1, 0), point('c', 2, 1), point('d', 3, 1)]
  const oracle = { ...native(units, 2), extraction: extraction(input.text, units, 2, 'span') }
  const correct = prediction(input.text, [['ab', 0, 2], ['cd', 2, 4]])
  expect(assess(input, oracle, correct, 'chrome').lineCount.status).toBe('pass')
  expect(assess(input, oracle, correct, 'chrome').breaks.status).toBe('pass')
  const wrong = prediction(input.text, [['a', 0, 1], ['bcd', 1, 4]])
  expect(assess(input, oracle, wrong, 'chrome').lineCount.status).toBe('pass')
  expect(assess(input, oracle, wrong, 'chrome').breaks.status).toBe('fail')
  // A span intervention can change wrapping while the original text node does not.
  const countMismatch = { ...oracle, extraction: { ...oracle.extraction, height: 3 * 48 } }
  expect(assess(input, countMismatch, correct, 'chrome').height.status).toBe('pass')
  expect(assess(input, countMismatch, correct, 'chrome').source.status).toBe('pass')
  expect(assess(input, countMismatch, correct, 'chrome').lineCount.status).toBe('fail')
  const differentSource = { ...oracle, extraction: { ...oracle.extraction, source: 'other source' } }
  expect(assess(input, differentSource, correct, 'chrome').lineCount.status).toBe('unobserved')
  const differentMethod = { ...oracle, extraction: { ...oracle.extraction, method: 'range' as const } }
  expect(assess(input, differentMethod, correct, 'chrome').breaks.status).toBe('unobserved')
})

test('legacy source groups cannot supply missing extraction-stage geometry', () => {
  const input: WrappingCase = { ...base, text: 'ab', lineMethod: 'range' }
  const legacy = { ...native([point('a', 0, 0), point('b', 1, 1)], 2), extractedLines: [{ start: 0, end: 2 }] }
  const correct = prediction(input.text, [['a', 0, 1], ['b', 1, 2]])
  const result = assess(input, legacy, correct, 'safari')
  expect(result.height.status).toBe('pass')
  expect(result.source.status).toBe('pass')
  expect(result.lineCount.status).toBe('unobserved')
  expect(result.breaks.status).toBe('unobserved')
})

test('collapsed normal-mode SPACE ownership cannot change the visible boundary envelope', () => {
  const input: WrappingCase = { ...base, text: 'ab cd', lineMethod: 'span' }
  const space: NativePoint = { text: ' ', start: 2, end: 3, rects: [] }
  const units = [point('a', 0, 0), point('b', 1, 0), space, point('c', 3, 1), point('d', 4, 1)]
  const oracle = { ...native(units, 2), extraction: extraction(input.text, units, 2, 'span') }
  const trailingSpace = prediction(input.text, [['ab', 0, 3], ['cd', 3, 5]])
  const leadingSpace = prediction(input.text, [['ab', 0, 2], ['cd', 2, 5]])
  expect(assess(input, oracle, trailingSpace, 'safari').breaks.status).toBe('pass')
  expect(assess(input, oracle, leadingSpace, 'safari').breaks.status).toBe('pass')
  expect(assess({ ...input, whiteSpace: 'pre-wrap' }, oracle, trailingSpace, 'safari').breaks.status).toBe('unobserved')
  const extraLine = prediction(input.text, [['ab', 0, 2], ['', 2, 3], ['cd', 3, 5]])
  expect(assess(input, oracle, extraLine, 'safari').breaks.status).toBe('fail')
  const nbsp = { ...input, text: 'ab\u00a0cd' }
  const nbspUnits = units.map(unit => unit === space ? { ...unit, text: '\u00a0' } : unit)
  const nbspOracle = { ...native(nbspUnits, 2), extraction: extraction(nbsp.text, nbspUnits, 2, 'span') }
  expect(assess(nbsp, nbspOracle, prediction(nbsp.text, [['ab', 0, 3], ['cd', 3, 5]]), 'safari').breaks.status).toBe('unobserved')
})

test('preserved LF topology establishes hard-line endpoints only when its measured count excludes soft wraps', () => {
  const input: WrappingCase = { ...base, lineMethod: 'range', whiteSpace: 'pre-wrap' }
  function check(text: string, spans: Array<[string, number, number]>) {
    const predicted = prediction(text, spans)
    const points = spans.flatMap(([, start, end], line) => Array.from(text.slice(start, end), (scalar, offset) =>
      /[ \t\n\u00ad\u200b\u2060]/u.test(scalar)
        ? { text: scalar, start: start + offset, end: start + offset + 1, rects: [] }
        : point(scalar, start + offset, line)))
    const oracle = { ...native(points, spans.length), extraction: extraction(text, points, spans.length) }
    return { result: assess({ ...input, text }, oracle, predicted, 'safari'), oracle, predicted }
  }
  for (const [text, spans] of [
    ['', []],
    ['\n', [['', 0, 1]]],
    ['\n\n', [['', 0, 1], ['', 1, 2]]],
    ['a\n', [['a', 0, 2]]],
    [' \n\t\nb', [[' ', 0, 2], ['\t', 2, 4], ['b', 4, 5]]],
    ['a\n  b', [['a', 0, 2], ['  b', 2, 5]]],
    ['a\u2060b\n', [['ab', 0, 4]]],
  ] as Array<[string, Array<[string, number, number]>]>) expect(check(text, spans).result.breaks.status).toBe('pass')
  for (const [text, spans] of [
    ['\u2060\n', [['\u2060', 0, 2]]],
    ['\n\u200b\n', [['', 0, 1], ['\u200b', 1, 3]]],
    ['a\n\u00ad', [['a', 0, 2], ['\u00ad', 2, 3]]],
    ['ab\nc', [['a', 0, 1], ['b', 1, 3], ['c', 3, 4]]],
  ] as Array<[string, Array<[string, number, number]>]>) expect(check(text, spans).result.breaks.status).toBe('unobserved')
  const { oracle, predicted } = check('a\nb', [['a', 0, 2], ['b', 2, 3]])
  oracle.extraction.points[2] = point('b', 2, 0)
  expect(assess({ ...input, text: 'a\nb' }, oracle, predicted, 'safari').breaks.status).toBe('fail')
  const indent = check(' a\n', [[' a', 0, 3]])
  expect(assess({ ...input, text: ' a\n' }, indent.oracle, prediction(' a\n', [['a', 1, 3]]), 'safari').breaks.status).toBe('fail')
})

test('literal preserved span boxes can establish whitespace ownership without interpreting arbitrary Range rectangles', () => {
  const input: WrappingCase = { ...base, text: 'a b', lineMethod: 'span', whiteSpace: 'pre-wrap' }
  const units = [point('a', 0, 0), point(' ', 1, 0), point('b', 2, 1)]
  const stage = extraction(input.text, units, 2, 'span')
  const oracle = { ...native(units, 2), extraction: stage }
  const correct = prediction(input.text, [['a ', 0, 2], ['b', 2, 3]])
  expect(assess(input, oracle, correct, 'safari').breaks.status).toBe('pass')
  expect(assess(input, oracle, prediction(input.text, [['a', 0, 1], [' b', 1, 3]]), 'safari').breaks.status).toBe('fail')
  const unknownSpace = { ...units[1]!, rects: [] }
  const zeroSpace = { ...units[1]!, rects: units[1]!.rects.map(rect => ({ ...rect, width: 0 })) }
  for (const [box, scalar] of [
    [unknownSpace, units[1]!],
    [zeroSpace, zeroSpace],
    [{ ...units[1]!, rects: [...units[1]!.rects, ...zeroSpace.rects] }, units[1]!],
    [units[1]!, point(' ', 1, 1)],
    [{ ...units[1]!, text: ' \u0301', end: 3 }, units[1]!],
  ]) {
    const ambiguous = { ...stage, units: [units[0]!, box!, units[2]!], points: [units[0]!, scalar!, units[2]!] }
    expect(assess(input, { ...oracle, extraction: ambiguous }, correct, 'safari').breaks.status).toBe('unobserved')
  }
  expect(assess({ ...input, lineMethod: 'range' }, { ...oracle, extraction: { ...stage, method: 'range' } }, correct, 'safari').breaks.status).toBe('unobserved')
  for (const scalar of ['\t', '\u00a0', '\u2060']) {
    const text = `a${scalar}b`
    const points = units.map(unit => unit.start === 1 ? { ...unit, text: scalar } : unit)
    const result = assess({ ...input, text }, { ...oracle, extraction: extraction(text, points, 2, 'span') }, prediction(text, [[text.slice(0, 2), 0, 2], ['b', 2, 3]]), 'safari')
    expect(result.breaks.status).toBe(scalar === '\t' ? 'pass' : 'unobserved')
  }
})

test('mixed graphemes retain visible scalar evidence and internal controls do not obscure fixed endpoints', () => {
  const input: WrappingCase = { ...base, text: 'a\u200db', lineMethod: 'range' }
  const a = point('a', 0, 0), b = point('b', 2, 0)
  const control: NativePoint = { text: '\u200d', start: 1, end: 2, rects: [] }
  const mixed: NativePoint = { text: 'a\u200d', start: 0, end: 2, rects: [] }
  const stage = { ...extraction(input.text, [mixed, b], 1), points: [a, control, b] }
  const oracle = { ...native(stage.points, 1), extraction: stage }
  const correct = prediction(input.text, [['ab', 0, 3]])
  expect(assess(input, oracle, correct, 'safari').breaks.status).toBe('pass')
  const wrong = prediction(input.text, [['', 0, 0], ['ab', 0, 3]])
  expect(assess(input, oracle, wrong, 'safari').breaks.status).toBe('fail')
  for (const text of ['\u200dab', 'ab\u200d']) {
    const points = Array.from(text, (scalar, index) => scalar === '\u200d'
      ? { text: scalar, start: index, end: index + 1, rects: [] }
      : point(scalar, index, 0))
    const edgeOracle = { ...native(points, 1), extraction: extraction(text, points, 1) }
    expect(assess({ ...input, text }, edgeOracle, prediction(text, [['ab', 0, 3]]), 'safari').breaks.status).toBe('unobserved')
  }
})

test('carried zero rectangles do not erase a line or assign invisible source ownership', () => {
  // Captured Safari Arial16, pre-wrap, width0: a / WJ / acute / b / ZWSP / i.
  // WJ has two zero rectangles; even ZWSP has a positive rectangle.
  const input: WrappingCase = { ...base, text: 'a\u2060\u0301b\u200Bi', lineMethod: 'range', whiteSpace: 'pre-wrap', width: 0, lineHeight: 24 }
  const rect = (y: number, width: number) => ({ x: 0, y, width, height: 17 })
  const units: NativePoint[] = [
    { text: 'a', start: 0, end: 1, rects: [rect(3, 8.8984375)] },
    { text: '\u2060', start: 1, end: 2, rects: [rect(3, 0), rect(27, 0)] },
    { text: '\u0301', start: 2, end: 3, rects: [rect(27, 0), rect(51, 2.96875)] },
    { text: 'b', start: 3, end: 4, rects: [rect(51, 0), rect(75, 8.8984375)] },
    { text: '\u200B', start: 4, end: 5, rects: [rect(75, 0), rect(99, 2.96875)] },
    { text: 'i', start: 5, end: 6, rects: [rect(99, 0), rect(123, 3.5546875)] },
  ]
  const stage: NativeExtraction = { method: 'range', source: input.text, height: 144, usedLineHeight: 24, units, points: units, lineRects: [rect(3, 8.8984375), rect(27, 0), rect(51, 2.96875), rect(75, 8.8984375), rect(99, 2.96875), rect(123, 3.5546875)] }
  const oracle: NativeObservation = { height: 144, lineCount: 6, points: units, lineRects: stage.lineRects, extraction: stage }
  const six = prediction(input.text, units.map(unit => [unit.text, unit.start, unit.end]))
  six.height = six.countedHeight = 144
  expect(assess(input, oracle, six, 'safari').height.status).toBe('pass')
  expect(assess(input, oracle, six, 'safari').lineCount.status).toBe('pass')
  expect(assess(input, oracle, six, 'safari').breaks.status).toBe('unobserved')
  const five = prediction(input.text, [['a\u2060', 0, 2], ['\u0301', 2, 3], ['b', 3, 4], ['\u200B', 4, 5], ['i', 5, 6]])
  five.height = five.countedHeight = 120
  expect(assess(input, oracle, five, 'safari').lineCount.status).toBe('fail')
  expect(assess(input, oracle, five, 'safari').breaks.status).toBe('fail')
  const wrong = prediction(input.text, [['a', 0, 1], ['\u2060', 1, 2], ['', 2, 2], ['\u0301b', 2, 4], ['\u200B', 4, 5], ['i', 5, 6]])
  wrong.height = wrong.countedHeight = 144
  expect(assess(input, oracle, wrong, 'safari').lineCount.status).toBe('pass')
  expect(assess(input, oracle, wrong, 'safari').breaks.status).toBe('fail')
})

test('multiple positive rectangles cannot choose the following letter source line', () => {
  // Chrome's b after a selected SHY carries the preceding hyphen rectangle.
  const input: WrappingCase = { ...base, text: 'a\u00adb', lineMethod: 'range' }
  const b = point('b', 2, 1)
  b.rects.push(...point('b', 2, 2).rects)
  const units = [point('a', 0, 0), point('\u00ad', 1, 1), b]
  const oracle = { ...native(units, 3), extraction: extraction(input.text, units, 3) }
  const correctCount = prediction(input.text, [['a', 0, 1], ['-', 1, 2], ['b', 2, 3]])
  expect(assess(input, oracle, correctCount, 'chrome').lineCount.status).toBe('pass')
  expect(assess(input, oracle, correctCount, 'chrome').breaks.status).toBe('unobserved')
  b.rects.reverse()
  expect(assess(input, oracle, correctCount, 'chrome').breaks.status).toBe('unobserved')
})

test('legacy geometry uses its actual layout height and materialized line count', () => {
  const input: WrappingCase = { ...base, text: 'a', heightMode: 'exact', heightSource: 'layout', lineMethod: 'span' }
  const units = [point('a', 0, 0)]
  const oracle = { ...native(units, 1), extraction: extraction(input.text, units, 1, 'span') }
  const result = { ...prediction('a', [['a', 0, 1]]), height: 96, lineCount: 2 }
  expect(assess(input, oracle, result, 'chrome').height.status).toBe('pass')
  expect(assess(input, oracle, result, 'chrome').lineCount.status).toBe('pass')
  expect(assess(input, oracle, { ...result, countedHeight: 96 }, 'chrome').height.status).toBe('fail')
  const discretionary = { ...input, heightSource: 'lines' as const, discretionary: { expectedText: ['a'] } }
  expect(assess(discretionary, oracle, { ...result, countedHeight: 96 }, 'chrome').height.status).toBe('pass')
})
