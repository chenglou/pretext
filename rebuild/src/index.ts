// Public entry: lay out a styled paragraph the way the environment's engine does. The engine difference is this one switch;
// everything engine-specific lives under engines/<engine>/.
import { blinkEngine } from './engines/blink/index.js'
import type { EngineImplementation } from './engines/engine.js'
import { geckoEngine } from './engines/gecko/index.js'
import { webkitEngine } from './engines/webkit/index.js'
import type { Environment } from './env.js'
import { createMeasurer, type Measurer } from './measure/canvas.js'
import type { Line, LineStart, Paragraph, ParagraphLayout } from './model.js'

export type { Engine, EngineName, Environment, DetectedEnvironment, DictionaryBreaks } from './env.js'
export { BLINK, GECKO, WEBKIT, detectEnvironment } from './env.js'
export type {
  Direction, EngineWidth, FontDecl, Fragment, Gap, GapName, Line, LineBreak, LineOf, LineStart, OverflowWrap, Paragraph,
  ParagraphLayout, TextRun, WhiteSpace, WordBreak,
} from './model.js'
export { paintLines } from './paint.js'

export function layoutParagraph(paragraph: Paragraph, env: Environment): ParagraphLayout {
  const measurer = createMeasurer()
  switch (env.engine.name) {
    case 'blink': return fillLines(blinkEngine, paragraph, env, measurer)
    case 'webkit': return fillLines(webkitEngine, paragraph, env, measurer)
    case 'gecko': return fillLines(geckoEngine, paragraph, env, measurer)
  }
}

function fillLines<Prepared, Start extends LineStart>(
  engine: EngineImplementation<Prepared, Start>, paragraph: Paragraph, env: Environment, measurer: Measurer,
): ParagraphLayout {
  const prepared = engine.prepare(paragraph, env, measurer)
  const lines: Line[] = []
  for (let start = engine.firstLine(prepared); start !== null;) {
    const line = engine.nextLine(prepared, start, paragraph.width, measurer)
    lines.push(line)
    start = line.next
  }
  return { engine: env.engine.name, lines, measure: measurer.log, gaps: engine.gaps(prepared) }
}
