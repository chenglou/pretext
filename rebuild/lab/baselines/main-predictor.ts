// Baseline predictor: main's library in src/ through main's own harness adapter (harness/predict.ts), used the way an app
// developer uses it: walkLineRanges' lines of prepareWithSegments(), or, for a case an app writes with inline elements
// (spans among other runs, or several styles), walkRichInlineLineRanges' lines of prepareRichInline() with one item per
// run. Line ranges are UTF-16 source offsets and widths are main's; paint returns null.
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/main-predictor.ts ...
// The adapter also runs main's other line APIs on the case; the first way one disagrees with the walk is kept on the
// prediction as `disagreement`, which main's harness blocks on. Cases main can't express, and cases with inline structure
// (a tree, atomic inlines, <br>, <wbr>, text-indent, text-align or floats, which main's case format has no place for),
// return { error: 'unsupported by main: <reasons>' }.
import { clearCache, layout, prepare, type PrepareOptions } from '../../../src/layout.ts'
import { canvasFont, predict as predictWithMain, unsupported } from '../../../harness/predict.ts'
import type { Case as HarnessCase } from '../../../harness/types.ts'
import type { BrowserKind, Case, LinesPrediction } from '../types.ts'

type Counted = { countedLayout?: { lineCount: number; height: number; locale: string | null } }
type Prediction = LinesPrediction & { disagreement?: string } & Counted

// Every reason main can't express the case; empty when it can.
export function unsupportedReasons(c: Case): string[] {
  if (c.inline !== undefined) return ['inline structure']
  const problem = unsupported(c as HarnessCase)
  return problem === null ? [] : problem.split('; ')
}

export function predict(c: Case, env: { browser: BrowserKind; build: string }): (Prediction | { error: string }) & Counted {
  return predictWithLocale(c, env, c.paragraph.lang === '' ? undefined : c.paragraph.lang)
}

// Since #340 main takes break rules and font resolution from <html lang> alone and setLocale() only clears its caches,
// so `locale` changes nothing but the record. The caches are cleared before every case, so measureLog counts one fresh
// prepare. captureLayout adds what layout() on prepare()'s handle counts, the book survey's public height.
export function predictWithLocale(c: Case, _env: { browser: BrowserKind; build: string }, locale: string | undefined, captureLayout = false): (Prediction | { error: string }) & Counted {
  const reasons = unsupportedReasons(c)
  if (reasons.length > 0) return { error: `unsupported by main: ${reasons.join('; ')}` }
  clearCache()
  const predicted = predictWithMain(c as HarnessCase)
  if ('unsupported' in predicted) return { error: `unsupported by main: ${predicted.unsupported}` }
  if ('error' in predicted) return { error: `adapter: ${predicted.error}` }
  const out: Prediction = { lines: predicted.lines, measureLog: predicted.prepareCalls }
  if (predicted.disagreement !== null) out.disagreement = predicted.disagreement
  if (captureLayout) {
    const p = c.paragraph
    const run = p.runs[0]
    let source = ''
    for (let i = 0; i < p.runs.length; i++) source += p.runs[i]!.text
    if (run !== undefined && p.runs.length === 1) {
      const options: PrepareOptions = {}
      if (p.whiteSpace === 'pre-wrap') options.whiteSpace = 'pre-wrap'
      if (p.wordBreak === 'keep-all') options.wordBreak = 'keep-all'
      if (run.letterSpacing !== 0) options.letterSpacing = run.letterSpacing
      out.countedLayout = { ...layout(prepare(source, canvasFont(run.font), options), p.width, p.lineHeight), locale: locale ?? null }
    }
  }
  return out
}

export function paint(_c: Case, _prediction: LinesPrediction, _host: HTMLElement): HTMLElement[] | null {
  return null
}
