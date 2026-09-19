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
import { withLearnedFontFacts } from './measure/font-checks.js'
import type { Gap, LineInspectionOf, LinePieces, LineSlot, Paragraph } from './model.js'

export type {
  BlinkEnvironment, BlinkProcessLanguages, DetectedEngine, DetectedEnvironment, EngineName, Environment, GeckoEnvironment,
  GeckoProcessLanguages, GivenFacts, ProcessLanguages, WebKitEnvironment, WebKitProcessLanguages,
} from './env.js'
export { PINNED_BUILDS, detectEngine, detectEnvironment } from './env.js'
export type {
  AtomicInline, BoxEdge, CssFont, Direction, FillResultOf, FontDecl, FontFacts, Fragment, Gap, GapName, InlineElement, InlineElementOf, InlineNode,
  InlineNodeOf, LineBreak, LineBreakElement, LineInspectionOf, LineOf, LinePieces, LineResultOf, LineSlot, OverflowWrap, Paragraph, ParagraphOf, TextAlign,
  TextLeaf, TextStyle, TextStyleOf, VerticalAlign, WhiteSpace, WordBreak, WordBreakElement,
} from './model.js'
export { NO_BOX_EDGE, UNKNOWN_FONT_FACTS } from './model.js'
export type { BlinkGlyphCluster, BlinkItem, BlinkLineGeometry, BlinkMappingUnit } from './engines/blink/geometry.js'
export type { GeckoCharacter, GeckoFrameGeometry, GeckoLineGeometry, GeckoTextFrame } from './engines/gecko/geometry.js'
export type { WebKitDisplayBox, WebKitLineGeometry, WebKitTextBox } from './engines/webkit/geometry.js'
export type { BlinkFillResult, BlinkFilledLine, BlinkPaintFacts, BlinkRefusedSlot } from './engines/blink/index.js'
export type { GeckoFillResult, GeckoFilledLine, GeckoPaintFacts, GeckoRefusedSlot } from './engines/gecko/index.js'
export type { WebKitFillResult, WebKitFilledLine, WebKitPaintFacts, WebKitRefusedSlot } from './engines/webkit/index.js'
export { paintLines, painterLimits, type PaintableLayout, type PaintedLine, type PainterLimit, type PainterLimitName } from './paint.js'

// A paragraph prepared for one engine, which never changes: lines are filled from it one slot at a time, at any width
// (DESIGN.md §2.9). `state` is the engine's own: content building from the inline tree, itemization, bidi, break
// opportunities, the widths the engine knows before it fills lines, its Canvas contexts, the environment, and the paragraph
// it laid out, which is the caller's with the font facts Canvas answered (below).
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
export function prepare(paragraph: Paragraph, env: Environment, inspect: boolean): Prepared {
  switch (env.engine) {
    case 'blink': return { engine: 'blink', state: blink.prepare(withLearnedFontFacts(paragraph, blinkFontChecks(env)), env, inspect) }
    case 'webkit': return { engine: 'webkit', state: webkit.prepare(withLearnedFontFacts(paragraph, webkitFontChecks), env, inspect) }
    case 'gecko': return { engine: 'gecko', state: gecko.prepare(withLearnedFontFacts(paragraph, geckoFontChecks), env, inspect) }
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

function mismatch(engine: string, what: string): Error {
  return new Error(`${what} can't continue a ${engine} paragraph`)
}

// Fills one line from `start` in `slot`: the slot's width less its insets, as the engine turns float intrusion into a
// line's offsets and available width, measuring what the engine measures at line-edge time (DESIGN.md §2.9). Returns the
// decided line, with or without a line box, or below-floats when the slot has an inset and the engine moves the line down
// past the floats instead (model.ts FillResultOf). `start` is firstLine's or a fill result's `next` from the same prepared
// paragraph, so it can serve lines in other slots, and a start state serves any slot of the next line.
export function fillLine(prepared: Prepared, start: LineStart, slot: LineSlot): FillResult {
  switch (prepared.engine) {
    case 'blink':
      if (start.engine !== 'blink') throw mismatch(prepared.engine, `a ${start.engine} line start`)
      return blink.fillLine(prepared.state, start, slot)
    case 'webkit':
      if (start.engine !== 'webkit') throw mismatch(prepared.engine, `a ${start.engine} line start`)
      return webkit.fillLine(prepared.state, start, slot)
    case 'gecko':
      if (start.engine !== 'gecko') throw mismatch(prepared.engine, `a ${start.engine} line start`)
      return gecko.fillLine(prepared.state, start, slot)
  }
}

// What a painter takes of a filled line (model.ts LinePieces). A pure function of its arguments.
export function linePieces(prepared: Prepared, line: FilledLine): Pieces {
  switch (prepared.engine) {
    case 'blink':
      if (line.engine !== 'blink') throw mismatch(prepared.engine, `a ${line.engine} line`)
      return blink.linePieces(prepared.state, line)
    case 'webkit':
      if (line.engine !== 'webkit') throw mismatch(prepared.engine, `a ${line.engine} line`)
      return webkit.linePieces(prepared.state, line)
    case 'gecko':
      if (line.engine !== 'gecko') throw mismatch(prepared.engine, `a ${line.engine} line`)
      return gecko.linePieces(prepared.state, line)
  }
}

// The engine's geometry of a decided line and the gaps its breaks decide; a refused slot gives the gaps its refusal rests
// on, without geometry. A pure function of its arguments, which throws on a paragraph prepared plain.
export function inspectLine(prepared: Prepared, line: FilledLine | RefusedSlot): LineInspection {
  switch (prepared.engine) {
    case 'blink':
      if (line.engine !== 'blink') throw mismatch(prepared.engine, `a ${line.engine} line`)
      return blink.inspectLine(prepared.state, line)
    case 'webkit':
      if (line.engine !== 'webkit') throw mismatch(prepared.engine, `a ${line.engine} line`)
      return webkit.inspectLine(prepared.state, line)
    case 'gecko':
      if (line.engine !== 'gecko') throw mismatch(prepared.engine, `a ${line.engine} line`)
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
