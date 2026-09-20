// The tally of tools/positions-study.ts and tools/positions-probe.ts: where the Blink port's repeated Canvas questions
// happen. It runs under bun and in a browser page, and changes nothing in rebuild/src.
//
// A question is a Canvas context and a string. A range is what engines/blink/shape.ts measure16 was asked for: the group,
// [from, to), the shaping call's range and the no-ligature flag. One range always builds the same string for the same
// context, so a range asked again could be answered from a table found by offsets; a question asked again under another
// range (the letter `e` alone, at another offset) only from a store found by its string.
//
// The library reports through `globalThis.positionsStudy`, which the tools' source transform calls (instrument, below):
// measure16 names its range before it asks, and the engine's prepare, fillLine and linePieces say that they start. The
// driver says where a paragraph starts and which pass a layout belongs to.

// 'scratch': the font checks, prepare and the first layout. 'new-width': a layout of the kept paragraph at a width it
// hasn't met. 'met-width': the same widths once more.
export type Pass = 'scratch' | 'new-width' | 'met-width'
type Phase = 'checks' | 'prepare' | 'fill' | 'pieces'

// Where the same question, or the same range, was asked before in this prepared paragraph. 'same line': in the same
// fillLine call or the linePieces call of its line, which a structure with a fill's lifetime could answer. The next three
// need the prepared paragraph's lifetime. A first question is either new to the page or was asked by another paragraph.
const EARLIER = ['first', 'same prepare', 'same line', 'from prepare', 'earlier line', 'earlier layout'] as const
type Earlier = typeof EARLIER[number]

type Seen = { prepare: boolean; line: number; layout: number }
type Tally = { asks: number; units: number; question: number[]; range: number[]; otherParagraph: number }

// The functions of engines/blink whose frames class a call. A bundle that renames one (a second function of the same
// name elsewhere) would send its calls to 'other', which the reports show.
const READERS = ['measureGroups', 'itemShapeResult', 'snappedWidth', 'isStartSafeToBreak', 'positionForOffset', 'offsetForPosition', 'nextSafeToBreak',
  'previousSafeToBreak', 'reshape', 'reshapeHanKerningEnd', 'makeView', 'piecesOf', 'clampedStartLimit', 'shapeHyphen', 'tabShapeResult']

const stackCache = new Map<string, string[]>()
function framesOf(stack: string): string[] {
  let names = stackCache.get(stack)
  if (names !== undefined) return names
  names = []
  const lines = stack.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const match = /^\s*at (?:async )?(?:new )?([^\s(]+) \(/.exec(lines[i]!)
    if (match === null) continue
    const name = match[1]!.slice(match[1]!.lastIndexOf('.') + 1)
    if (!names.includes(name)) names.push(name)
  }
  stackCache.set(stack, names)
  return names
}

// What is asked, by the functions the call was made under (engines/blink/shape.ts). The first rule that matches wins.
function siteOf(phase: Phase, under: readonly string[]): string {
  if (phase === 'checks') return 'font checks'
  if (under.includes('canvasSplitsWords') || under.includes('measureHanKerningFontData') || under.includes('trim16')) return 'probe strings of a style'
  if (under.includes('shapeHyphen') || under.includes('tabShapeResult')) return 'hyphen or tab space'
  const pair = under.includes('pairAdjust16')
  const wide = under.includes('windowAdjust16') || under.includes('adjust16')
  if (under.includes('passesSafeTest')) return pair ? 'cut search: pair window' : 'cut search: wide window'
  if (under.includes('addPieces')) return 'cut search: total of a group or a piece'
  if (under.includes('safeToBreak')) return pair ? 'safe test: pair window' : 'safe test: wide window'
  if (under.includes('groupPrefix16') || under.includes('callPrefix16') || under.includes('measureGroups')) {
    return pair ? 'position: pair window' : wide ? 'position: wide window' : 'position: prefix from the last cut'
  }
  if (pair || wide) return pair ? 'gap or limit: pair window' : 'gap or limit: wide window'
  if (under.includes('reshape') || under.includes('reshapeHanKerningEnd')) return 'line-edge reshape'
  return 'other'
}

// Who asked: the outermost of the readers on the stack.
function readerOf(under: readonly string[]): string {
  for (let i = under.length - 1; i >= 0; i--) if (READERS.includes(under[i]!)) return under[i]!
  return 'other'
}

export type Study = {
  hooks: { range(g: number, from: number, to: number, callStart: number, callEnd: number, noLigatures: boolean): void; enter(name: 'prepare' | 'fillLine' | 'linePieces'): void }
  paragraph(kind: string): void
  pass(pass: Pass): void
  call(context: object, settings: string, text: string, stack: string): void
  report(): unknown
}

export function makeStudy(): Study {
  let kind = ''
  let pass: Pass = 'scratch'
  let phase: Phase = 'checks'
  let layout = 0
  let line = 0
  let pendingRange: string | null = null
  let questions = new Map<string, Seen>()
  let ranges = new Map<string, Seen>()
  let prepareDistinct = 0
  let fillDistinct = new Set<string>()
  const contextIds = new WeakMap<object, number>()
  let nextContext = 0
  const page = new Set<string>()
  const tallies = new Map<string, Tally>()
  const paragraphs = new Map<string, number>()
  const layouts = new Map<string, number>()
  const distinct = { prepare: 0, fill: 0 }

  const tallyOf = (key: string): Tally => {
    let tally = tallies.get(key)
    if (tally === undefined) {
      tally = { asks: 0, units: 0, question: EARLIER.map(() => 0), range: EARLIER.map(() => 0), otherParagraph: 0 }
      tallies.set(key, tally)
    }
    return tally
  }
  const bump = (map: Map<string, number>, key: string): void => { map.set(key, (map.get(key) ?? 0) + 1) }
  const earlierOf = (seen: Seen | undefined): Earlier => {
    if (seen === undefined) return 'first'
    if (phase === 'checks' || phase === 'prepare') return 'same prepare'
    if (seen.line === line) return 'same line'
    if (seen.prepare) return 'from prepare'
    return seen.layout === layout ? 'earlier line' : 'earlier layout'
  }
  const note = (map: Map<string, Seen>, key: string, seen: Seen | undefined): void => {
    const inPrepare = phase === 'checks' || phase === 'prepare'
    if (seen === undefined) map.set(key, { prepare: inPrepare, line: inPrepare ? -1 : line, layout })
    else {
      if (inPrepare) seen.prepare = true
      else { seen.line = line; seen.layout = layout }
    }
  }
  const closeParagraph = (): void => {
    distinct.prepare += prepareDistinct
    distinct.fill += fillDistinct.size
  }

  return {
    hooks: {
      range(g, from, to, callStart, callEnd, noLigatures) { pendingRange = `${g},${from},${to},${callStart},${callEnd},${noLigatures ? 1 : 0}` },
      enter(name) {
        pendingRange = null
        switch (name) {
          case 'prepare': phase = 'prepare'; break
          case 'fillLine': phase = 'fill'; line++; break
          case 'linePieces': phase = 'pieces'; break
        }
      },
    },
    paragraph(k) {
      if (kind !== '') closeParagraph()
      kind = k
      pass = 'scratch'
      phase = 'checks'
      layout = 0
      line = 0
      pendingRange = null
      questions = new Map()
      ranges = new Map()
      prepareDistinct = 0
      fillDistinct = new Set()
      bump(paragraphs, 'all')
      bump(paragraphs, k)
      bump(layouts, 'scratch')
    },
    pass(next) {
      pass = next
      layout++
      bump(layouts, next)
    },
    call(context, settings, text, stack) {
      let id = contextIds.get(context)
      if (id === undefined) {
        id = nextContext++
        contextIds.set(context, id)
      }
      const under = framesOf(stack)
      const measured = under.includes('measure16')
      const site = siteOf(phase, under)
      const question = `${id}\n${text}`
      const seenQuestion = questions.get(question)
      const range = measured ? pendingRange : null
      const seenRange = range === null ? undefined : ranges.get(range)
      const q = EARLIER.indexOf(earlierOf(seenQuestion))
      // A call that isn't measure16's has no range: a table by offset answers it as often as its string repeats.
      const r = range === null ? q : EARLIER.indexOf(earlierOf(seenRange))
      const pageKey = `${settings}\n${text}`
      const otherParagraph = seenQuestion === undefined && page.has(pageKey)
      page.add(pageKey)
      if (pass === 'scratch') {
        if (seenQuestion === undefined && (phase === 'checks' || phase === 'prepare')) prepareDistinct++
        if (phase === 'fill' || phase === 'pieces') fillDistinct.add(question)
      }
      const keys = [`${pass}|all|all`, `${pass}|site|${phase === 'pieces' ? 'fill' : phase}: ${site}`, `${pass}|reader|${readerOf(under)}`, `${pass}|kind|${kind}`, `${pass}|phase|${phase}`]
      for (let i = 0; i < keys.length; i++) {
        const tally = tallyOf(keys[i]!)
        tally.asks++
        tally.units += text.length
        tally.question[q]!++
        tally.range[r]!++
        if (otherParagraph) tally.otherParagraph++
      }
      note(questions, question, seenQuestion)
      if (range !== null) note(ranges, range, seenRange)
      pendingRange = null
    },
    report() {
      if (kind !== '') closeParagraph()
      kind = ''
      const rows: unknown[] = []
      tallies.forEach((tally, key) => {
        const [passName, dimension, name] = key.split('|') as [Pass, string, string]
        // Per message for the from-scratch pass (or per message of its kind), per layout for the others.
        const over = passName === 'scratch' ? paragraphs.get(dimension === 'kind' ? name : 'all')! : dimension === 'kind' ? layouts.get(passName)! * paragraphs.get(name)! / paragraphs.get('all')! : layouts.get(passName)!
        const per = (n: number): number => Math.round(n / over * 100) / 100
        const question: Record<string, number> = {}
        const range: Record<string, number> = {}
        let rangeRepeats = 0
        let questionRepeats = 0
        for (let i = 0; i < EARLIER.length; i++) {
          question[EARLIER[i]!] = per(tally.question[i]!)
          range[EARLIER[i]!] = per(tally.range[i]!)
          if (i > 0) { rangeRepeats += tally.range[i]!; questionRepeats += tally.question[i]! }
        }
        rows.push({
          pass: passName, dimension, name, asks: per(tally.asks), meanUnits: Math.round(tally.units / tally.asks * 10) / 10,
          // What would still be asked with tables by offset of a fill's lifetime (a), of the prepared paragraph's (b), and
          // with every question of the paragraph found by its string.
          afterFillTables: per(tally.asks - tally.range[EARLIER.indexOf('same line')]!), afterParagraphTables: per(tally.asks - rangeRepeats),
          distinctQuestions: per(tally.asks - questionRepeats), firstButAskedByAnotherParagraph: per(tally.otherParagraph),
          questionAskedBefore: question, rangeAskedBefore: range,
        })
      })
      const counts: Record<string, number> = {}
      paragraphs.forEach((n, key) => { counts[key] = n })
      return {
        paragraphs: counts, layouts: { 'new-width': layouts.get('new-width') ?? 0, 'met-width': layouts.get('met-width') ?? 0 },
        distinctPerParagraph: { atPrepare: distinct.prepare / paragraphs.get('all')!, inTheFirstLayout: distinct.fill / paragraphs.get('all')! },
        rows,
      }
    },
  }
}

// The source transform: the two files of engines/blink that report to the study, with the statement each one gains. It
// adds no line, so stacks keep their line numbers, and it fails when an anchor is gone.
const HOOK = 'globalThis.positionsStudy'
const ANCHORS: Array<{ file: string; anchor: RegExp; insert: (found: string) => string }> = [
  { file: 'shape.ts', anchor: /\n  const w = cs\.s\.length === 0 \? 0 : raw16Of\(/, insert: found => `\n  ${HOOK}?.range(g, from, to, callStart, callEnd, noLigatures);${found.slice(1)}` },
  { file: 'index.ts', anchor: /\nexport function prepare\([^\n]*\{\n/, insert: found => `${found.slice(0, -1)} ${HOOK}?.enter('prepare');\n` },
  { file: 'index.ts', anchor: /\nexport function fillLine\([^\n]*\{\n/, insert: found => `${found.slice(0, -1)} ${HOOK}?.enter('fillLine');\n` },
  { file: 'index.ts', anchor: /\nexport function linePieces\([^\n]*\{\n/, insert: found => `${found.slice(0, -1)} ${HOOK}?.enter('linePieces');\n` },
]
export const INSTRUMENTED = /\/src\/engines\/blink\/(shape|index)\.ts$/

export function instrument(path: string, source: string): string {
  let out = source
  for (let i = 0; i < ANCHORS.length; i++) {
    const a = ANCHORS[i]!
    if (!path.endsWith(`/engines/blink/${a.file}`)) continue
    const match = a.anchor.exec(out)
    if (match === null) throw new Error(`positions study: ${path} no longer has the statement ${a.anchor}`)
    out = out.slice(0, match.index) + a.insert(match[0]) + out.slice(match.index + match[0].length)
  }
  return out
}
