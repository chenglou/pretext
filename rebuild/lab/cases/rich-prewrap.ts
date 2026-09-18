// Rich pre-wrap families (prefix 'rich-prewrap/'): white-space: pre-wrap with inline structure. A pre-wrap block with
// spans of other fonts, sizes and spacing; spans with box edges; a pre-wrap span inside a normal block and the reverse;
// preserved spaces, tabs and newlines at span edges; a line that ends in preserved spaces inside a span; bidi content;
// narrow widths; nested modes with atomic inlines, <br> and <wbr>; line slots beside floats. Main's rich-inline API has no
// pre-wrap, so these cases ask whether the rebuild's model can carry it. Never launches a browser.
//
//   bun rebuild/lab/cases/rich-prewrap.ts [--seed=S] [--out=FILE]
//
// Defaults: seed rich-prewrap-20260918, out .artifacts/prewrap-20260918/cases/rich-prewrap.ndjson. Writes
// `<out>.summary.json` with the family counts next to the file.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { BoxEdge } from '../../src/model.ts'
import type { Case, FontDecl, InlineStructure, Paragraph } from '../types.ts'
import { atomic, br, el, font, leaf, treeParagraph, wbr, type BlockSpec, type SpanSpec, type TreePart } from './build.ts'
import { countFamilies, makeCase, mergeCases, sortCases } from './case.ts'
import { createRng, type Rng } from './prng.ts'
import { estimateRunsWidth, estimateTextWidth } from './widths.ts'

type Shape = { block: BlockSpec; parts: TreePart[]; note: string; widths: number[] }

const LATIN = ['Arial', '"Helvetica Neue"', '"Times New Roman"', 'Georgia', 'Verdana', '"Courier New"', 'Menlo'] as const
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'] as const

const quarter = (value: number): number => Math.max(0, Math.round(value * 4) / 4)

function edgesWidth(parts: readonly TreePart[]): number {
  let width = 0
  const side = (edge: Partial<BoxEdge> | undefined): number => (edge?.margin ?? 0) + (edge?.border ?? 0) + (edge?.padding ?? 0)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.kind === 'span') width += side(part.spec.start) + side(part.spec.end) + edgesWidth(part.children)
    else if (part.kind === 'atomic') width += part.width + part.marginInlineStart + part.marginInlineEnd
  }
  return width
}

// The estimated width of the longest stretch between preserved newlines, box edges and atomic inlines included.
function naturalWidth(block: BlockSpec, parts: readonly TreePart[]): number {
  const tree = treeParagraph(block, parts)
  let text = 0
  let lines = 1
  for (let r = 0; r < tree.paragraph.runs.length; r++) {
    const run = tree.paragraph.runs[r]!
    for (let i = 0; i < run.text.length; i++) if (run.text[i] === '\n') lines++
  }
  text = estimateRunsWidth(tree.paragraph.runs)
  return text / Math.min(lines, 3) + edgesWidth(parts)
}

// `count` widths spread over [low, high] times the estimate, a quarter px sometimes.
function spread(rng: Rng, estimate: number, count: number, low: number, high: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const factor = low + ((i + rng.next()) / count) * (high - low)
    const width = estimate * factor
    out.push(rng.chance(0.25) ? quarter(width) : Math.max(1, Math.round(width)))
  }
  return [...new Set(out)]
}

function spaces(count: number): string {
  return ' '.repeat(count)
}

function variedSpan(rng: Rng, base: FontDecl): SpanSpec {
  const kind = rng.pick(['family', 'size', 'weight', 'letter-spacing', 'word-spacing', 'mixed'] as const)
  const spec: SpanSpec = {}
  if (kind === 'family' || kind === 'mixed') spec.font = font(rng.pick(LATIN.filter(name => name !== base.family)), kind === 'mixed' ? rng.pick([12, 20, 28]) : base.size)
  if (kind === 'size') spec.font = font(base.family, rng.pick([11, 13.5, 22, 30]))
  if (kind === 'weight') spec.font = font(base.family, base.size, 700, rng.chance(0.3) ? 'italic' : 'normal')
  if (kind === 'letter-spacing' || (kind === 'mixed' && rng.chance(0.5))) spec.letterSpacing = rng.pick([1, 2.5, -0.5, 0.3])
  if (kind === 'word-spacing') spec.wordSpacing = rng.pick([3, 6.5, -1])
  return spec
}

function edgeSpec(rng: Rng): { spec: SpanSpec; label: string } {
  const kind = rng.pick(['padding', 'border', 'margin', 'negative-margin', 'border-padding'] as const)
  const amount = rng.pick([6, 3.3, 10, 0.4])
  let edge: Partial<BoxEdge>
  switch (kind) {
    case 'padding': edge = { padding: amount }; break
    case 'border': edge = { border: Math.max(1, Math.round(amount / 2)) }; break
    case 'margin': edge = { margin: amount }; break
    case 'negative-margin': edge = { margin: -Math.min(amount, 6) }; break
    case 'border-padding': edge = { border: 1, padding: amount }; break
  }
  const side = rng.pick(['start', 'end', 'both', 'both'] as const)
  return { spec: { ...(side === 'end' ? {} : { start: edge }), ...(side === 'start' ? {} : { end: edge }) }, label: `${kind} ${amount} ${side}` }
}

type Placement = 'in-end' | 'in-start' | 'out' | 'both' | 'ws-only' | 'mid-word' | 'collapsible-around'
const PLACEMENTS: readonly Placement[] = ['in-end', 'in-start', 'out', 'both', 'ws-only', 'mid-word', 'collapsible-around']

// Seven words around one span, with the preserved spaces on the chosen sides of the span's edges.
function placed(placement: Placement, s: string, span: SpanSpec, picked: readonly string[]): TreePart[] {
  const w: string[] = []
  for (let i = 0; i < 7; i++) w.push(picked[i] ?? WORDS[i]!)
  const second = w[1]!
  const third = w[2]!
  switch (placement) {
    case 'in-end': return [leaf(`${w[0]} ${w[1]} `), el(span, leaf(`${w[2]} ${w[3]}${s}`)), leaf(`${w[4]} ${w[5]} ${w[6]}`)]
    case 'in-start': return [leaf(`${w[0]} ${w[1]}`), el(span, leaf(`${s}${w[2]} ${w[3]}`)), leaf(` ${w[4]} ${w[5]} ${w[6]}`)]
    case 'out': return [leaf(`${w[0]} ${w[1]}${s}`), el(span, leaf(`${w[2]} ${w[3]}`)), leaf(`${s}${w[4]} ${w[5]} ${w[6]}`)]
    case 'both': return [leaf(`${w[0]} ${w[1]}${s}`), el(span, leaf(`${s}${w[2]} ${w[3]}${s}`)), leaf(`${s}${w[4]} ${w[5]}`)]
    case 'ws-only': return [leaf(`${w[0]} ${w[1]}`), el(span, leaf(s)), leaf(`${w[2]} ${w[3]}`), el(span, leaf(s + s)), leaf(`${w[4]} ${w[5]}`)]
    case 'mid-word': return [leaf(`${w[0]} ${second.slice(0, 2)}`), el(span, leaf(`${second.slice(2)}${s}${third.slice(0, 3)}`)), leaf(`${third.slice(3)} ${w[3]}${s}${w[4]}`)]
    case 'collapsible-around': return [leaf(`${w[0]} ${w[1]} `), el(span, leaf(` ${w[2]}${s}${w[3]} `)), leaf(` ${w[4]} ${w[5]}`)]
  }
}

function words(rng: Rng): string[] {
  return rng.sample(WORDS, 7)
}

// ---- Families ----

// A pre-wrap block with spans of other fonts, sizes, weights, letter spacing and word spacing.
function fonts(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  for (let k = 0; k < 42; k++) {
    const placement = PLACEMENTS[k % PLACEMENTS.length]!
    const base = font(rng.pick(LATIN), rng.pick([14, 16, 16, 18]))
    const span = variedSpan(rng, base)
    const s = spaces(rng.pick([1, 2, 3, 5]))
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: 'pre-wrap', overflowWrap: rng.pick(['normal', 'break-word', 'break-word', 'anywhere'] as const), letterSpacing: rng.chance(0.15) ? 1 : 0 }
    const parts = placed(placement, s, span, words(rng))
    shapes.push({ block, parts, note: `placement=${placement} spaces=${s.length}`, widths: spread(rng, naturalWidth(block, parts), 3, 0.22, 1.05) })
  }
  // CJK and ideographic spaces in a span of another font.
  for (let k = 0; k < 6; k++) {
    const base = font('Arial', 16)
    const span: SpanSpec = { font: font(rng.pick(['"Hiragino Sans"', '"PingFang SC"']), rng.pick([16, 20])), lang: 'ja' }
    const gap = rng.pick(['　', '  ', ' 　 '])
    const parts = [leaf(`alpha beta${gap}`), el(span, leaf(`日本語${gap}テキスト${gap}`)), leaf(`gamma${gap}delta`)]
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: 'pre-wrap' }
    shapes.push({ block, parts, note: `cjk span gap=${JSON.stringify(gap)}`, widths: spread(rng, naturalWidth(block, parts), 3, 0.25, 1.05) })
  }
  return shapes
}

// A pre-wrap block whose span has margin, border or padding at its edges, with preserved spaces against them.
function boxEdges(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  for (let k = 0; k < 42; k++) {
    const placement = PLACEMENTS[k % PLACEMENTS.length]!
    const base = font(rng.pick(LATIN), 16)
    const edge = edgeSpec(rng)
    const span: SpanSpec = { ...(rng.chance(0.4) ? variedSpan(rng, base) : {}), ...edge.spec, ...(rng.chance(0.15) ? { verticalAlign: '0px' as const } : {}) }
    const s = spaces(rng.pick([1, 2, 4]))
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: 'pre-wrap', overflowWrap: rng.pick(['normal', 'break-word'] as const), direction: rng.chance(0.15) ? 'rtl' : 'ltr' }
    const parts = placed(placement, s, span, words(rng))
    shapes.push({ block, parts, note: `placement=${placement} spaces=${s.length} edge=${edge.label}`, widths: spread(rng, naturalWidth(block, parts), 3, 0.22, 1.05) })
  }
  return shapes
}

// A span that preserves white space inside a block that collapses it.
function spanInNormal(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  for (let k = 0; k < 35; k++) {
    const placement = PLACEMENTS[k % PLACEMENTS.length]!
    const base = font(rng.pick(LATIN), 16)
    const mode = rng.pick(['pre-wrap', 'pre-wrap', 'pre-wrap', 'break-spaces', 'pre'] as const)
    const edge = rng.chance(0.35) ? edgeSpec(rng) : null
    const span: SpanSpec = { ...(rng.chance(0.4) ? variedSpan(rng, base) : {}), ...(edge?.spec ?? {}), whiteSpace: mode }
    const s = spaces(rng.pick([1, 2, 3]))
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: rng.chance(0.15) ? 'pre-line' : 'normal', overflowWrap: rng.pick(['normal', 'break-word'] as const) }
    const parts = placed(placement, s, span, words(rng))
    shapes.push({ block, parts, note: `${mode} span in ${block.whiteSpace} placement=${placement} spaces=${s.length}${edge === null ? '' : ` edge=${edge.label}`}`, widths: spread(rng, naturalWidth(block, parts), 3, 0.22, 1.05) })
  }
  return shapes
}

// A span that collapses white space, or doesn't wrap, inside a pre-wrap block.
function normalInPreWrap(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  for (let k = 0; k < 35; k++) {
    const placement = PLACEMENTS[k % PLACEMENTS.length]!
    const base = font(rng.pick(LATIN), 16)
    const mode = rng.pick(['normal', 'normal', 'normal', 'nowrap', 'pre-line', 'pre'] as const)
    const edge = rng.chance(0.35) ? edgeSpec(rng) : null
    const span: SpanSpec = { ...(rng.chance(0.4) ? variedSpan(rng, base) : {}), ...(edge?.spec ?? {}), whiteSpace: mode }
    const s = spaces(rng.pick([1, 2, 3]))
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: rng.chance(0.15) ? 'break-spaces' : 'pre-wrap', overflowWrap: rng.pick(['normal', 'break-word'] as const) }
    const parts = placed(placement, s, span, words(rng))
    shapes.push({ block, parts, note: `${mode} span in ${block.whiteSpace} placement=${placement} spaces=${s.length}${edge === null ? '' : ` edge=${edge.label}`}`, widths: spread(rng, naturalWidth(block, parts), 3, 0.22, 1.05) })
  }
  return shapes
}

// Tabs at span edges, in spans of another font, size, spacing or tab-size, after a box edge, and in a pre-wrap span of a
// normal block.
function tabs(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  const bodies: ReadonlyArray<readonly [string, (span: SpanSpec) => TreePart[]]> = [
    ['tab-in-end', span => [leaf('ab'), el(span, leaf('cd\t')), leaf('ef gh ij kl')]],
    ['tab-in-start', span => [leaf('ab'), el(span, leaf('\tcd')), leaf('\tef gh ij')]],
    ['tab-only-span', span => [leaf('ab'), el(span, leaf('\t')), leaf('cd\tef gh')]],
    ['tabs-inside', span => [leaf('a\tb'), el(span, leaf('c\td\te')), leaf('\tf g h')]],
    ['tab-after-text-in-span', span => [leaf('ab cd '), el(span, leaf('efg\thi')), leaf('\tjk lm')]],
    ['tab-runs', span => [leaf('a\t\tb'), el(span, leaf('\t\tc\t')), leaf('\td e')]],
    ['tab-space-mix', span => [leaf('ab \t'), el(span, leaf(' \t cd \t')), leaf('\t ef gh')]],
  ]
  for (let k = 0; k < 49; k++) {
    const [label, body] = bodies[k % bodies.length]!
    const base = font(rng.pick(['"Courier New"', 'Arial', 'Menlo', 'Georgia']), rng.pick([14, 16]))
    const variant = rng.pick(['font', 'size', 'letter-spacing', 'tab-size', 'padding', 'margin', 'plain', 'word-spacing'] as const)
    let span: SpanSpec
    switch (variant) {
      case 'font': span = { font: font(rng.pick(LATIN.filter(name => name !== base.family)), base.size) }; break
      case 'size': span = { font: font(base.family, rng.pick([11, 24, 30])) }; break
      case 'letter-spacing': span = { letterSpacing: rng.pick([2, -0.5]) }; break
      case 'word-spacing': span = { wordSpacing: 5 }; break
      case 'tab-size': span = { tabSize: rng.pick([2, 3, 0, 12]) }; break
      case 'padding': span = { start: { padding: rng.pick([7, 3.3]) }, end: { padding: 5 } }; break
      case 'margin': span = { start: { margin: rng.pick([9, -4]) }, end: { border: 2 } }; break
      case 'plain': span = {}; break
    }
    const block: BlockSpec = {
      font: base, lang: 'en', whiteSpace: 'pre-wrap', tabSize: rng.pick([8, 8, 4, 3]), direction: rng.chance(0.12) ? 'rtl' : 'ltr',
      letterSpacing: rng.chance(0.12) ? 1.5 : 0, textIndent: rng.chance(0.1) ? 10 : 0,
    }
    const parts = body(span)
    shapes.push({ block, parts, note: `${label} variant=${variant} tab-size=${block.tabSize}`, widths: spread(rng, naturalWidth(block, parts) * 1.6, 3, 0.2, 1.05) })
  }
  // A pre-wrap span with tabs inside a normal block, and a normal span whose tabs collapse inside a pre-wrap block.
  for (let k = 0; k < 12; k++) {
    const base = font(rng.pick(['Arial', '"Courier New"', 'Georgia']), 16)
    const inner = k % 2 === 0
    const span: SpanSpec = {
      whiteSpace: inner ? 'pre-wrap' : 'normal', ...(rng.chance(0.5) ? { tabSize: rng.pick([2, 4]) } : {}), ...(rng.chance(0.5) ? { font: font(rng.pick(['Menlo', 'Verdana']), rng.pick([12, 20])) } : {}),
      ...(rng.chance(0.3) ? { start: { padding: 6 } } : {}),
    }
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: inner ? 'normal' : 'pre-wrap', tabSize: 8 }
    const parts = [leaf('ab cd\t'), el(span, leaf('e\tf\tgh\t')), leaf('\tij kl mn')]
    shapes.push({ block, parts, note: `${span.whiteSpace} span with tabs in ${block.whiteSpace}`, widths: spread(rng, naturalWidth(block, parts) * 1.4, 3, 0.2, 1.05) })
  }
  return shapes
}

// Preserved newlines at span edges, newline-only spans, spaces on both sides of a newline, nested spans.
function newlines(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  const bodies: ReadonlyArray<readonly [string, (span: SpanSpec, other: SpanSpec) => TreePart[]]> = [
    ['newline-in-end', span => [leaf('alpha beta '), el(span, leaf('gamma\n')), leaf('delta epsilon')]],
    ['newline-in-start', span => [leaf('alpha'), el(span, leaf('\nbeta gamma')), leaf(' delta')]],
    ['newline-only-span', span => [leaf('alpha beta'), el(span, leaf('\n')), leaf('gamma delta')]],
    ['spaces-before-newline', span => [leaf('alpha'), el(span, leaf(' beta   \n')), leaf('gamma delta')]],
    ['spaces-after-newline', span => [leaf('alpha\n'), el(span, leaf('   beta')), leaf(' gamma delta')]],
    ['newline-both-sides', span => [leaf('alpha\n'), el(span, leaf('\nbeta\n')), leaf('\ngamma')]],
    ['nested', (span, other) => [el(span, leaf('alpha '), el(other, leaf('beta  \n')), leaf('  gamma')), leaf(' delta')]],
    ['crlf', span => [leaf('alpha '), el(span, leaf('beta\r\n')), leaf('gamma\r'), el(span, leaf('\ndelta'))]],
    ['trailing-newline', span => [leaf('alpha beta '), el(span, leaf('gamma  \n'))]],
    ['empty-lines-in-span', span => [leaf('alpha'), el(span, leaf('\n\n  \n')), leaf('beta')]],
  ]
  for (let k = 0; k < 40; k++) {
    const [label, body] = bodies[k % bodies.length]!
    const base = font(rng.pick(LATIN), 16)
    const edge = rng.chance(0.5) ? edgeSpec(rng) : null
    const span: SpanSpec = { ...(rng.chance(0.5) ? variedSpan(rng, base) : {}), ...(edge?.spec ?? {}) }
    const other: SpanSpec = { ...variedSpan(rng, base), ...(rng.chance(0.5) ? { end: { padding: 4 } } : {}) }
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: 'pre-wrap', direction: rng.chance(0.12) ? 'rtl' : 'ltr', textAlign: rng.pick(['start', 'start', 'start', 'end', 'center', 'justify'] as const) }
    const parts = body(span, other)
    shapes.push({ block, parts, note: `${label}${edge === null ? '' : ` edge=${edge.label}`} align=${block.textAlign}`, widths: spread(rng, naturalWidth(block, parts), 2, 0.4, 1.3) })
  }
  // A preserving span with a newline inside a collapsing block, and a pre-line span in a pre-wrap block.
  for (let k = 0; k < 10; k++) {
    const base = font(rng.pick(LATIN), 16)
    const inner = k % 2 === 0
    const span: SpanSpec = { whiteSpace: inner ? rng.pick(['pre-wrap', 'pre-wrap', 'pre'] as const) : 'pre-line', ...(rng.chance(0.4) ? { end: { padding: 5 } } : {}) }
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: inner ? 'normal' : 'pre-wrap' }
    const parts = [leaf('alpha beta  '), el(span, leaf(rng.pick(['gam\nma  ', '  gamma\n', '\n  gamma', 'gamma  \n  zeta']))), leaf('  delta epsilon')]
    shapes.push({ block, parts, note: `${span.whiteSpace} span with a newline in ${block.whiteSpace}`, widths: spread(rng, naturalWidth(block, parts), 2, 0.4, 1.3) })
  }
  return shapes
}

// A line that ends in preserved spaces inside a span: the widths sweep around the point where the spaces pass the edge.
function trailingSpaces(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  const bodies: ReadonlyArray<readonly [string, (span: SpanSpec, s: string) => TreePart[]]> = [
    ['spaces-end-span', (span, s) => [leaf('alpha beta '), el(span, leaf(`gamma${s}`)), leaf('delta epsilon')]],
    ['spaces-straddle', (span, s) => [leaf('alpha beta '), el(span, leaf(`gamma${s}`)), leaf(`${s}delta epsilon`)]],
    ['spaces-after-span', (span, s) => [leaf('alpha beta '), el(span, leaf('gamma')), leaf(`${s}delta epsilon`)]],
    ['spaces-own-span', (span, s) => [leaf('alpha beta gamma'), el(span, leaf(s)), leaf('delta epsilon')]],
    ['spaces-nested-end', (span, s) => [leaf('alpha beta '), el(span, leaf('ga'), el({ end: { padding: 3 } }, leaf(`mma${s}`))), leaf('delta epsilon')]],
  ]
  for (let k = 0; k < 40; k++) {
    const [label, body] = bodies[k % bodies.length]!
    const base = font(rng.pick(['Arial', '"Courier New"', 'Georgia', '"Times New Roman"', 'Menlo']), 16)
    const variant = rng.pick(['plain', 'big-font', 'letter-spacing', 'word-spacing', 'end-padding', 'end-negative-margin', 'border', 'both-padding'] as const)
    let span: SpanSpec
    switch (variant) {
      case 'plain': span = {}; break
      case 'big-font': span = { font: font(base.family, 26) }; break
      case 'letter-spacing': span = { letterSpacing: 2 }; break
      case 'word-spacing': span = { wordSpacing: 4 }; break
      case 'end-padding': span = { end: { padding: 6 } }; break
      case 'end-negative-margin': span = { end: { margin: -3 } }; break
      case 'border': span = { start: { border: 2 }, end: { border: 2 } }; break
      case 'both-padding': span = { start: { padding: 4.5 }, end: { padding: 4.5 } }; break
    }
    const s = spaces(rng.pick([1, 3, 8, 20]))
    const block: BlockSpec = {
      font: base, lang: 'en', whiteSpace: rng.chance(0.12) ? 'break-spaces' : 'pre-wrap', direction: rng.chance(0.15) ? 'rtl' : 'ltr',
      textAlign: rng.pick(['start', 'start', 'start', 'end', 'center', 'justify', 'right'] as const), overflowWrap: rng.pick(['normal', 'break-word'] as const),
    }
    const parts = body(span, s)
    const threshold = estimateTextWidth('alpha beta gamma', base) + edgesWidth(parts)
    shapes.push({ block, parts, note: `${label} variant=${variant} spaces=${s.length} align=${block.textAlign} ${block.whiteSpace}`, widths: spread(rng, threshold, 4, 0.75, 1.35) })
  }
  return shapes
}

// Bidi content: spans of the other direction in a pre-wrap block, with preserved spaces, tabs and newlines at the
// direction boundaries and at line ends.
function bidi(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  const hebrew = ['שלום', 'עולם', 'בדיקה', 'אחת', 'נוספת']
  const arabic = ['مرحبا', 'بالعالم', 'السلام', 'عليكم']
  const bodies: ReadonlyArray<readonly [string, (span: SpanSpec, r: readonly string[], s: string) => TreePart[]]> = [
    ['rtl-span-spaces-inside', (span, r, s) => [leaf(`alpha beta${s}`), el(span, leaf(`${r[0]}${s}${r[1]}${s}`)), leaf('gamma delta')]],
    ['rtl-span-spaces-outside', (span, r, s) => [leaf(`alpha beta${s}`), el(span, leaf(`${r[0]} ${r[1]}`)), leaf(`${s}gamma delta`)]],
    ['rtl-span-tab', (span, r) => [leaf('alpha\t'), el(span, leaf(`${r[0]}\t${r[1]}`)), leaf('\tgamma delta')]],
    ['rtl-span-newline', (span, r, s) => [leaf('alpha '), el(span, leaf(`${r[0]}${s}\n${r[1]} ${r[2]}`)), leaf(`${s}gamma`)]],
    ['rtl-text-latin-span', (span, r, s) => [leaf(`${r[0]} ${r[1]}${s}`), el(span, leaf(`alpha${s}beta${s}`)), leaf(`${r[2]} ${r[3] ?? r[0]}`)]],
    ['rtl-trailing-spaces', (span, r, s) => [leaf(`${r[0]} `), el(span, leaf(`${r[1]}${s}${s}`)), leaf(`${r[2]} alpha`)]],
  ]
  for (let k = 0; k < 36; k++) {
    const [label, body] = bodies[k % bodies.length]!
    const useArabic = rng.chance(0.4)
    const rtlWords = rng.sample(useArabic ? arabic : hebrew, 4)
    const rtlFont = useArabic ? font(rng.pick(['"Geeza Pro"', 'Arial']), 18) : font(rng.pick(['Arial', '"Times New Roman"']), 16)
    const latinSpan = label === 'rtl-text-latin-span'
    const base = latinSpan ? rtlFont : font(rng.pick(['Arial', 'Georgia', '"Times New Roman"']), 16)
    const edge = rng.chance(0.35) ? edgeSpec(rng) : null
    const span: SpanSpec = { font: latinSpan ? font(rng.pick(['Georgia', 'Verdana']), 15) : rtlFont, lang: latinSpan ? 'en' : useArabic ? 'ar' : 'he', ...(edge?.spec ?? {}) }
    const direction = latinSpan ? (rng.chance(0.8) ? 'rtl' : 'ltr') : (rng.chance(0.3) ? 'rtl' : 'ltr')
    const block: BlockSpec = { font: base, lang: latinSpan ? (useArabic ? 'ar' : 'he') : 'en', whiteSpace: 'pre-wrap', direction, textAlign: rng.pick(['start', 'start', 'end', 'center'] as const) }
    const parts = body(span, rtlWords, spaces(rng.pick([1, 2, 3])))
    shapes.push({ block, parts, note: `${label} ${useArabic ? 'arabic' : 'hebrew'} block=${direction}${edge === null ? '' : ` edge=${edge.label}`} align=${block.textAlign}`, widths: spread(rng, naturalWidth(block, parts), 3, 0.3, 1.05) })
  }
  return shapes
}

// Widths below a word, a space or a box edge.
function narrow(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  const bodies: ReadonlyArray<readonly [string, (span: SpanSpec) => TreePart[]]> = [
    ['words', span => [leaf('ab  '), el(span, leaf('cd  ef  ')), leaf('gh')]],
    ['spaces-only', span => [el(span, leaf('   ')), leaf('  '), el(span, leaf(' \t '))]],
    ['space-then-word', span => [leaf('  '), el(span, leaf('  ab')), leaf('  cd  ')]],
    ['tabs', span => [leaf('a\t'), el(span, leaf('\tb\t')), leaf('c')]],
    ['newline', span => [leaf('ab '), el(span, leaf(' \n ')), leaf(' cd')]],
    ['long-word', span => [leaf('abcdef'), el(span, leaf('ghij  klmnop')), leaf('  qr')]],
  ]
  for (let k = 0; k < 30; k++) {
    const [label, body] = bodies[k % bodies.length]!
    const base = font(rng.pick(['Arial', '"Courier New"', 'Georgia']), 16)
    const variant = rng.pick(['plain', 'padding', 'wide-padding', 'big-font', 'margin', 'letter-spacing'] as const)
    let span: SpanSpec
    switch (variant) {
      case 'plain': span = {}; break
      case 'padding': span = { start: { padding: 4 }, end: { padding: 4 } }; break
      case 'wide-padding': span = { start: { padding: 30 }, end: { padding: 30 } }; break
      case 'big-font': span = { font: font(base.family, 28) }; break
      case 'margin': span = { start: { margin: 12 }, end: { margin: -5 } }; break
      case 'letter-spacing': span = { letterSpacing: 3 }; break
    }
    const block: BlockSpec = {
      font: base, lang: 'en', whiteSpace: rng.chance(0.15) ? 'break-spaces' : 'pre-wrap', overflowWrap: rng.pick(['normal', 'anywhere', 'break-word'] as const),
      wordBreak: rng.chance(0.15) ? 'break-all' : 'normal', direction: rng.chance(0.1) ? 'rtl' : 'ltr',
    }
    shapes.push({ block, parts: body(span), note: `${label} variant=${variant} ${block.whiteSpace} ${block.overflowWrap}`, widths: rng.sample([0, 1, 4, 9, 15, 22, 31.5], 4) })
  }
  return shapes
}

// Modes nested three deep, and atomic inlines, <br> and <wbr> among preserved spaces inside spans.
function nested(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  const bodies: ReadonlyArray<readonly [string, Paragraph['whiteSpace'], (a: SpanSpec, b: SpanSpec) => TreePart[]]> = [
    ['pre-wrap>normal>pre-wrap', 'pre-wrap', (a, b) => [leaf('alpha  '), el({ ...a, whiteSpace: 'normal' }, leaf('  beta  '), el({ ...b, whiteSpace: 'pre-wrap' }, leaf('  gamma  ')), leaf('  delta  ')), leaf('  epsilon')]],
    ['normal>pre-wrap>normal', 'normal', (a, b) => [leaf('alpha  '), el({ ...a, whiteSpace: 'pre-wrap' }, leaf('  beta  '), el({ ...b, whiteSpace: 'normal' }, leaf('  gamma  ')), leaf('  delta  ')), leaf('  epsilon')]],
    ['pre-wrap>break-spaces', 'pre-wrap', (a, b) => [leaf('alpha beta  '), el({ ...a, whiteSpace: 'break-spaces' }, leaf('gamma    '), el(b, leaf('delta    '))), leaf('epsilon  zeta')]],
    ['break-spaces>pre-wrap', 'break-spaces', (a, b) => [leaf('alpha beta  '), el({ ...a, whiteSpace: 'pre-wrap' }, leaf('gamma    '), el(b, leaf('delta    '))), leaf('epsilon  zeta')]],
    ['pre-wrap>pre', 'pre-wrap', (a, b) => [leaf('alpha  beta  '), el({ ...a, whiteSpace: 'pre' }, leaf('gamma  delta  '), el(b, leaf('eta'))), leaf('  epsilon  zeta')]],
    ['pre-wrap>nowrap', 'pre-wrap', (a, b) => [leaf('alpha  beta  '), el({ ...a, whiteSpace: 'nowrap' }, leaf('gamma  delta  '), el(b, leaf('eta  '))), leaf('  epsilon  zeta')]],
    ['atomic-among-spaces', 'pre-wrap', (a, b) => [leaf('alpha  '), el(a, leaf('beta  '), atomic(18, 14, 2, 2), leaf('  gamma')), leaf('  '), el(b, atomic(10, 10), leaf('  delta'))]],
    ['br-after-spaces', 'pre-wrap', (a, b) => [leaf('alpha '), el(a, leaf('beta   '), br(), leaf('   gamma')), el(b, leaf('  '), br()), leaf('delta')]],
    ['wbr-among-spaces', 'pre-wrap', (a, b) => [leaf('alpha'), el(a, leaf('beta'), wbr(), leaf('  gamma  '), wbr()), el(b, leaf('delta')), wbr(), leaf('  epsilon')]],
  ]
  for (let k = 0; k < 36; k++) {
    const [label, mode, body] = bodies[k % bodies.length]!
    const base = font(rng.pick(LATIN), 16)
    const a: SpanSpec = { ...(rng.chance(0.5) ? variedSpan(rng, base) : {}), ...(rng.chance(0.4) ? edgeSpec(rng).spec : {}) }
    const b: SpanSpec = { ...(rng.chance(0.5) ? variedSpan(rng, base) : {}), ...(rng.chance(0.4) ? edgeSpec(rng).spec : {}) }
    const block: BlockSpec = { font: base, lang: 'en', whiteSpace: mode, overflowWrap: rng.pick(['normal', 'break-word'] as const) }
    const parts = body(a, b)
    shapes.push({ block, parts, note: label, widths: spread(rng, naturalWidth(block, parts), 3, 0.22, 1.05) })
  }
  return shapes
}

// Line slots: floats narrow the first rows while spans hold tabs and preserved spaces that hang. One font family and size
// per paragraph, so every line box keeps the line height and the slot floats stay in their rows. Widths stay above the
// widest row of insets plus the indent, the floor the engines' float rules need (rebuild/tests/derive.ts minimumUnits).
function slots(rng: Rng): Shape[] {
  const shapes: Shape[] = []
  const bodies: ReadonlyArray<readonly [string, (span: SpanSpec) => TreePart[]]> = [
    ['tabs', span => [leaf('ab\tcd '), el(span, leaf('ef\tgh\t')), leaf('ij kl\tmn op qr')]],
    ['hanging-in-span', span => [leaf('alpha beta '), el(span, leaf('gamma    ')), leaf('delta epsilon   '), el(span, leaf('zeta    ')), leaf('eta theta')]],
    ['spaces-own-span', span => [leaf('alpha beta'), el(span, leaf('      ')), leaf('gamma delta'), el(span, leaf('   ')), leaf('epsilon zeta eta')]],
    ['newline-in-span', span => [leaf('alpha '), el(span, leaf('beta  \n  gamma')), leaf(' delta epsilon zeta')]],
    ['tab-after-edge', span => [leaf('a'), el(span, leaf('\tb\tc ')), leaf('\td e f g h i j')]],
  ]
  for (let k = 0; k < 25; k++) {
    const [label, body] = bodies[k % bodies.length]!
    const base = font(rng.pick(['Arial', '"Courier New"', 'Georgia', 'Menlo']), 16)
    const variant = rng.pick(['plain', 'padding', 'margin', 'letter-spacing', 'tab-size', 'border'] as const)
    let span: SpanSpec
    switch (variant) {
      case 'plain': span = {}; break
      case 'padding': span = { start: { padding: 5 }, end: { padding: 5 } }; break
      case 'margin': span = { start: { margin: 7 }, end: { margin: -3 } }; break
      case 'letter-spacing': span = { letterSpacing: 1.5 }; break
      case 'tab-size': span = { tabSize: 3 }; break
      case 'border': span = { start: { border: 2 }, end: { border: 2 } }; break
    }
    const inset = rng.pick([24, 37.3, 40])
    const shape = rng.pick(['uniform', 'decreasing', 'increasing'] as const)
    const rows = shape === 'uniform' ? [inset, inset, inset] : shape === 'decreasing' ? [2 * inset, inset, inset] : [inset, 2 * inset, inset]
    const sides = rng.pick(['left', 'right', 'both'] as const)
    const lineSlots = rows.map(row => ({ left: sides === 'right' ? 0 : row, right: sides === 'left' ? 0 : row }))
    const textIndent = rng.chance(0.25) ? 10 : 0
    const block: BlockSpec = {
      font: base, lang: 'en', whiteSpace: 'pre-wrap', tabSize: rng.pick([8, 4]), direction: rng.chance(0.2) ? 'rtl' : 'ltr', lineSlots, textIndent,
      textAlign: rng.pick(['start', 'start', 'end', 'center'] as const), lineHeight: 32,
    }
    const floor = Math.max(...lineSlots.map(slot => slot.left + slot.right)) + textIndent + 40
    const parts = body(span)
    const widths = spread(rng, naturalWidth(block, parts), 3, 0.35, 0.9).map(width => Math.max(width, floor + rng.int(30)))
    shapes.push({ block, parts, note: `${label} variant=${variant} slots=${shape}/${sides}/${inset} indent=${textIndent} align=${block.textAlign}`, widths: [...new Set(widths)] })
  }
  return shapes
}

const FAMILIES: ReadonlyArray<readonly [string, (rng: Rng) => Shape[]]> = [
  ['fonts', fonts], ['box-edges', boxEdges], ['span-in-normal', spanInNormal], ['normal-in-pre-wrap', normalInPreWrap], ['tabs', tabs],
  ['newlines', newlines], ['trailing-spaces', trailingSpaces], ['bidi', bidi], ['narrow', narrow], ['nested', nested], ['slots', slots],
]

export function generateRichPreWrap(seed: string): Case[] {
  const cases: Case[] = []
  for (let f = 0; f < FAMILIES.length; f++) {
    const [name, build] = FAMILIES[f]!
    const family = `rich-prewrap/${name}`
    const shapes = build(createRng(`${seed}/${family}`))
    for (let s = 0; s < shapes.length; s++) {
      const shape = shapes[s]!
      const tree: { paragraph: Paragraph; inline: InlineStructure } = treeParagraph(shape.block, shape.parts)
      for (let w = 0; w < shape.widths.length; w++) {
        cases.push(makeCase({
          family, origin: `generator=${family} seed=${seed} shape=${s + 1} ${shape.note}`, pageLang: 'en',
          paragraph: { ...tree.paragraph, width: shape.widths[w]! }, inline: tree.inline,
        }))
      }
    }
  }
  return sortCases(mergeCases(cases))
}

if (import.meta.main) {
  let seed = 'rich-prewrap-20260918'
  let out = resolve(import.meta.dir, '../../../.artifacts/prewrap-20260918/cases/rich-prewrap.ndjson')
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--seed=')) seed = arg.slice(7)
    else if (arg.startsWith('--out=')) out = resolve(arg.slice(6))
    else throw new Error(`Unknown argument ${arg}; usage: bun rebuild/lab/cases/rich-prewrap.ts [--seed=S] [--out=FILE]`)
  }
  const cases = generateRichPreWrap(seed)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, cases.map(value => `${JSON.stringify(value)}\n`).join(''))
  const families = countFamilies(cases)
  writeFileSync(`${out.replace(/\.ndjson$/, '')}.summary.json`, `${JSON.stringify({ file: out, cases: cases.length, seed, families }, null, 2)}\n`)
  console.log(`${out}: ${cases.length} cases`)
  console.log(JSON.stringify(families, null, 2))
}
