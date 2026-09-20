// Public entry: lay out a styled paragraph the way the environment's engine does, one line slot at a time. The engine
// difference is the switches of this file; everything engine-specific lives under engines/<engine>/, and each engine's
// index.ts gives the same function set (DESIGN.md §2.9).
import { blinkFontChecks } from './engines/blink/checks.js'
import type { BlinkLineGeometry, BlinkLineStart } from './engines/blink/geometry.js'
import * as blink from './engines/blink/index.js'
import type { BlinkPrepared } from './engines/blink/types.js'
import { geckoFontChecks } from './engines/gecko/checks.js'
import type { GeckoLineGeometry, GeckoLineStart } from './engines/gecko/geometry.js'
import * as gecko from './engines/gecko/index.js'
import type { GeckoPrepared } from './engines/gecko/types.js'
import { webkitFontChecks } from './engines/webkit/checks.js'
import type { WebKitLineGeometry, WebKitLineStart } from './engines/webkit/geometry.js'
import * as webkit from './engines/webkit/index.js'
import type { WebKitPrepared } from './engines/webkit/types.js'
import { PINNED_BUILDS, SOURCE_IDENTICAL_BUILDS, type Environment } from './env.js'
import type { Context } from './measure/canvas.js'
import { withLearnedFontFacts } from './measure/font-checks.js'
import type { Gap, LineInspectionOf, LinePieces, LineSlot, Paragraph } from './model.js'

export type {
  BlinkEnvironment, BlinkProcessLanguages, DetectedEngine, DetectedEnvironment, EngineName, Environment, GeckoEnvironment,
  GeckoProcessLanguages, GivenFacts, ProcessLanguages, WebKitEnvironment, WebKitProcessLanguages,
} from './env.js'
export { PINNED_BUILDS, detectEngine, detectEnvironment } from './env.js'
export type {
  AtomicInline, BoxEdge, CssFont, Direction, FillResultOf, FontDecl, FontFacts, Fragment, Gap, GapName, InlineElement, InlineElementOf, InlineNode,
  InlineNodeOf, LineBreak, LineBreakElement, LineInspectionOf, LinePieces, LineSlot, OverflowWrap, Paragraph, ParagraphOf, TextAlign,
  TextLeaf, TextStyle, TextStyleOf, VerticalAlign, WhiteSpace, WordBreak, WordBreakElement,
} from './model.js'
export { NO_BOX_EDGE, UNKNOWN_FONT_FACTS } from './model.js'
export type { Context } from './measure/canvas.js'
export type { BlinkGlyphCluster, BlinkItem, BlinkLineGeometry, BlinkMappingUnit } from './engines/blink/geometry.js'
export type { GeckoCharacter, GeckoFrameGeometry, GeckoLineGeometry, GeckoTextFrame } from './engines/gecko/geometry.js'
export type { WebKitDisplayBox, WebKitLineGeometry, WebKitTextBox } from './engines/webkit/geometry.js'
export type { BlinkFillResult, BlinkFilledLine, BlinkPaintFacts, BlinkRefusedSlot } from './engines/blink/index.js'
export type { GeckoFillResult, GeckoFilledLine, GeckoPaintFacts, GeckoRefusedSlot } from './engines/gecko/index.js'
export type { WebKitFillResult, WebKitFilledLine, WebKitPaintFacts, WebKitRefusedSlot } from './engines/webkit/index.js'
// The painter (paint.ts) is shared and names no engine: it paints the lines an engine's linePieces gave with that engine's
// painting rules.
export { paintLines, painterLimits, type LineEdges, type PaintLine, type PaintRules, type PaintedContent, type PainterLimit, type PainterLimitName } from './paint.js'
export { blinkPaintRules } from './engines/blink/paint-rules.js'
export { geckoPaintRules } from './engines/gecko/paint-rules.js'
export { webkitPaintRules } from './engines/webkit/paint-rules.js'

// A paragraph prepared for one engine, which never changes: lines are filled from it one slot at a time, at any width
// (DESIGN.md §2.9). `state` is the engine's own: content building from the inline tree, itemization, bidi, break
// opportunities, the widths the engine knows before it fills lines, its Canvas contexts and the environment. What a port
// reads of the paragraph later it keeps where it reads it: Blink and Gecko the paragraph itself, which is the caller's with
// the font facts Canvas answered (below), WebKit the block's style and its boxes' own.
export type Prepared =
  | { engine: 'blink'; state: BlinkPrepared }
  | { engine: 'webkit'; state: WebKitPrepared }
  | { engine: 'gecko'; state: GeckoPrepared }

// The state the next line starts from, per engine (DESIGN.md §2.7): small plain data that names positions in the prepared
// paragraph's lists and holds nothing of it.
export type LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart

// What fillLine returns, the engine's record of a decided line in it, and what is read from that record.
export type FillResult = blink.BlinkFillResult | webkit.WebKitFillResult | gecko.GeckoFillResult
export type FilledLine = blink.BlinkFilledLine | webkit.WebKitFilledLine | gecko.GeckoFilledLine
export type RefusedSlot = blink.BlinkRefusedSlot | webkit.WebKitRefusedSlot | gecko.GeckoRefusedSlot
export type Pieces = LinePieces<blink.BlinkPaintFacts> | LinePieces<webkit.WebKitPaintFacts> | LinePieces<gecko.GeckoPaintFacts>
export type LineInspection = LineInspectionOf<BlinkLineGeometry> | LineInspectionOf<WebKitLineGeometry> | LineInspectionOf<GeckoLineGeometry>

// The one place a paragraph's fonts reach the engines. A font fact the caller left null is asked of Canvas first, where a
// check is sound for the engine (measure/font-checks.ts, with what the engine's port asks for, engines/<engine>/checks.ts);
// the engines read FontFacts as the caller had given them. `inspect` prepares the paragraph for inspectLine and
// paragraphGaps, which the lab reads; a plain paragraph gives lines and pieces alone.
//
// `contexts` is the list the checks and the engine find their Canvas contexts in, each by its settings, and make them in
// (measure/canvas.ts contextFor). Nothing else is kept across calls: the checks ask Canvas again at every call.
// Lifetime: the caller's. A call that is given none gets an empty list, and then nothing outlives its prepared paragraph.
// A page that hands one list to every call pays for a context once per settings instead of once per paragraph.
// Invalidated by the page's fonts changing, in WebKit alone: there a context keeps the fonts its font string resolved to
// when it was assigned, so after a web font loads a page starts a new list where it prepares its paragraphs again.
// Chrome's and Firefox's contexts measure with the loaded font from their next call on (probes/contexts-font-load.ts).
// Bounded by the distinct settings a page measures with (declaration, size, language, direction, letter spacing,
// partition: about 8 contexts per declaration in Blink, 3 in WebKit and Gecko), and by MAX_CONTEXTS: settings that never
// repeat (an animated letter spacing, a size per paragraph) would grow the list without end, and every search of it, so
// a call that finds a longer list empties it. Prepared paragraphs hold their contexts by reference and keep theirs. The
// number is where a list whose contexts are all used in turn still costs no engine more to search than it saves
// (tools/contexts-bound.ts: a plain paragraph compares about 5.6 settings per context held in Blink, 4.1 in WebKit, 1.5 in
// Gecko, at 4 to 6 ns each; at 512 that is 17 µs in Chrome, where the list saves 90 µs a chat message, and 9.5 µs in
// WebKit, where it saves 9.7). A page past it, some 60 declarations used in turn in Chrome, makes its contexts again and
// again, as every page did before the list. What a kept canvas holds inside the browser is the browser's to bound: Chrome
// keeps at most 32,768 strings and 32,768 words per canvas and drops the least recently used half when either fills
// (frame_shape_cache.cc:12-16, :93-104), WebKit and Gecko keep measured words per font.
const MAX_CONTEXTS = 512

export function prepare(paragraph: Paragraph, env: Environment, inspect: boolean, contexts: Context[] = []): Prepared {
  if (contexts.length > MAX_CONTEXTS) contexts.length = 0
  switch (env.engine) {
    case 'blink': return { engine: 'blink', state: blink.prepare(withLearnedFontFacts(paragraph, blinkFontChecks(env), contexts), env, inspect, contexts) }
    case 'webkit': return { engine: 'webkit', state: webkit.prepare(withLearnedFontFacts(paragraph, webkitFontChecks, contexts), env, inspect, contexts) }
    case 'gecko': return { engine: 'gecko', state: gecko.prepare(withLearnedFontFacts(paragraph, geckoFontChecks, contexts), env, inspect, contexts) }
  }
}

// Where the first line starts, or null when the paragraph makes no line.
export function firstLine(prepared: Prepared): LineStart | null {
  switch (prepared.engine) {
    case 'blink': return blink.firstLine(prepared.state)
    case 'webkit': return webkit.firstLine(prepared.state)
    case 'gecko': return gecko.firstLine(prepared.state)
  }
}

function startMismatch(engine: string, start: string): Error {
  return new Error(`a ${start} line start can't continue a ${engine} paragraph`)
}

function lineMismatch(engine: string, line: string): Error {
  return new Error(`a ${line} line isn't a ${engine} paragraph's`)
}

// Fills one line from `start` in `slot`: the slot's width less its insets, as the engine turns float intrusion into a
// line's offsets and available width, measuring what the engine measures at line-edge time (DESIGN.md §2.9). Returns the
// decided line, with or without a line box, or below-floats when the slot has an inset and the engine moves the line down
// past the floats instead (model.ts FillResultOf). `start` is firstLine's or a fill result's `next` from the same prepared
// paragraph, so it can serve lines in other slots, and a start state serves any slot of the next line.
export function fillLine(prepared: Prepared, start: LineStart, slot: LineSlot): FillResult {
  switch (prepared.engine) {
    case 'blink':
      if (start.engine !== 'blink') throw startMismatch(prepared.engine, start.engine)
      return blink.fillLine(prepared.state, start, slot)
    case 'webkit':
      if (start.engine !== 'webkit') throw startMismatch(prepared.engine, start.engine)
      return webkit.fillLine(prepared.state, start, slot)
    case 'gecko':
      if (start.engine !== 'gecko') throw startMismatch(prepared.engine, start.engine)
      return gecko.fillLine(prepared.state, start, slot)
  }
}

// What a painter takes of a filled line (model.ts LinePieces). A pure function of its arguments.
export function linePieces(prepared: Prepared, line: FilledLine): Pieces {
  switch (prepared.engine) {
    case 'blink':
      if (line.engine !== 'blink') throw lineMismatch(prepared.engine, line.engine)
      return blink.linePieces(prepared.state, line)
    case 'webkit':
      if (line.engine !== 'webkit') throw lineMismatch(prepared.engine, line.engine)
      return webkit.linePieces(prepared.state, line)
    case 'gecko':
      if (line.engine !== 'gecko') throw lineMismatch(prepared.engine, line.engine)
      return gecko.linePieces(prepared.state, line)
  }
}

// The engine's geometry of a decided line and the gaps its breaks decide; a refused slot gives the gaps its refusal rests
// on, without geometry. A pure function of its arguments, which throws on a paragraph prepared plain.
export function inspectLine(prepared: Prepared, line: FilledLine | RefusedSlot): LineInspection {
  switch (prepared.engine) {
    case 'blink':
      if (line.engine !== 'blink') throw lineMismatch(prepared.engine, line.engine)
      return blink.inspectLine(prepared.state, line)
    case 'webkit':
      if (line.engine !== 'webkit') throw lineMismatch(prepared.engine, line.engine)
      return webkit.inspectLine(prepared.state, line)
    case 'gecko':
      if (line.engine !== 'gecko') throw lineMismatch(prepared.engine, line.engine)
      return gecko.inspectLine(prepared.state, line)
  }
}

// The gaps of the prepared paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5), computed by
// prepare; the engine-build gap first. It throws on a paragraph prepared plain.
export function paragraphGaps(prepared: Prepared): Gap[] {
  switch (prepared.engine) {
    case 'blink': return buildGaps(prepared.state.env).concat(blink.paragraphGaps(prepared.state))
    case 'webkit': return buildGaps(prepared.state.env).concat(webkit.paragraphGaps(prepared.state))
    case 'gecko': return buildGaps(prepared.state.env).concat(gecko.paragraphGaps(prepared.state))
  }
}

// Each port follows one build's source; any other build, or an unknown one, is laid out by that port all the same.
function buildGaps(env: Environment): Gap[] {
  const pinned = PINNED_BUILDS[env.engine]
  if (env.build === pinned || (env.build !== null && SOURCE_IDENTICAL_BUILDS[env.engine].includes(env.build))) return []
  const detail = env.build === null ? `the build isn't given; the port follows ${pinned}` : `build ${env.build}; the port follows ${pinned}`
  return [{ gap: 'engine-build', run: null, detail }]
}
