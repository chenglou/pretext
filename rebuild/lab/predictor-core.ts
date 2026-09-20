// The prediction adapter: the one lab file that imports library logic (tests/independence.test.ts). predictor.ts and the
// predictors under baselines/ make their predict(), paint() and limits() from it, each with its own rule for the font
// facts a case's fonts get, so neither copies the other and the facts-free bundle never holds the font table.
//
// predict() lays the paragraph out with rebuild/src for the running browser's engine, one line slot at a time, and returns
// the library's input and the layout a row keeps (types.ts ParagraphLayout); the page runs the observation port over them.
// paint() paints that layout's lines, and limits() names, per painted line, what painting the line alone can't reproduce
// (src/paint.ts paintLines and painterLimits): the library's painter over what linePieces gave of each line, with the
// painting rules of the engine that laid it out, which predict() pairs where it knows the engine (types.ts
// LayoutPrediction.painter). The row's format is the lab's and frozen, key order included: the adapter makes it from
// what the library's function set returns (src/index.ts), and writes what the library doesn't carry: a line's slot as its
// two insets, and the Canvas work counted below.
//
// A case describes the page, so its fonts carry no font facts; `factsFor` gives them (DESIGN.md §1.2). Facts it can't give
// stay unknown and report their gaps. The width is the case paragraph's, which every slot gets. The build comes from the
// driver, which reads it from the app bundle. The browser process's languages come from the driver too (types.ts
// ProcessLanguages): it launches Chrome with them, and reads the OS settings Safari, webkit-host and Firefox's layout take
// them from, as research tooling may (DESIGN.md §8.3, stage 0). A value the driver couldn't derive stays null and reports
// ui-language.
import * as blink from '../src/engines/blink/index.ts'
import { blinkPaintRules } from '../src/engines/blink/paint-rules.ts'
import * as gecko from '../src/engines/gecko/index.ts'
import { geckoPaintRules } from '../src/engines/gecko/paint-rules.ts'
import * as webkit from '../src/engines/webkit/index.ts'
import { webkitPaintRules } from '../src/engines/webkit/paint-rules.ts'
import type { BlinkLineGeometry, BlinkLineStart } from '../src/engines/blink/geometry.ts'
import type { GeckoLineGeometry, GeckoLineStart } from '../src/engines/gecko/geometry.ts'
import type { WebKitLineGeometry, WebKitLineStart } from '../src/engines/webkit/geometry.ts'
import { detectEnvironment, type EngineName, type Environment, type GivenFacts } from '../src/env.ts'
import { fillLine, firstLine, linePieces, paragraphGaps, prepare, type Context } from '../src/index.ts'
import {
  NO_BOX_EDGE, type FillResultOf, type FontDecl, type FontFacts, type InlineNode, type LineInspectionOf, type LinePieces, type LineSlot as LayoutSlot,
  type Paragraph as LayoutParagraph, type TextStyle,
} from '../src/model.ts'
import { paintLines, painterLimits, type PaintLine, type PaintRules } from '../src/paint.ts'
import type {
  BelowFloats, BrowserKind, Case, FontDecl as CaseFont, InlineNode as CaseInlineNode, LayoutPrediction, LineOf, LineSlot, LinesPrediction, PainterLimits,
  PredictionLine, ProcessLanguages,
} from './types.ts'

// The font facts a predictor declares for one CSS font of a case, for the engine that lays it out, given the fixture web
// fonts the case loads.
export type FactsFor = (font: CaseFont, engine: EngineName, fixtures: readonly string[]) => FontFacts

export type PredictEnv = { browser: BrowserKind; build: string; languages: ProcessLanguages['given'] | null }
export type Predictor = {
  predict: (c: Case, env: PredictEnv) => LayoutPrediction | { error: string }
  paint: (c: Case, prediction: LayoutPrediction, host: HTMLElement) => HTMLElement[] | null
  limits: (prediction: LayoutPrediction) => PainterLimits
}

function engineOf(browser: BrowserKind): EngineName {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'safari': return 'webkit'
    case 'webkit-host': return 'webkit'
    case 'firefox': return 'gecko'
  }
}

// The lab's pages send no Content-Language, and its sessions run at page zoom 1.
function givenFacts(engine: EngineName, build: string, languages: ProcessLanguages['given'] | null): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build, contentLanguage: null, uiLanguage: languages?.engine === 'blink' ? languages.uiLanguage : null }
    case 'webkit': return {
      engine, build, contentLanguage: null, pageZoom: 1,
      preferredLanguages: languages?.engine === 'webkit' ? languages.preferredLanguages : null,
      icuDefaultLocale: languages?.engine === 'webkit' ? languages.icuDefaultLocale : null,
    }
    case 'gecko': return { engine, build, contentLanguage: null, regionalPrefsLocale: languages?.engine === 'gecko' ? languages.regionalPrefsLocale : null }
  }
}

function environment(browser: BrowserKind, build: string, languages: ProcessLanguages['given'] | null): Environment | { error: string } {
  const engine = engineOf(browser)
  if (languages !== null && languages.engine !== engine) return { error: `The driver gave ${languages.engine} process languages for ${browser}` }
  const detected = detectEnvironment(givenFacts(engine, build, languages))
  if (detected.kind === 'unsupported') return { error: `Unsupported browser: ${detected.reason} (${detected.userAgent})` }
  return detected.env
}

function withFacts(font: CaseFont, engine: EngineName, fixtures: readonly string[], factsFor: FactsFor): FontDecl {
  return { ...font, facts: factsFor(font, engine, fixtures) }
}

// A flat case paragraph as the tree the library takes (DESIGN.md §1.1, "Flat paragraphs"): a bare run is a text leaf, and
// a span run a span with the block's wrapping styles, no box edges and its text as its one leaf. A span run with empty
// text keeps an empty leaf, which makes no DOM node, so leaf indices stay run indices.
// A case's tree with the font facts the predictor gives on every span's font.
function treeWithFacts(nodes: readonly CaseInlineNode[], engine: EngineName, fixtures: readonly string[], factsFor: FactsFor): InlineNode[] {
  const out: InlineNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    switch (node.kind) {
      case 'span': out.push({ ...node, font: withFacts(node.font, engine, fixtures, factsFor), children: treeWithFacts(node.children, engine, fixtures, factsFor) }); break
      case 'text':
      case 'atomic':
      case 'br':
      case 'wbr': out.push(node); break
    }
  }
  return out
}

function layoutInput(c: Case, engine: EngineName, factsFor: FactsFor): LayoutParagraph {
  const paragraph = c.paragraph
  const fixtures = c.fontFixtures ?? []
  const style = (font: CaseFont, letterSpacing: number, wordSpacing: number): TextStyle => ({
    font: withFacts(font, engine, fixtures, factsFor), letterSpacing, wordSpacing, whiteSpace: paragraph.whiteSpace, wordBreak: paragraph.wordBreak,
    overflowWrap: paragraph.overflowWrap, lineBreak: paragraph.lineBreak, tabSize: paragraph.tabSize,
  })
  // A case with inline structure carries the tree itself (lab/types.ts InlineStructure).
  if (c.inline !== undefined) {
    return {
      ...style(paragraph.font, paragraph.letterSpacing, paragraph.wordSpacing), content: treeWithFacts(c.inline.content, engine, fixtures, factsFor), lang: paragraph.lang,
      direction: paragraph.direction, lineHeight: paragraph.lineHeight, textIndent: c.inline.textIndent, textAlign: c.inline.textAlign,
    }
  }
  const content: InlineNode[] = []
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    if (run.node === 'text') {
      content.push({ kind: 'text', text: run.text })
      continue
    }
    content.push({
      ...style(run.font, run.letterSpacing, run.wordSpacing), kind: 'span', lang: run.lang, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE,
      verticalAlign: 'baseline', children: [{ kind: 'text', text: run.text }],
    })
  }
  return {
    ...style(paragraph.font, paragraph.letterSpacing, paragraph.wordSpacing), content, lang: paragraph.lang, direction: paragraph.direction,
    lineHeight: paragraph.lineHeight, textIndent: 0, textAlign: 'start',
  }
}

// The lab's own count of what a layout asks of Canvas, which the row keeps (types.ts EnginePrediction.measure): the
// contexts made and the measureText calls, counted on the page's Canvas classes, so nothing in the library counts. The
// arguments pass through untouched, so Canvas sees the library's own string objects (src/measure/canvas.ts). The page's
// OffscreenCanvas is wrapped once, and a context's class when the first context of it is made; a replay installs new
// classes for every case (measurements.ts).
const canvasWork = { contexts: 0, calls: 0 }
const counted = new WeakSet<object>()

function countCanvasWork(): void {
  const canvas = OffscreenCanvas.prototype as unknown as { getContext: (this: unknown, ...rest: unknown[]) => object | null }
  if (counted.has(canvas)) return
  counted.add(canvas)
  const getContext = canvas.getContext
  canvas.getContext = function (...rest) {
    const context = getContext.apply(this, rest)
    if (context === null) return null
    canvasWork.contexts++
    const proto = Object.getPrototypeOf(context) as { measureText: (this: unknown, text: string) => unknown }
    if (!counted.has(proto)) {
      counted.add(proto)
      const measureText = proto.measureText
      proto.measureText = function (text) {
        canvasWork.calls++
        return measureText.call(this, text)
      }
    }
    return context
  }
}

const FULL_WIDTH: LineSlot = { left: 0, right: 0 }

// One engine's function set over a prepared paragraph, with its own types, so a row's lines keep the engine's, and its
// painting rules, which read the facts its pieces carry.
type Engine<Start, Line, Refused, Geometry, Facts> = {
  first: Start | null
  fill: (start: Start, slot: LayoutSlot) => FillResultOf<Start, Line, Refused>
  inspect: (line: Line | Refused) => LineInspectionOf<Geometry>
  pieces: (line: Line) => LinePieces<Facts>
  rules: PaintRules<Facts>
}

// Fills every line at `width`. The k-th line box goes in insets[k], and line boxes past the list at the full width, which
// is what a block with floats of one line height stacked at its start gives each line (DESIGN.md §2.9). A slot the engine
// refuses because the line moves below its floats takes no line: the next slot starts where the engine says, and the
// layout records the refusal. A line without a line box takes no block size, so the next line uses the same slot. Per line
// the calls are fillLine, inspectLine, then linePieces, the order in which the engines have asked Canvas since the rows
// were first recorded; a refused slot is inspected alone. `painted` is every line as the library's painter takes it: the
// pieces as linePieces gave them, the slot the line was filled in, width included, and whether it has a line box.
function fillLines<Start, Line, Refused, Geometry, Facts>(engine: Engine<Start, Line, Refused, Geometry, Facts>, width: number, insets: readonly LineSlot[]): { lines: LineOf<Start, Geometry>[]; belowFloats: BelowFloats[]; painted: PaintLine<Facts>[] } {
  const lines: LineOf<Start, Geometry>[] = []
  const belowFloats: BelowFloats[] = []
  const painted: PaintLine<Facts>[] = []
  let row = 0
  for (let start = engine.first; start !== null;) {
    const slot = row < insets.length ? insets[row]! : FULL_WIDTH
    const filledIn: LayoutSlot = { width, left: slot.left, right: slot.right }
    const filled = engine.fill(start, filledIn)
    switch (filled.kind) {
      case 'below-floats':
        if (row >= insets.length) throw new Error(`the engine moved a line below floats in slot row ${row}, which has none`)
        belowFloats.push({ row, gaps: engine.inspect(filled.line).gaps })
        row++
        break
      case 'line': {
        const { geometry, gaps } = engine.inspect(filled.line)
        if (geometry === null) throw new Error('the engine gave a filled line no geometry')
        const pieces = engine.pieces(filled.line)
        lines.push({
          start: filled.start, end: filled.end, fragments: pieces.fragments, hasLineBox: filled.hasLineBox, joinsNextLine: pieces.joinsNextLine, slot,
          indented: pieces.indented, align: pieces.align, geometry, gaps, next: filled.next,
        })
        painted.push({ pieces, slot: filledIn, hasLineBox: filled.hasLineBox })
        if (filled.hasLineBox) row++
        break
      }
    }
    start = filled.next
  }
  return { lines, belowFloats, painted }
}

// The layout a row keeps, from an inspected paragraph, and the painter of its lines (types.ts LayoutPrediction.painter):
// the library's painter over the filled lines with the engine's painting rules, which are paired here, where the engine's
// types are known. `otherWidthsFirst` fills the paragraph at those widths before, with the same calls, and keeps nothing
// of them: what an application does that lays one prepared paragraph out at several widths, which Chrome's per-canvas
// cache of shaped words could show (specs/blink-canvas.md §1.7). `contexts` is the document's list where the predictor
// keeps one (makePredictor); the usual predictors hand prepare none, so every case makes its own contexts, and a case's
// record stays what one paragraph asks (research/PROFILING-START.md, "Records are per case").
function layoutParagraph(paragraph: LayoutParagraph, env: Environment, width: number, insets: readonly LineSlot[], otherWidthsFirst: readonly number[], contexts: Context[] | undefined): Pick<LayoutPrediction, 'layout' | 'painter'> {
  countCanvasWork()
  const before = { ...canvasWork }
  const prepared = prepare(paragraph, env, true, contexts)
  const fill = <Start, Line, Refused, Geometry, Facts>(engine: Engine<Start, Line, Refused, Geometry, Facts>) => {
    for (let i = 0; i < otherWidthsFirst.length; i++) fillLines(engine, otherWidthsFirst[i]!, insets)
    const { lines, belowFloats, painted } = fillLines(engine, width, insets)
    const measure = { contexts: canvasWork.contexts - before.contexts, calls: canvasWork.calls - before.calls, memoHits: 0 }
    const refusedRows = belowFloats.map(refused => refused.row)
    const painter: LayoutPrediction['painter'] = {
      paint: doc => paintLines(paragraph, painted, refusedRows, engine.rules, doc),
      limits: () => painterLimits(paragraph, painted, engine.rules),
    }
    return { lines, belowFloats, measure, painter }
  }
  switch (prepared.engine) {
    case 'blink': {
      const p = prepared.state
      const filled = fill<BlinkLineStart, blink.BlinkFilledLine, blink.BlinkRefusedSlot, BlinkLineGeometry, blink.BlinkPaintFacts>({
        first: blink.firstLine(p), fill: (start, slot) => blink.fillLine(p, start, slot), inspect: line => blink.inspectLine(p, line), pieces: line => blink.linePieces(p, line),
        rules: blinkPaintRules,
      })
      return { layout: { engine: 'blink', env: p.env, lines: filled.lines, belowFloats: filled.belowFloats, measure: filled.measure, gaps: paragraphGaps(prepared) }, painter: filled.painter }
    }
    case 'webkit': {
      const p = prepared.state
      const filled = fill<WebKitLineStart, webkit.WebKitFilledLine, webkit.WebKitRefusedSlot, WebKitLineGeometry, webkit.WebKitPaintFacts>({
        first: webkit.firstLine(p), fill: (start, slot) => webkit.fillLine(p, start, slot), inspect: line => webkit.inspectLine(p, line), pieces: line => webkit.linePieces(p, line),
        rules: webkitPaintRules,
      })
      return { layout: { engine: 'webkit', env: p.env, lines: filled.lines, belowFloats: filled.belowFloats, measure: filled.measure, gaps: paragraphGaps(prepared) }, painter: filled.painter }
    }
    case 'gecko': {
      const p = prepared.state
      const filled = fill<GeckoLineStart, gecko.GeckoFilledLine, gecko.GeckoRefusedSlot, GeckoLineGeometry, gecko.GeckoPaintFacts>({
        first: gecko.firstLine(p), fill: (start, slot) => gecko.fillLine(p, start, slot), inspect: line => gecko.inspectLine(p, line), pieces: line => gecko.linePieces(p, line),
        rules: geckoPaintRules,
      })
      return { layout: { engine: 'gecko', env: p.env, lines: filled.lines, belowFloats: filled.belowFloats, measure: filled.measure, gaps: paragraphGaps(prepared) }, painter: filled.painter }
    }
  }
}

// The line ranges of a plain paragraph: the lines with a line box, which are the lines a LinesPrediction lists (types.ts).
// Nothing is inspected, so this is the path an application runs, with the Canvas questions of that path alone.
// `otherWidthsFirst` fills the paragraph at those widths before, with the same calls, and keeps nothing of them, as
// layoutParagraph's does: a plain paragraph keeps what its lines measured (Blink's groups, by offset), so what another
// width measured answers for this one.
function plainLines(paragraph: LayoutParagraph, env: Environment, width: number, insets: readonly LineSlot[], otherWidthsFirst: readonly number[], contexts: Context[] | undefined): LinesPrediction {
  countCanvasWork()
  const callsBefore = canvasWork.calls
  const prepared = prepare(paragraph, env, false, contexts)
  const widths = [...otherWidthsFirst, width]
  let lines: PredictionLine[] = []
  for (let w = 0; w < widths.length; w++) {
    lines = []
    let row = 0
    for (let start = firstLine(prepared); start !== null;) {
      const slot = row < insets.length ? insets[row]! : FULL_WIDTH
      const filled = fillLine(prepared, start, { width: widths[w]!, left: slot.left, right: slot.right })
      switch (filled.kind) {
        case 'below-floats':
          row++
          break
        case 'line':
          // Read as a painting application reads them, though only the range is kept.
          linePieces(prepared, filled.line)
          if (filled.hasLineBox) {
            lines.push({ start: filled.start, end: filled.end })
            row++
          }
          break
      }
      start = filled.next
    }
  }
  return { lines, measureLog: canvasWork.calls - callsBefore }
}

// `otherWidthFactors`: see layoutParagraph's `otherWidthsFirst`; the widths are these factors of the case's.
// `pageContexts`: one list of Canvas contexts for every case the document lays out, as an application that keeps one per
// page holds it (src/index.ts prepare): the document's cases share their contexts, and every case asks its font checks
// of Canvas again. The page loads a context's fixture fonts before its first case (README.md, "Page protocol"), so the
// list's first context is made after them.
export function makePredictor(factsFor: FactsFor, otherWidthFactors: readonly number[] = [], pageContexts: boolean = false): Predictor {
  const contexts: Context[] | undefined = pageContexts ? [] : undefined
  return {
    predict(c, env) {
      const e = environment(env.browser, env.build, env.languages)
      if ('error' in e) return e
      if (c.pageLang !== e.pageLang) return { error: `Case ${c.id} needs <html lang="${c.pageLang}">; page has "${e.pageLang}"` }
      const paragraph = layoutInput(c, e.engine, factsFor)
      const width = c.paragraph.width
      return { paragraph, width, ...layoutParagraph(paragraph, e, width, c.inline?.lineSlots ?? [], otherWidthFactors.map(factor => width * factor), contexts) }
    },
    // One element per line with a line box.
    paint(_c, prediction, host) {
      return prediction.painter.paint(host.ownerDocument)
    },
    // One list per line with a line box, in paint()'s order.
    limits(prediction) {
      return prediction.painter.limits()
    },
  }
}

// The predictor of line ranges from a plain paragraph (plainLines). It paints nothing: a row of it holds the native
// observation and the ranges, which compare-rows.ts --prediction=line-ranges holds against a run of makePredictor's.
type PlainPredictor = {
  predict: (c: Case, env: PredictEnv) => LinesPrediction | { error: string }
  paint: (c: Case, prediction: LinesPrediction, host: HTMLElement) => null
}

// `otherWidthFactors`: see plainLines' `otherWidthsFirst`; the widths are these factors of the case's.
export function makePlainPredictor(factsFor: FactsFor, otherWidthFactors: readonly number[] = [], pageContexts: boolean = false): PlainPredictor {
  const contexts: Context[] | undefined = pageContexts ? [] : undefined
  return {
    predict(c, env) {
      const e = environment(env.browser, env.build, env.languages)
      if ('error' in e) return e
      if (c.pageLang !== e.pageLang) return { error: `Case ${c.id} needs <html lang="${c.pageLang}">; page has "${e.pageLang}"` }
      const width = c.paragraph.width
      return plainLines(layoutInput(c, e.engine, factsFor), e, width, c.inline?.lineSlots ?? [], otherWidthFactors.map(factor => width * factor), contexts)
    },
    paint: () => null,
  }
}
