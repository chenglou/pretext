// Deterministic complete-state/query comparison; this is not browser accuracy or Native timing evidence.
// bun rebuild/experiments/plaintext-round/segments-proof.ts --baseline=/path/to/baseline --out=/private/tmp/result
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../src/env.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../src/model.js'
import { createContextPool } from '../../src/measure/canvas.js'
import * as current from '../../src/engines/blink/index.js'
import { isSegmentEdge } from '../../src/engines/blink/emoji.js'
import { groupPrefix16 } from '../../src/engines/blink/shape.js'
import type { BlinkPrepared } from '../../src/engines/blink/types.js'

const baselineRoot = resolve(process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11) ?? '/private/tmp/pretext-stateless-round2-baseline-20260922')
const old = await import(join(baselineRoot, 'rebuild/src/engines/blink/index.ts')) as typeof current
const oldShape = await import(join(baselineRoot, 'rebuild/src/engines/blink/shape.ts')) as { groupPrefix16: typeof groupPrefix16 }
const oldEmoji = await import(join(baselineRoot, 'rebuild/src/engines/blink/emoji.ts')) as { isSegmentEdge: typeof isSegmentEdge }
const oldPool = await import(join(baselineRoot, 'rebuild/src/measure/canvas.ts')) as { createContextPool: typeof createContextPool }
const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? '/private/tmp/pretext-segments-proof')
type ReferencePrepared = BlinkPrepared & { scripts?: Uint8Array; priorities?: Uint8Array; segmented?: boolean }
// Explicit test-only source facade; production callers cannot mutate the constructor-owned partitions. Null retains no
// columns. Reflection also supports frozen earlier two-array and five-column models without assuming current fields.
function columns(p: BlinkPrepared): Record<string, Int32Array | Uint8Array> | null {
  if (p.segments === null) return null
  return p.segments as unknown as Record<string, Int32Array | Uint8Array>
}
function countReads(p: BlinkPrepared, count: () => void): { bytes: number; buffers: number; scripts: number } {
  const native = p as ReferencePrepared
  const source = native.scripts !== undefined && native.priorities !== undefined
    ? { scripts: native.scripts, priorities: native.priorities }
    : columns(p)
  let bytes = 0, buffers = 0
  for (const [key, raw] of Object.entries(source ?? {})) {
    if (!(raw instanceof Int32Array) && !(raw instanceof Uint8Array)) throw new Error(`unexpected primary field ${key}`)
    bytes += raw.byteLength; buffers++
    const owner = native.scripts === undefined ? p.segments! : p
    Object.defineProperty(owner, key, { value: new Proxy(raw, { get(target, index) {
      if (typeof index === 'string' && /^\d+$/.test(index)) count()
      const value = Reflect.get(target, index, target); return typeof value === 'function' ? value.bind(target) : value
    } }) })
  }
  return { bytes, buffers, scripts: source?.['scriptCodes']?.length ?? (source === null ? 0 : -1) }
}
type Question = { font: string; direction: string; lang: string; spacing: string; text: string; width: number }
let questions: Question[] = [], tiny = false
const ignorable = /[\p{Mark}\p{Default_Ignorable_Code_Point}]/u
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    const chars = [...text].filter(char => !ignorable.test(char))
    const rawBase = tiny ? 1 : 8 * 65536
    let width = 0
    for (const char of chars) width += (rawBase + (tiny ? 0 : char.codePointAt(0)! % 7)) / 65536 + Number.parseFloat(this.letterSpacing)
    if (!tiny) for (let k = 0; k + 1 < chars.length; k++) {
      if (chars[k] === 'A' && chars[k + 1] === 'V') width -= 24577 / 65536
      if (chars[k] === '١' && chars[k + 1] === '٢') width -= 7 / 65536
      if (chars[k] === '(' && chars[k + 1] === ')') width -= (this.direction === 'rtl' ? 5 : 3) / 65536
      if (k >= 2 && chars[k - 2] === 'u' && chars[k + 1] === '\u2028') width += 2
    }
    questions.push({ font: this.font, direction: this.direction, lang: this.lang, spacing: this.letterSpacing, text, width })
    return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
  }
}
const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class { getContext(): Context { return new Context() } } })
const env: BlinkEnvironment = { engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, uiLanguage: 'en', dictionaryBreaks: { kind: 'unavailable' } }
const font = { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, primaryFamily: 'Mono', opticalSizeAxis: false, mapsHyphen: true, joining: 'opentype', pairKerning: 'first-advance' } } as const
const policy = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto', tabSize: 8 } as const
function paragraph(text: string): Paragraph { return { ...policy, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' } }
function span(text: string, padded: boolean, letterSpacing: number): Extract<InlineNode, { kind: 'span' }> { return { ...policy, kind: 'span', letterSpacing, lang: null, inlineStart: padded ? { margin: 0, border: 0, padding: 3 } : NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text }] } }
const texts = ['hello AVAV quux box', 'אבג דהו 123', '١٢٣٤٥٦٧٨٩٠'.repeat(12), '۱۲۳۴۵۶۷۸۹۰'.repeat(9), 'ب((()))12 Latin', 'aकaकaकaकaक', '界かな한글 a', 'မြန်မာစာ ภาษาไทย កម្ពុជា', '👍\u00ad🏽 👩\u200d\u00ad🚀 ❤️‍🔥 🇯🇵🇫', 'a\u2060\u0301b e\u0301', 'ab\u00adcd\u200bef a\u00a0b', '  a \t b\n\n c  ', '((١٢)) ((אב))', '\u202d١٢٣٤٥٦٧٨\u202c', '\u202eAVAV((\u202c', '\u{10300}a\u{16A0}b']
const inputs = texts.map(paragraph)
for (const text of ['١٢٣٤٥٦٧٨', 'אבג AV quux ', '👍\u00ad🏽', 'aक']) for (const padded of [false, true]) {
  const p = paragraph(''); p.content = [{ kind: 'text', text: text.slice(0, 2) }, span(text.slice(2), padded, 0), { kind: 'text', text: text }]; inputs.push(p)
}
for (const spacing of [-8, -0.125, 0.125, 1.5]) { const p = paragraph('١٢٣٤ aक AV quux ox 👍'); p.letterSpacing = spacing; inputs.push(p) }
for (const mode of ['pre-wrap', 'pre-line', 'break-spaces'] as const) { const p = paragraph('  AV ١٢\t  אב\n界  \n'); p.whiteSpace = mode; inputs.push(p) }
for (const pairKerning of ['split', null] as const) { const p = paragraph('١٢١٢ AVAV ((אב))'); p.font = { ...font, facts: { ...font.facts, pairKerning } }; inputs.push(p) }
for (const direction of ['rtl', 'ltr'] as const) { const p = paragraph('((123 אבג AVAV ١٢٣))'); p.direction = direction; inputs.push(p) }
// UTF-16 source properties and accepted split boundaries are distinct. Lone lows may start bidi/style groups, while
// the measurement splitter ignores a boundary before any low. Valid pairs split across styles are controls.
for (const [left, mid, right, styled] of [
  ['ب', '\uDC00', 'ب', false], ['ب', '\uDC00', 'ب', true],
  ['١', '\uDC00', 'ب', false], ['١', '\uDC00', '٢', true],
  ['ב', '\uDC00\uDC01', 'क', false], ['ب', '\uDC00\uDC01', 'ب', true],
  ['ب', '\uD800', 'ب', true], ['ب\uD83D', '\uDE00', 'ب', true],
  ['ب\uD83D', '\uDE00', 'ب', false], ['ب', '?', 'ب', true],
] as const) for (const spacing of [-2, 1.5]) for (const direction of ['ltr', 'rtl'] as const) {
  const p = paragraph(left + mid + right); p.letterSpacing = spacing; p.direction = direction
  if (styled) p.content = [{ kind: 'text', text: left }, { ...span(mid, false, spacing), font: { ...font, family: 'Other' } }, { kind: 'text', text: right }]
  inputs.push(p)
}

// A hidden Unknown source run can absorb following COMMON digits or inherited marks. The question's starting
// script still decides Canvas formatting, but spacing and script-context compare each mapped unit's actual source fact.
for (const [left, mid, right] of [
  ['אב12', '\uDC00\uDC01', '34גד'], ['क12', '\uDC00\uDC01', '34ख'],
  ['ب12', '\uDC00\uDC01', '34ب'], ['ᠠ12', '\uDC00\uDC01', '34ᠠ'],
  ['ب', '\uDC00\u0301', '34ب'], ['ب', '\uDC00\u064E', '34ب'],
  ['١٢', '\uDC00\uDC01', '٣٤'], ['\u202Dب12', '\uDC00\uDC01', '34ب\u202C'],
  ['\u202Eب12', '\uDC00\uDC01', '34ب\u202C'],
] as const) for (const styled of [false, true]) for (const spacing of [-2, 1.5]) for (const direction of ['ltr', 'rtl'] as const) {
  const p = paragraph(left + mid + right); p.letterSpacing = spacing; p.direction = direction
  if (styled) p.content = [{ kind: 'text', text: left }, { ...span(mid, false, spacing), font: { ...font, family: 'Other' } }, { kind: 'text', text: right }]
  inputs.push(p)
}
// Known-Latin mode is the original predicate, including empty/styled/atomic content; literal ORC, bidi and generated
// break-opportunity controls remain separately tested. Signed spacing keeps per-question Canvas script analysis active.
const atomic: InlineNode = { kind: 'atomic', width: 10, height: 10, marginInlineStart: 0, marginInlineEnd: 0 }
for (const spacing of [-1.5, 0, 1.5]) {
  for (const text of ['', 'Aµÿ\u00a0B ((123))', 'AV\u00AD quux']) { const p = paragraph(text); p.letterSpacing = spacing; inputs.push(p) }
  const empty = paragraph(''); empty.content = []; inputs.push(empty)
  const emptyStyled = paragraph(''); const e = span('', true, spacing); e.children = []; emptyStyled.content = [e]; inputs.push(emptyStyled)
  const styled = paragraph('Aµ'); styled.letterSpacing = spacing
  styled.content.push({ ...span(' ((ÿ)) ', true, -spacing), font: { ...font, family: 'Other' } }); inputs.push(styled)
  const box = paragraph(''); box.content = [atomic]; box.letterSpacing = spacing; inputs.push(box)
  const mixed = paragraph('Aµ'); mixed.letterSpacing = spacing
  const inside = span('ÿ B', true, -spacing); inside.children.unshift(atomic, { kind: 'br' }); mixed.content.push(inside); inputs.push(mixed)
  const literal = paragraph('\uFFFC'); literal.letterSpacing = spacing; inputs.push(literal)
  const literalStyled = paragraph(''); literalStyled.content = [span('\uFFFC', false, spacing)]; inputs.push(literalStyled)
  const rtl = paragraph('AV ((123))'); rtl.direction = 'rtl'; rtl.letterSpacing = spacing; inputs.push(rtl)
  const controls = paragraph('AV'); controls.content.push({ kind: 'wbr' }, atomic); controls.letterSpacing = spacing; inputs.push(controls)
}
let compareDirections = false
function normalized(p: BlinkPrepared, reference: boolean): unknown {
  const copy = JSON.parse(JSON.stringify(p)) as Record<string, unknown>
  const native = p as ReferencePrepared
  const scripts = native.scripts === undefined ? Array.from({ length: p.text.length }, (_, k) => p.segments === null ? 25 : p.segments.scriptAt(k)) : [...native.scripts]
  copy['scripts'] = scripts
  copy['segmented'] = native.segmented ?? p.segments !== null
  const edge = reference ? oldEmoji.isSegmentEdge : isSegmentEdge
  copy['segmentEdges'] = Array.from({ length: p.text.length + 1 }, (_, k) => edge(p, k))
  if (compareDirections) copy['shapingDirections'] = Array.from({ length: p.text.length }, (_, k) => p.segments === null ? false : p.segments.reversedAt(k))
  // Priority category values have no consumer after compilation. Their complete consumed boundary facts are checked
  // above; queries and complete outputs additionally test every actual use. No old priority array is rebuilt in runtime.
  delete copy['priorities']
  delete copy['segments']
  return copy
}
// A View now owns its single Part directly; this narrowly expands only ItemResult.shape back to the former
// parts-array model. Every Part field and all five View metadata fields remain in the equality check.
function normalizedView(value: unknown): unknown {
  if (value === null) return null
  const view = value as Record<string, unknown>
  if (Array.isArray(view['parts'])) {
    const copy = { ...view }
    if (copy['kind'] === 'parts') delete copy['kind']
    return copy
  }
  if (view['kind'] !== 'range' && view['kind'] !== 'reshape') throw new Error('unexpected View primary kind')
  const part = { ...view }
  const info: Record<string, unknown> = {}
  for (const key of ['width', 'rtl', 'startIndex', 'charIndexOffset', 'numCharacters']) {
    if (!Object.hasOwn(part, key)) throw new Error(`missing View metadata ${key}`)
    info[key] = part[key]
    delete part[key]
  }
  return { parts: [part], ...info }
}
function normalizedFillResult(result: current.BlinkFillResult, inspected: boolean): unknown {
  if (result.kind !== 'line' && result.kind !== 'below-floats') return result
  const info = { ...result.line.info, results: result.line.info.results.map(item => ({ ...item, shape: normalizedView(item.shape) })) }
  // The old plain paragraph computed an inspection-only suffix opportunity. Its decisionEnd was not consumed by
  // decisions, ranges or painting. Inspected decisionEnd remains compared exactly; only this plain internal field drops.
  if (!inspected) Reflect.deleteProperty(info, 'decisionEnd')
  return { ...result, line: { ...result.line, info } }
}
function laidOut(api: typeof current, p: BlinkPrepared, width: number, inspected: boolean): unknown[] {
  const lines: unknown[] = []
  for (let start = api.firstLine(p); start !== null;) {
    const result = api.fillLine(p, start, { width, left: 0, right: 0 })
    lines.push({ result: normalizedFillResult(result, inspected), pieces: result.kind === 'line' ? api.linePieces(p, result.line) : null, inspected: inspected && result.kind === 'line' ? api.inspectLine(p, result.line) : null })
    start = result.next
  }
  return lines
}
function equal(a: unknown, b: unknown, label: string): void { if (!isDeepStrictEqual(a, b)) { writeFileSync('/private/tmp/pretext-segment-mismatch.json', JSON.stringify({ label, a, b }, null, 2)); throw new Error(`Mismatch: ${label}`) } }
function fingerprint(root: string): string {
  const hash = new Bun.CryptoHasher('sha256')
  function visit(path: string): void { for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const target = join(path, entry.name); if (entry.isDirectory()) visit(target); else if (entry.name.endsWith('.js') && existsSync(target.slice(0, -3) + '.ts')) throw new Error(`Emitted JS shadows source TS: ${target}`); else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) { hash.update(target.slice(root.length)); hash.update(readFileSync(target)) } } }
  visit(root); return hash.digest('hex')
}
const currentRoot = resolve(import.meta.dir, '../../src')
const baselineSourceRoot = join(baselineRoot, 'rebuild/src')
const baselineBefore = fingerprint(baselineSourceRoot)
const before = fingerprint(currentRoot)
let comparisons = 0, totalQuestions = 0
try {
  for (let id = 0; id < inputs.length; id++) for (const inspected of [false, true]) for (const order of [[17, 32, 61, 129, 257, 9999], [257, 61, 17, 9999, 32, 129]]) {
    questions = []; const a = old.prepare(inputs[id]!, env, inspected, oldPool.createContextPool()); compareDirections = a.segments !== undefined; const aPrepared = normalized(a, true); const aLines = order.map(width => laidOut(old, a, width, inspected)); const aPost = normalized(a, true); const aQuestions = questions
    questions = []; const b = current.prepare(inputs[id]!, env, inspected, createContextPool()); const bPrepared = normalized(b, false); const bLines = order.map(width => laidOut(current, b, width, inspected)); const bPost = normalized(b, false); const bQuestions = questions
    equal(aPrepared, bPrepared, `prepared ${id}/${inspected}`); equal(aLines, bLines, `complete lines ${id}/${inspected}`); equal(aPost, bPost, `post state ${id}/${inspected}`); equal(aQuestions, bQuestions, `ordered questions ${id}/${inspected}`)
    comparisons++; totalQuestions += aQuestions.length
  }
  tiny = true
  const budgets: unknown[] = []
  for (const seed of ['a', 'אבג', '١٢٣٤٥٦٧٨٩٠', 'aक', '1️⃣x']) for (const n of [64, 128, 256, 512]) {
    const text = seed.repeat(Math.ceil(n / seed.length)).slice(0, n), input = paragraph(text)
    questions = []; const a = old.prepare(input, env, false, oldPool.createContextPool()); let oldReads = 0
    const oldMetadata = countReads(a, () => oldReads++)
    questions = []; const oldPrefixes: number[] = []; for (let g = 0; g < a.groups.length; g++) for (let k = a.groups[g]!.start + 1; k < a.groups[g]!.end; k++) oldPrefixes.push(oldShape.groupPrefix16({ p: a, gaps: null }, g, k)); const oldQuestions = questions
    questions = []; const b = current.prepare(input, env, false, createContextPool()); let runReads = 0
    const newMetadata = countReads(b, () => runReads++)
    questions = []; const newPrefixes: number[] = []; for (let g = 0; g < b.groups.length; g++) for (let k = b.groups[g]!.start + 1; k < b.groups[g]!.end; k++) newPrefixes.push(groupPrefix16({ p: b, gaps: null }, g, k)); const newQuestions = questions
    equal(oldPrefixes, newPrefixes, `prefix budget ${seed}/${n}`); equal(oldQuestions, newQuestions, `questions budget ${seed}/${n}`)
    const oldPrefixReads = oldReads, newPrefixReads = runReads
    const oldEdges = Array.from({ length: text.length + 1 }, (_, k) => oldEmoji.isSegmentEdge(a, k))
    const newEdges = Array.from({ length: text.length + 1 }, (_, k) => isSegmentEdge(b, k))
    equal(oldEdges, newEdges, `complete edge facts ${seed}/${n}`)
    budgets.push({ seed, n, oldMetadataReads: oldPrefixReads, newMetadataReads: newPrefixReads, oldEdgeReads: oldReads - oldPrefixReads, newEdgeReads: runReads - newPrefixReads, questions: newQuestions.length, scripts: newMetadata.scripts, oldRetainedBytes: oldMetadata.bytes, newRetainedBytes: newMetadata.bytes, oldBuffers: oldMetadata.buffers, buffers: newMetadata.buffers })
  }
  const after = fingerprint(currentRoot); equal(before, after, 'current source stable')
  const baselineAfter = fingerprint(baselineSourceRoot); equal(baselineBefore, baselineAfter, 'baseline source stable')
  mkdirSync(out, { recursive: true }); const report = { kind: 'deterministic complete-state/query comparison', projections: ['primary representation is compared by complete source-script and segment-edge facts; direction facts also compared when exposed by reference', 'null primary fact projects known Latin, no segment edges/direction, and zero retained buffers; discarded priority categories have no remaining consumer', 'only ItemResult.shape Views expand to the former parts array, preserving every Part field and all five View metadata fields', 'only plain line.info.decisionEnd is omitted: inspection-only suffix lookahead has no plain output/decision consumer; inspected values remain exact'], nativeAccuracyEvidence: false, nativeTimingEvidence: false, source: { baselineRoot, baselineBefore, baselineAfter, currentRoot, before, after, stable: before === after && baselineBefore === baselineAfter }, inputs: inputs.length, comparisons, orderedQuestions: totalQuestions, budgets }
  writeFileSync(join(out, 'segments-proof.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ out, inputs: inputs.length, comparisons, orderedQuestions: totalQuestions, budgets }))
} finally { if (originalCanvas === undefined) Reflect.deleteProperty(globalThis, 'OffscreenCanvas'); else Object.defineProperty(globalThis, 'OffscreenCanvas', originalCanvas) }
