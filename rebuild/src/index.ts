// Public entry: lay out a styled paragraph the way the environment's engine does, one line slot at a time. The engine
// difference is this one switch; everything engine-specific lives under engines/<engine>/.
import { blinkFontChecks } from './engines/blink/checks.js'
import type { BlinkLineStart } from './engines/blink/geometry.js'
import { blinkEngine } from './engines/blink/index.js'
import type { BlinkLineResult, BlinkPrepared } from './engines/blink/types.js'
import { geckoFontChecks } from './engines/gecko/checks.js'
import type { GeckoLineStart } from './engines/gecko/geometry.js'
import { geckoEngine } from './engines/gecko/index.js'
import type { GeckoLineResult, GeckoPrepared } from './engines/gecko/types.js'
import { webkitFontChecks } from './engines/webkit/checks.js'
import type { WebKitLineStart } from './engines/webkit/geometry.js'
import { webkitEngine } from './engines/webkit/index.js'
import type { WebKitLineResult, WebKitPrepared } from './engines/webkit/types.js'
import { PINNED_BUILDS, SOURCE_IDENTICAL_BUILDS, type BlinkEnvironment, type Environment, type GeckoEnvironment, type WebKitEnvironment } from './env.js'
import { createMeasurer, type Measurer } from './measure/canvas.js'
import { withLearnedFontFacts } from './measure/font-checks.js'
import type { Gap, LineSlot, Paragraph } from './model.js'

export type {
  BlinkEnvironment, BlinkProcessLanguages, DetectedEngine, DetectedEnvironment, EngineName, Environment, GeckoEnvironment,
  GeckoProcessLanguages, GivenFacts, ProcessLanguages, WebKitEnvironment, WebKitProcessLanguages,
} from './env.js'
export { PINNED_BUILDS, detectEngine, detectEnvironment } from './env.js'
export type {
  AtomicInline, BoxEdge, CssFont, Direction, FontDecl, FontFacts, Fragment, Gap, GapName, InlineElement, InlineElementOf, InlineNode,
  InlineNodeOf, LineBreak, LineBreakElement, LineOf, LineResultOf, LineSlot, OverflowWrap, Paragraph, ParagraphOf, TextAlign, TextLeaf,
  TextStyle, TextStyleOf, VerticalAlign, WhiteSpace, WordBreak, WordBreakElement,
} from './model.js'
export { FULL_WIDTH, NO_BOX_EDGE, UNKNOWN_FONT_FACTS } from './model.js'
export type { BlinkGlyphCluster, BlinkItem, BlinkLineGeometry, BlinkMappingUnit } from './engines/blink/geometry.js'
export type { GeckoCharacter, GeckoFrameGeometry, GeckoLineGeometry, GeckoTextFrame } from './engines/gecko/geometry.js'
export type { WebKitDisplayBox, WebKitLineGeometry, WebKitTextBox } from './engines/webkit/geometry.js'
export type { BlinkLine, BlinkLineResult } from './engines/blink/types.js'
export type { GeckoLine, GeckoLineResult } from './engines/gecko/types.js'
export type { WebKitLine, WebKitLineResult } from './engines/webkit/types.js'
export { paintLines, painterLimits, type PaintableLayout, type PaintedLine, type PainterLimit, type PainterLimitName } from './paint.js'

// A paragraph prepared for one engine, from which lines are laid out one slot at a time (DESIGN.md §2.9). `state` is the
// engine's own: content building from the inline tree, itemization, bidi, break opportunities, and the widths the engine
// knows before it fills lines. The measurer holds the Canvas contexts, the memo and the call log of preparation and of
// every line laid out from it. `paragraph` is the one the engine laid out: the caller's, with the font facts Canvas
// answered (below).
export type PreparedParagraph =
  | { engine: 'blink'; env: BlinkEnvironment; paragraph: Paragraph; state: BlinkPrepared; measurer: Measurer }
  | { engine: 'webkit'; env: WebKitEnvironment; paragraph: Paragraph; state: WebKitPrepared; measurer: Measurer }
  | { engine: 'gecko'; env: GeckoEnvironment; paragraph: Paragraph; state: GeckoPrepared; measurer: Measurer }

// The state the next line starts from, per engine (DESIGN.md §2.7).
export type LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart

// The one place a paragraph's fonts reach the engines. A font fact the caller left null is asked of Canvas first, where a
// check is sound for the engine (measure/font-checks.ts, with what the engine's port asks for, engines/<engine>/checks.ts);
// the engines read FontFacts as the caller had given them.
export function prepareParagraph(given: Paragraph, env: Environment): PreparedParagraph {
  const measurer = createMeasurer()
  switch (env.engine) {
    case 'blink': {
      const paragraph = withLearnedFontFacts(given, blinkFontChecks(env), measurer)
      return { engine: 'blink', env, paragraph, state: blinkEngine.prepare(paragraph, env, measurer), measurer }
    }
    case 'webkit': {
      const paragraph = withLearnedFontFacts(given, webkitFontChecks, measurer)
      return { engine: 'webkit', env, paragraph, state: webkitEngine.prepare(paragraph, env, measurer), measurer }
    }
    case 'gecko': {
      const paragraph = withLearnedFontFacts(given, geckoFontChecks, measurer)
      return { engine: 'gecko', env, paragraph, state: geckoEngine.prepare(paragraph, env, measurer), measurer }
    }
  }
}

// Where the first line starts, or null when the paragraph makes no line.
export function firstLineStart(prepared: PreparedParagraph): LineStart | null {
  switch (prepared.engine) {
    case 'blink': return blinkEngine.firstLine(prepared.state)
    case 'webkit': return webkitEngine.firstLine(prepared.state)
    case 'gecko': return geckoEngine.firstLine(prepared.state)
  }
}

// What layoutLine returns: the engine's line in the slot, or its move below the slot's floats (model.ts LineResultOf).
export type LineResult = BlinkLineResult | WebKitLineResult | GeckoLineResult

function startMismatch(engine: string, start: string): Error {
  return new Error(`a ${start} line start can't continue a ${engine} paragraph`)
}

// Fills one line from `start` in `slot`: the content box less the slot's insets, as the engine turns float intrusion into
// a line's offsets and available width, measuring what the engine measures at line-edge time (DESIGN.md §2.9). Returns the
// line, with or without a line box, or below-floats when the slot has an inset and the engine moves the line down past the
// floats instead. The gaps its breaks decide go on the line. `start` is firstLineStart's or a previous line's `next` from
// the same prepared paragraph, which never changes, so it can serve lines in other slots, and a start state serves any slot
// of the next line.
export function layoutLine(prepared: PreparedParagraph, start: LineStart, slot: LineSlot): LineResult {
  switch (prepared.engine) {
    case 'blink':
      if (start.engine !== 'blink') throw startMismatch(prepared.engine, start.engine)
      return blinkEngine.nextLine(prepared.state, start, slot, prepared.measurer)
    case 'webkit':
      if (start.engine !== 'webkit') throw startMismatch(prepared.engine, start.engine)
      return webkitEngine.nextLine(prepared.state, start, slot, prepared.measurer)
    case 'gecko':
      if (start.engine !== 'gecko') throw startMismatch(prepared.engine, start.engine)
      return geckoEngine.nextLine(prepared.state, start, slot, prepared.measurer)
  }
}

// The gaps of the prepared paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5), computed by
// prepare; the engine-build gap first.
export function paragraphGaps(prepared: PreparedParagraph): Gap[] {
  switch (prepared.engine) {
    case 'blink': return buildGaps(prepared.env).concat(blinkEngine.gaps(prepared.state))
    case 'webkit': return buildGaps(prepared.env).concat(webkitEngine.gaps(prepared.state))
    case 'gecko': return buildGaps(prepared.env).concat(geckoEngine.gaps(prepared.state))
  }
}

// Each port follows one build's source; any other build, or an unknown one, is laid out by that port all the same.
function buildGaps(env: Environment): Gap[] {
  const pinned = PINNED_BUILDS[env.engine]
  if (env.build === pinned || (env.build !== null && SOURCE_IDENTICAL_BUILDS[env.engine].includes(env.build))) return []
  const detail = env.build === null ? `the build isn't given; the port follows ${pinned}` : `build ${env.build}; the port follows ${pinned}`
  return [{ gap: 'engine-build', run: null, detail }]
}
