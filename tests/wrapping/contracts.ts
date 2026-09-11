import type { WrappingCase } from './types.ts'

type Cursor = { segmentIndex: number; graphemeIndex: number }
type Range = { width: number; start: Cursor; end: Cursor }
type Line = Range & { text: string }
type Stats = { lineCount: number; maxLineWidth: number }
type LayoutResult = { lineCount: number; height: number }
type Options = Pick<WrappingCase, 'whiteSpace' | 'wordBreak' | 'letterSpacing'>

// Only the documented surface is shared across candidates. In particular, no
// prepared widths, break kinds, shaping tables, or experimental paint fields
// appear here. Copies retain every returned field without prescribing its name.
type PublicLayoutApi<Prepared, WithSegments extends Prepared & { segments: string[] }> = {
  prepare(text: string, font: string, options?: Options): Prepared
  prepareWithSegments(text: string, font: string, options?: Options): WithSegments
  layout(prepared: Prepared, width: number, lineHeight: number): LayoutResult
  layoutWithLines(prepared: WithSegments, width: number, lineHeight: number): LayoutResult & { lines: Line[] }
  layoutNextLine(prepared: WithSegments, start: Cursor, width: number): Line | null
  layoutNextLineRange(prepared: WithSegments, start: Cursor, width: number): Range | null
  materializeLineRange(prepared: WithSegments, range: Range): Line
  walkLineRanges(prepared: WithSegments, width: number, visit: (line: Range) => void): number
  measureLineStats(prepared: WithSegments, width: number): Stats
  measureNaturalWidth(prepared: WithSegments): number
  setLocale(locale?: string): void
}

type RichCursor = Cursor & { itemIndex: number }
type RichFragment = { itemIndex: number; gapBefore: number; occupiedWidth: number; start: Cursor; end: Cursor }
type RichRange = { fragments: RichFragment[]; width: number; end: RichCursor }
type RichLine = Omit<RichRange, 'fragments'> & { fragments: Array<RichRange['fragments'][number] & { text: string }> }
type RichItem = { text: string; font: string; letterSpacing?: number; break?: 'normal' | 'never'; extraWidth?: number }
type PublicRichApi<Prepared> = {
  prepareRichInline(items: RichItem[]): Prepared
  layoutNextRichInlineLineRange(prepared: Prepared, width: number, start?: RichCursor): RichRange | null
  materializeRichInlineLineRange(prepared: Prepared, range: RichRange): RichLine
  walkRichInlineLineRanges(prepared: Prepared, width: number, visit: (line: RichRange) => void): number
  measureRichInlineStats(prepared: Prepared, width: number): Stats
}

export type ContractFailure = { contract: string; detail: string }
export type PredictionLine = Line & { sourceStart: number; sourceEnd: number }
export type Prediction =
  | ({ detail: 'height' } & LayoutResult)
  | ({ detail: 'full'; countedHeight: number; normalized: string; lines: PredictionLine[]; contracts: ContractFailure[]; passedContracts: string[]; diagnostics: ContractFailure[]; richLineCount?: number } & LayoutResult)

export function normalizeSource(text: string, whiteSpace: WrappingCase['whiteSpace']): string {
  return whiteSpace === 'pre-wrap'
    ? text.replace(/\r\n/g, '\n').replace(/[\r\f]/g, '\n')
    : text.replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '')
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sameCursor(a: Cursor, b: Cursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex
}

function sameWidth(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.000001
}

function orderedJSONValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJSONValue)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) ordered[key] = orderedJSONValue(record[key])
  return ordered
}

function sameLine(a: Line | null, b: Line | null): boolean {
  if (a === null || b === null) return a === b
  if (!sameWidth(a.width, b.width)) return false
  // Paint metadata can differ even when text and source cursors agree. Compare
  // every returned field without prescribing an experimental representation.
  return JSON.stringify(orderedJSONValue({ ...a, width: 0 })) === JSON.stringify(orderedJSONValue({ ...b, width: 0 }))
}

function sameLines(a: Line[], b: Line[]): boolean {
  return a.length === b.length && a.every((line, i) => sameLine(line, b[i]!))
}

function isSuppressedBoundary(text: string, whiteSpace: WrappingCase['whiteSpace']): boolean {
  // Rendering ranges may omit collapsed spaces and inactive break controls at
  // a line boundary. This is deliberately not a default-ignorable character
  // filter: joiners, combining marks, and preserved spaces/tabs still matter.
  // A hard break's effect need not give its newline to either rendering range.
  return (whiteSpace === 'normal' ? /^[ \u00AD\u200B]*$/ : /^[\n\u00AD\u200B]*$/).test(text)
}

type Check = (condition: boolean, contract: string, detail: string) => void

function collector() {
  // A contract has one outcome. Repeated checks retain the first failure.
  const outcomes: Record<string, string | null> = {}
  const check: Check = (condition, contract, detail) => {
    if (!(contract in outcomes) || outcomes[contract] === null) outcomes[contract] = condition ? null : detail
  }
  function run(name: string, action: (check: Check) => void): void {
    const group = collector()
    let complete = false
    try {
      action(group.check)
      complete = true
      group.check(true, 'completion', '')
    } catch (error) {
      group.check(false, 'completion', error instanceof Error ? error.message : String(error))
    }
    // Interrupted groups retain counterexamples, but none of their partial
    // repeated checks establish a pass for later lines that never ran.
    const result = group.result()
    for (const failure of result.failures) check(false, `${name}/${failure.contract}`, failure.detail)
    if (complete) for (const contract of result.passedContracts) check(true, `${name}/${contract}`, '')
  }
  function result(): { failures: ContractFailure[]; passedContracts: string[] } {
    const failures: ContractFailure[] = []
    const passedContracts: string[] = []
    for (const [contract, detail] of Object.entries(outcomes)) {
      if (detail === null) passedContracts.push(contract)
      else failures.push({ contract, detail })
    }
    return { failures, passedContracts }
  }
  return { check, run, result }
}

function sourceOffsets(segments: string[], segmenter: Intl.Segmenter): number[][] {
  let offset = 0
  const offsets = segments.map(segment => {
    const starts = Array.from(segmenter.segment(segment), part => offset + part.index)
    offset += segment.length
    starts.push(offset)
    return starts
  })
  offsets.push([offset])
  return offsets
}

// Height-only observations choose one preparation route; full contracts need
// both handles. Other assertion and native-oracle settings remain per case.
export function samePreparation(a: WrappingCase, b: WrappingCase): boolean {
  return a.text === b.text && a.font === b.font && a.whiteSpace === b.whiteSpace &&
    a.wordBreak === b.wordBreak && a.letterSpacing === b.letterSpacing &&
    a.context?.lang === b.context?.lang &&
    (a.locale || undefined) === (b.locale || undefined) &&
    (a.detail === 'height') === (b.detail === 'height') &&
    (a.detail !== 'height' || a.heightSource === b.heightSource)
}

export function createVariant<Prepared, WithSegments extends Prepared & { segments: string[] }, RichPrepared>(
  name: string,
  api: PublicLayoutApi<Prepared, WithSegments>,
  richApi?: PublicRichApi<RichPrepared>,
): {
  name: string
  predict: (input: WrappingCase) => Prediction
  prepare: (input: WrappingCase) => (input: WrappingCase) => Prediction
  checkRichContracts: (input: { font: string; letterSpacing: number }, includeStructure?: boolean) => { failures: ContractFailure[]; passedContracts: string[] }
} {
  function prepare(input: WrappingCase): (input: WrappingCase) => Prediction {
    const locale = input.locale === '' ? undefined : input.locale
    api.setLocale(locale)
    const options = { whiteSpace: input.whiteSpace, wordBreak: input.wordBreak, letterSpacing: input.letterSpacing }
    const preparedForCount = input.detail === 'height' && input.heightSource === 'layout'
      ? api.prepareWithSegments(input.text, input.font, options)
      : api.prepare(input.text, input.font, options)
    if (input.detail === 'height') return input => ({ detail: 'height', ...api.layout(preparedForCount, input.width, input.lineHeight) })

    const prepared = api.prepareWithSegments(input.text, input.font, options)
    const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' })

    return input => {
      const counted = api.layout(preparedForCount, input.width, input.lineHeight)
      const batch = api.layoutWithLines(prepared, input.width, input.lineHeight)
      const countedHeight = input.heightSource === 'layout' ? api.layout(prepared, input.width, input.lineHeight).height : counted.height
      const normalized = prepared.segments.join('')
      const offsets = sourceOffsets(prepared.segments, segmenter)
      const { check, run, result } = collector()
      const diagnostics = collector()

      function offset(cursor: Cursor): number {
        const value = offsets[cursor.segmentIndex]?.[cursor.graphemeIndex]
        if (value === undefined) throw new Error(`Invalid source cursor ${JSON.stringify(cursor)}`)
        return value
      }

      function checkSource(lines: Line[], contract: string, exactContract: string, check: Check): void {
        let end = 0
        for (const line of lines) {
          const start = offset(line.start)
          const next = offset(line.end)
          check(start >= end && next > start, contract, `Expected forward, nonoverlapping progress after ${end}; got ${start}..${next}`)
          check(isSuppressedBoundary(normalized.slice(end, start), input.whiteSpace), contract, `Unconsumed source between ${end} and ${start}`)
          diagnostics.check(start === end && next > start, exactContract, `Expected exact source partition after ${end}; got ${start}..${next}`)
          end = next
        }
        check(isSuppressedBoundary(normalized.slice(end), input.whiteSpace), contract, `Unconsumed source after ${end}/${normalized.length} normalized UTF-16 units`)
        diagnostics.check(end === normalized.length, exactContract, `Consumed ${end}/${normalized.length} normalized UTF-16 units`)
      }

      function stream(widths: number[], check: Check): Line[] {
        const lines: Line[] = []
        let cursor: Cursor = { segmentIndex: 0, graphemeIndex: 0 }
        // Every successful step consumes source. A broken candidate must produce
        // a reported failure instead of hanging the shared browser sweep.
        for (let i = 0; i <= normalized.length + 1; i++) {
          const width = widths[i % widths.length]!
          const before = copy(cursor)
          const line = api.layoutNextLine(prepared, cursor, width)
          check(sameCursor(cursor, before), 'cursor-input-immutable', 'layoutNextLine mutated its input cursor')
          const range = api.layoutNextLineRange(prepared, copy(before), width)
          check((line === null) === (range === null), 'stream-range-agreement', 'Text and range stepping disagree on termination')
          if (line === null) return lines
          if (range !== null) {
            const materialized = api.materializeLineRange(prepared, range)
            check(sameLine(line, materialized), 'stream-range-agreement', 'Text and range stepping disagree')
            const copied = api.materializeLineRange(prepared, copy(range))
            check(sameLine(line, copied), 'range-json-copy', 'JSON-copied range changes materialization')
            check(sameLine(line, api.materializeLineRange(prepared, copy(materialized))), 'line-rematerialization', 'A materialized line loses information needed for rematerialization')
          }
          check(sameLine(line, api.layoutNextLine(prepared, copy(before), width)), 'cursor-json-resume', 'A copied cursor changes the next line')
          if (offset(line.end) <= offset(before)) {
            check(false, 'cursor-progress', 'Streaming did not advance its source cursor')
            throw new Error('Streaming stopped before consuming source')
          }
          lines.push(line)
          cursor = copy(line.end)
        }
        check(false, 'cursor-progress', 'Streaming exceeded the number of source units')
        throw new Error('Streaming did not terminate')
      }

      check(normalized === normalizeSource(input.text, input.whiteSpace), 'source-normalization', 'Prepared segments lose or change normalized source text')
      check(batch.lineCount === batch.lines.length && batch.height === batch.lineCount * input.lineHeight, 'batch-result', 'Batch line count or height disagrees with its lines')
      check(counted.lineCount === batch.lineCount && counted.height === batch.height, 'opaque-rich-agreement', 'prepare/layout and prepareWithSegments/layoutWithLines disagree')
      run('source-coverage', check => checkSource(batch.lines, 'source-coverage', 'source-conservation', check))
      if (input.emergencyGraphemes === true) {
        run('emergency-graphemes', check => {
          const boundaries = new Set(Array.from(segmenter.segment(normalized), part => part.index))
          boundaries.add(normalized.length)
          for (const line of batch.lines) {
            const start = offset(line.start), end = offset(line.end)
            check(boundaries.has(start) && boundaries.has(end), 'emergency-graphemes', `Emergency boundary splits a complete grapheme at ${start}..${end}`)
            check(line.text === normalized.slice(start, end), 'emergency-source-text', 'Emergency line text differs from its complete source graphemes')
          }
        })
      }
      run('stats-agreement', check => {
        const stats = api.measureLineStats(prepared, input.width)
        const widest = Math.max(0, ...batch.lines.map(line => line.width))
        check(stats.lineCount === batch.lineCount && sameWidth(stats.maxLineWidth, widest), 'stats-agreement', 'Stats disagree with batch line count or widest line')
      })
      run('fixed-stream', check => {
        const lines = stream([input.width], check)
        check(sameLines(lines, batch.lines), 'fixed-stream', 'Fixed-width streaming disagrees with batch lines')
        checkSource(lines, 'stream-source-coverage', 'stream-source-conservation', check)
      })
      run('variable-stream', check => {
        const lines = stream([input.width, Math.max(1, input.width / 2), input.width * 1.5], check)
        checkSource(lines, 'variable-source-coverage', 'variable-source-conservation', check)
      })
      run('range-walker', check => {
        const lines: Line[] = []
        const count = api.walkLineRanges(prepared, input.width, range => {
          if (lines.length > normalized.length + 1) throw new Error('Range walker did not terminate')
          lines.push(api.materializeLineRange(prepared, copy(range)))
          range.end.segmentIndex = Number.MAX_SAFE_INTEGER
          range.end.graphemeIndex = Number.MAX_SAFE_INTEGER
        })
        check(count === batch.lineCount && sameLines(lines, batch.lines), 'range-walker', 'Range walking or visitor mutation changes subsequent lines')
      })
      let richLineCount: number | undefined
      if (richApi !== undefined && input.whiteSpace === 'normal' && input.wordBreak === 'normal') {
        run('rich-item-contracts', check => {
          const lines = checkRichItems(input.parts ?? [input.text], input.font, input.letterSpacing, input.width, check, diagnostics.check)
          if (input.nativeItems === true) richLineCount = lines.length
        })
      }

      const { failures, passedContracts } = result()
      return {
        detail: 'full', countedHeight, normalized, lineCount: batch.lineCount, height: batch.height, contracts: failures, passedContracts, diagnostics: diagnostics.result().failures,
        lines: batch.lines.map(line => ({ ...line, sourceStart: offset(line.start), sourceEnd: offset(line.end) })),
        ...(richLineCount === undefined ? {} : { richLineCount }),
      }
    }
  }

  function checkRichItems(
    parts: string[], font: string, letterSpacing: number, width: number,
    check: (condition: boolean, contract: string, detail: string) => void,
    diagnose?: (condition: boolean, contract: string, detail: string) => void,
  ): RichLine[] {
    if (richApi === undefined) throw new Error('Rich-inline API is unavailable')
    const prepared = richApi.prepareRichInline(parts.map(text => ({ text, font, letterSpacing })))
    const lines: RichLine[] = []
    const sourceLength = parts.join('').length
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const itemSources = parts.map(text => {
      const item = api.prepareWithSegments(text, font, { whiteSpace: 'normal', wordBreak: 'normal', letterSpacing })
      return { text: item.segments.join(''), consumed: 0, offsets: sourceOffsets(item.segments, segmenter) }
    })
    let cursor: RichCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }
    for (let i = 0; i <= sourceLength + 1; i++) {
      const before = copy(cursor)
      const range = richApi.layoutNextRichInlineLineRange(prepared, width, cursor)
      check(JSON.stringify(cursor) === JSON.stringify(before), 'rich-cursor-input-immutable', 'Rich stepping mutated its input cursor')
      if (range === null) break
      const line = richApi.materializeRichInlineLineRange(prepared, range)
      for (const fragment of range.fragments) {
        const source = itemSources[fragment.itemIndex]
        if (source === undefined) throw new Error(`Unknown original item ${fragment.itemIndex}`)
        const start = source.offsets[fragment.start.segmentIndex]?.[fragment.start.graphemeIndex]
        const end = source.offsets[fragment.end.segmentIndex]?.[fragment.end.graphemeIndex]
        if (start === undefined || end === undefined) throw new Error('Invalid rich fragment source cursor')
        check(start >= source.consumed && end > start, 'rich-source-coverage', `Item ${fragment.itemIndex}: expected forward, nonoverlapping progress after ${source.consumed}; got ${start}..${end}`)
        check(isSuppressedBoundary(source.text.slice(source.consumed, start), 'normal'), 'rich-source-coverage', `Item ${fragment.itemIndex}: unconsumed source between ${source.consumed} and ${start}`)
        diagnose?.(start === source.consumed && end > start, 'rich-source-conservation', `Item ${fragment.itemIndex}: expected exact source partition after ${source.consumed}; got ${start}..${end}`)
        source.consumed = end
      }
      const copied = richApi.materializeRichInlineLineRange(prepared, copy(range))
      check(JSON.stringify(line) === JSON.stringify(copied), 'rich-range-json-copy', 'Copied rich range changes materialization')
      check(JSON.stringify(line) === JSON.stringify(richApi.materializeRichInlineLineRange(prepared, copy(line))), 'rich-line-rematerialization', 'Materialized rich line loses range information')
      check(JSON.stringify(cursor) !== JSON.stringify(range.end), 'rich-cursor-progress', 'Rich stepping did not advance')
      lines.push(line)
      if (JSON.stringify(cursor) === JSON.stringify(range.end)) throw new Error('Rich streaming stopped before consuming source')
      cursor = copy(range.end)
      if (i === sourceLength + 1) {
        check(false, 'rich-cursor-progress', 'Rich stepping exceeded the number of source units')
        throw new Error('Rich streaming did not terminate')
      }
    }
    check(itemSources.every(source => isSuppressedBoundary(source.text.slice(source.consumed), 'normal')), 'rich-source-coverage', 'Rich fragments omit visible normalized source from an original item')
    diagnose?.(itemSources.every(source => source.consumed === source.text.length), 'rich-source-conservation', 'Rich fragments omit normalized source from an original item')
    const stats = richApi.measureRichInlineStats(prepared, width)
    check(stats.lineCount === lines.length && sameWidth(stats.maxLineWidth, Math.max(0, ...lines.map(line => line.width))), 'rich-stats-agreement', 'Rich stats disagree with streamed lines')
    const walked: RichLine[] = []
    richApi.walkRichInlineLineRanges(prepared, width, range => {
      if (walked.length > sourceLength + 1) throw new Error('Rich range walker did not terminate')
      walked.push(richApi.materializeRichInlineLineRange(prepared, copy(range)))
    })
    check(JSON.stringify(walked) === JSON.stringify(lines), 'rich-range-walker', 'Rich walking disagrees with streamed lines')
    return lines
  }

  function checkRichContracts(input: { font: string; letterSpacing: number }, includeStructure = true): { failures: ContractFailure[]; passedContracts: string[] } {
    const { check, run, result } = collector()
    if (richApi === undefined) return { failures: [{ contract: 'rich-api-available', detail: 'Rich-inline API is unavailable' }], passedContracts: [] }
    check(true, 'rich-api-available', '')
    api.setLocale(undefined)
    const { font, letterSpacing } = input
    run('rich-boundary-space', check => {
      const prepared = richApi.prepareRichInline([{ text: 'x ', font, letterSpacing }, { text: 'y', font, letterSpacing }])
      const range = richApi.layoutNextRichInlineLineRange(prepared, Number.POSITIVE_INFINITY)
      const space = api.layoutNextLineRange(api.prepareWithSegments(' ', font, { whiteSpace: 'pre-wrap', wordBreak: 'normal', letterSpacing }), { segmentIndex: 0, graphemeIndex: 0 }, Number.POSITIVE_INFINITY)
      check(range !== null && range.fragments.length === 2 && space !== null && sameWidth(range.fragments[1]!.gapBefore, space.width), 'rich-boundary-space', 'Collapsed boundary gap differs from the independently measured SPACE advance')
    })
    if (!includeStructure) return result()
    run('rich-source-item-coordinates', check => {
      const items = ['', 'AB', ' ', 'CD', ''].map(text => ({ text, font }))
      const prepared = richApi.prepareRichInline(items)
      const width = Math.max(
        api.measureNaturalWidth(api.prepareWithSegments('AB', font)),
        api.measureNaturalWidth(api.prepareWithSegments('CD', font)),
      ) + 0.1
      const first = richApi.layoutNextRichInlineLineRange(prepared, width)
      check(first !== null && first.fragments[0]?.itemIndex === 1 && first.end.itemIndex === 3, 'rich-source-item-coordinates', 'Cursor after the first original item must refer to original item 3')
      if (first !== null) {
        const second = richApi.layoutNextRichInlineLineRange(prepared, width, copy(first.end))
        check(second !== null && second.fragments[0]?.itemIndex === 3 && second.end.itemIndex === items.length, 'rich-source-item-coordinates', 'Continuation must consume original item 3 and end at the original item count')
      }
    })
    run('rich-visitor-isolation', check => {
      const parts = ['A', 'B', 'C']
      const width = Math.max(...parts.map(text => api.measureNaturalWidth(api.prepareWithSegments(text, font)))) + 0.1
      const expected = checkRichItems(parts, font, 0, width, check)
      const prepared = richApi.prepareRichInline(parts.map(text => ({ text, font })))
      const walked: RichLine[] = []
      richApi.walkRichInlineLineRanges(prepared, width, range => {
        if (walked.length > 3) throw new Error('Rich visitor mutation prevents termination')
        walked.push(richApi.materializeRichInlineLineRange(prepared, copy(range)))
        range.end.itemIndex = Number.MAX_SAFE_INTEGER
        range.fragments.length = 0
      })
      check(JSON.stringify(walked) === JSON.stringify(expected), 'rich-visitor-isolation', 'Mutating a visited rich line changes the pending continuation')
    })
    run('rich-atomic-item', check => {
      const text = 'ABCD'
      const occupiedWidth = api.measureNaturalWidth(api.prepareWithSegments(text, font)) + 18
      const pill: RichItem = { text, font, break: 'never', extraWidth: 18 }
      for (const items of [[pill], [{ text: 'A', font }, pill, { text: 'B', font }]]) {
        const prepared = richApi.prepareRichInline(items)
        const width = items.length === 1 ? 1 : occupiedWidth
        const lines: RichLine[] = []
        richApi.walkRichInlineLineRanges(prepared, width, range => {
          if (lines.length >= items.length) throw new Error('An atomic pill split or the rich walker failed to terminate')
          lines.push(richApi.materializeRichInlineLineRange(prepared, copy(range)))
        })
        check(lines.length === items.length, 'rich-atomic-item', 'The pill must occupy one line and move intact after existing content')
        for (let i = 0; i < lines.length; i++) {
          const fragments = lines[i]!.fragments
          check(fragments.length === 1 && fragments[0]!.itemIndex === i && fragments[0]!.text === items[i]!.text, 'rich-atomic-item', 'Atomic flow split, lost, or reassigned an original item')
        }
        const pillLine = lines[items.length === 1 ? 0 : 1]
        check(pillLine !== undefined && sameWidth(pillLine.width, occupiedWidth) && sameWidth(pillLine.fragments[0]!.occupiedWidth, occupiedWidth), 'rich-atomic-width', 'Atomic text must include extraWidth exactly once')
        const stats = richApi.measureRichInlineStats(prepared, width)
        check(stats.lineCount === lines.length && sameWidth(stats.maxLineWidth, occupiedWidth), 'rich-atomic-stats', 'Atomic stats disagree with the materialized lines')
      }
    })
    return result()
  }

  return { name, prepare, predict: input => prepare(input)(input), checkRichContracts }
}
