// The page side of tools/js-profile.ts: the Blink port as an application runs it, behind a few functions the page's
// script calls. Bundled once per studied checkout (the driver points `../src/` at that checkout's library). A pass hands
// every prepare one list of Canvas contexts, started inside the pass, as a page that lays its messages out from nothing
// does (bench/README.md, "Chat", E). Nothing here measures time but `phases`.
import type { BlinkEnvironment } from '../src/env.ts'
import { blinkFontChecks } from '../src/engines/blink/checks.ts'
import * as blink from '../src/engines/blink/index.ts'
import type { BlinkPrepared } from '../src/engines/blink/types.ts'
import { detectEnvironment } from '../src/index.ts'
import type { Context } from '../src/measure/canvas.ts'
import { withLearnedFontFacts } from '../src/measure/font-checks.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'

type Part = { code: boolean; text: string }

function environment(): BlinkEnvironment {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported' || detected.env.engine !== 'blink') throw new Error('not a Blink browser')
  return detected.env
}

// bench/page.ts chatInputs: no font facts supplied.
function paragraphOf(parts: readonly Part[]): Paragraph {
  const font: FontDecl = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: 6 }
  const content: InlineNode[] = []
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}

// Every line's source range goes into the hash (FNV-1a over the numbers), so two checkouts are held against each other
// line by line.
let rangeHash = 0
function fillAll(prepared: BlinkPrepared, width: number): number {
  let lines = 0
  for (let start = blink.firstLine(prepared); start !== null;) {
    const filled = blink.fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    rangeHash = Math.imul(rangeHash ^ filled.start, 0x01000193)
    rangeHash = Math.imul(rangeHash ^ filled.end, 0x01000193)
    if (filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

function prepareOne(paragraph: Paragraph, env: BlinkEnvironment, contexts: Context[]): BlinkPrepared {
  return blink.prepare(withLearnedFontFacts(paragraph, blinkFontChecks(env), contexts), env, false, contexts)
}

function scratch(paragraphs: readonly Paragraph[], env: BlinkEnvironment, width: number): { lines: number; hash: number } {
  const contexts: Context[] = []
  rangeHash = 0x811c9dc5
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) lines += fillAll(prepareOne(paragraphs[i]!, env, contexts), width)
  return { lines, hash: rangeHash >>> 0 }
}

// The same with a timer read around the font checks, the engine's prepare and the line loop of every message.
function phases(paragraphs: readonly Paragraph[], env: BlinkEnvironment, width: number): { checksMs: number; prepareMs: number; fillMs: number } {
  const contexts: Context[] = []
  const checks = blinkFontChecks(env)
  let checksMs = 0
  let prepareMs = 0
  let fillMs = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const t0 = performance.now()
    const learned = withLearnedFontFacts(paragraphs[i]!, checks, contexts)
    const t1 = performance.now()
    const prepared = blink.prepare(learned, env, false, contexts)
    const t2 = performance.now()
    fillAll(prepared, width)
    const t3 = performance.now()
    checksMs += t1 - t0
    prepareMs += t2 - t1
    fillMs += t3 - t2
  }
  return { checksMs, prepareMs, fillMs }
}

function prepareAll(paragraphs: readonly Paragraph[], env: BlinkEnvironment, width: number): BlinkPrepared[] {
  const contexts: Context[] = []
  const out: BlinkPrepared[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    out.push(prepareOne(paragraphs[i]!, env, contexts))
    fillAll(out[i]!, width)
  }
  return out
}

function relayout(prepared: readonly BlinkPrepared[], widths: readonly number[]): { lines: number; hash: number } {
  rangeHash = 0x811c9dc5
  let lines = 0
  for (let w = 0; w < widths.length; w++) for (let i = 0; i < prepared.length; i++) lines += fillAll(prepared[i]!, widths[w]!)
  return { lines, hash: rangeHash >>> 0 }
}

(globalThis as unknown as { jsProfileLib: unknown }).jsProfileLib = { environment, paragraphOf, scratch, phases, prepareAll, relayout }
