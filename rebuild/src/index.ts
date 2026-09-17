// Public entry: lay out a styled paragraph the way the environment's engine does. The engine difference is this one switch;
// everything engine-specific lives under engines/<engine>/.
import { blinkEngine } from './engines/blink/index.js'
import type { EngineImplementation } from './engines/engine.js'
import { geckoEngine } from './engines/gecko/index.js'
import { webkitEngine } from './engines/webkit/index.js'
import { PINNED_BUILDS, type Environment } from './env.js'
import { createMeasurer, type Measurer } from './measure/canvas.js'
import type { Gap, LineOf, Paragraph, ParagraphLayout } from './model.js'

export type {
  BlinkEnvironment, DetectedEngine, DetectedEnvironment, EngineName, Environment, GeckoEnvironment, GivenFacts, WebKitEnvironment,
} from './env.js'
export { PINNED_BUILDS, detectEngine, detectEnvironment } from './env.js'
export type {
  BlinkGlyphCluster, BlinkItem, BlinkLayout, BlinkLine, BlinkLineGeometry, BlinkMappingUnit, CanvasMeasure, CssFont, Direction,
  Expected, ExpectedObservation, ExpectedRect, FontDecl, FontFacts, Fragment, Gap, GapName, GeckoCharacter, GeckoFrameGeometry,
  GeckoLayout, GeckoLine, GeckoLineGeometry, LineBreak, LineOf, LineStart, ObservationPort, OverflowWrap, Paragraph, ParagraphLayout,
  ParagraphOf, TextRun, TextRunOf, UnobservableFact, WebKitDisplayBox, WebKitLayout, WebKitLine, WebKitLineGeometry, WhiteSpace,
  WordBreak,
} from './model.js'
export { UNKNOWN_FONT_FACTS } from './model.js'
export { paintLines } from './paint.js'

export function layoutParagraph(paragraph: Paragraph, env: Environment): ParagraphLayout {
  const measurer = createMeasurer()
  switch (env.engine) {
    case 'blink': {
      const filled = fillLines(blinkEngine, paragraph, env, measurer)
      return { engine: 'blink', env, lines: filled.lines, measure: measurer.log, gaps: buildGaps(env).concat(filled.gaps) }
    }
    case 'webkit': {
      const filled = fillLines(webkitEngine, paragraph, env, measurer)
      return { engine: 'webkit', env, lines: filled.lines, measure: measurer.log, gaps: buildGaps(env).concat(filled.gaps) }
    }
    case 'gecko': {
      const filled = fillLines(geckoEngine, paragraph, env, measurer)
      return { engine: 'gecko', env, lines: filled.lines, measure: measurer.log, gaps: buildGaps(env).concat(filled.gaps) }
    }
  }
}

// Each port follows one build's source; any other build, or an unknown one, is laid out by that port all the same.
function buildGaps(env: Environment): Gap[] {
  const pinned = PINNED_BUILDS[env.engine]
  if (env.build === pinned) return []
  const detail = env.build === null ? `the build isn't given; the port follows ${pinned}` : `build ${env.build}; the port follows ${pinned}`
  return [{ gap: 'engine-build', run: null, detail }]
}

function fillLines<Env, Prepared, Start, Geometry>(
  engine: EngineImplementation<Env, Prepared, Start, Geometry>, paragraph: Paragraph, env: Env, measurer: Measurer,
): { lines: LineOf<Start, Geometry>[]; gaps: Gap[] } {
  const prepared = engine.prepare(paragraph, env, measurer)
  const lines: LineOf<Start, Geometry>[] = []
  for (let start = engine.firstLine(prepared); start !== null;) {
    const line = engine.nextLine(prepared, start, paragraph.width, measurer)
    lines.push(line)
    start = line.next
  }
  return { lines, gaps: engine.gaps(prepared) }
}
