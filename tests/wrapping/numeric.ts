import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LayoutLineRange } from '../../src/layout.ts'
import type { ContractFailure } from './contracts.ts'

type Recipe = { name: string; text: (size: number) => string; whiteSpace: 'normal' | 'pre-wrap' }
type Counts = { measureCalls: number; submittedUTF16: number; maxSubmittedUTF16: number }
type NumericRow = {
  recipe: string; size: number; letterSpacing: number; sourceUTF16: number
  preparation: Counts
  passedContracts: Array<{ contract: string; width: number | 'unbounded' }>
  failures: Array<ContractFailure & { width: number | 'unbounded' }>
}

function flag(name: string): string {
  const argument = process.argv.find(value => value.startsWith(`--${name}=`))
  if (argument === undefined) throw new Error(`Missing --${name}=...`)
  return argument.slice(name.length + 3)
}

const source = resolve(flag('source'))
const profileValue = flag('profile')
const profiles = [
  { name: 'chrome', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36', vendor: 'Google Inc.' },
  { name: 'safari', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15', vendor: 'Apple Computer, Inc.' },
  { name: 'firefox', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0', vendor: '' },
  { name: 'crios', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/152.0 Mobile/15E148 Safari/604.1', vendor: 'Apple Computer, Inc.' },
  { name: 'crios-desktop', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_5) AppleWebKit/605.1.15 CriOS/152 Version/11.1.1 Safari/605.1.15', vendor: 'Apple Computer, Inc.' },
  { name: 'fxios', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/143.0 Mobile/15E148 Safari/605.1.15', vendor: 'Apple Computer, Inc.' },
  { name: 'edgios', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/143.0 Mobile/15E148 Safari/605.1.15', vendor: 'Apple Computer, Inc.' },
  { name: 'unknown', userAgent: 'Unknown runtime', vendor: '' },
  { name: 'none', userAgent: null, vendor: '' },
] as const
const profile = profiles.find(item => item.name === profileValue)
if (profile === undefined) throw new Error(`Unknown browser profile ${profileValue}`)
const output = resolve(flag('output'))

let phase: 'prepare' | 'numeric' | 'materialize' = 'prepare'
let counts: Counts = { measureCalls: 0, submittedUTF16: 0, maxSubmittedUTF16: 0 }
let forbiddenMeasurement = false
let advances = { space: 4, tab: 8, other: 8 }
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
class TestCanvas {
  font = '16px Probe'
  textRendering = 'auto'
  letterSpacing = '0px'

  measureText(text: string): { width: number } {
    if (phase !== 'prepare') {
      forbiddenMeasurement = true
      throw new Error(`Canvas called during ${phase}`)
    }
    counts.measureCalls++
    counts.submittedUTF16 += text.length
    counts.maxSubmittedUTF16 = Math.max(counts.maxSubmittedUTF16, text.length)
    let width = 0
    for (const character of text) {
      if (/[\p{M}\u00AD\u200B\u2060\uFEFF]/u.test(character)) continue
      width += character === ' ' ? advances.space : character === '\t' ? advances.tab : advances.other
    }
    const spacing = Number.parseFloat(this.letterSpacing)
    const tracking = spacing === 0 ? 0 : Array.from(graphemes.segment(text)).length * spacing
    const contextWidth = spacing !== 0 && this.textRendering === 'optimizeLegibility' ? 2 : 0
    return { width: width * Number.parseFloat(this.font) / 16 + tracking + contextWidth }
  }
}

// This subprocess owns its test globals. No native browser prototypes or
// production code are replaced. The selected user agent exercises profile
// branches; these invented widths are not browser-accuracy measurements.
if (profile.userAgent === null) {
  if (!Reflect.deleteProperty(globalThis, 'navigator')) throw new Error('Could not remove navigator for the browserless profile')
} else {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: profile.userAgent, vendor: profile.vendor }, configurable: true,
  })
}
Object.defineProperty(globalThis, 'OffscreenCanvas', {
  value: class { getContext(): TestCanvas { return new TestCanvas() } }, configurable: true,
})
const api = await import(pathToFileURL(resolve(source, 'layout.ts')).href) as typeof import('../../src/layout.ts')
const rich = await import(pathToFileURL(resolve(source, 'rich-inline.ts')).href) as typeof import('../../src/rich-inline.ts')
const measurement = await import(pathToFileURL(resolve(source, 'measurement.ts')).href) as typeof import('../../src/measurement.ts')

const recipes: Recipe[] = [
  { name: 'latin-url', text: size => `https://example.com/${'alpha-b/'.repeat(size)}?q=end`, whiteSpace: 'normal' },
  { name: 'arabic-openers', text: size => 'بِبِ((tail '.repeat(size), whiteSpace: 'normal' },
  { name: 'cjk-openers', text: size => '「「tail 世界 '.repeat(size), whiteSpace: 'normal' },
  { name: 'controls', text: size => 'alpha\u00ADbeta\u200Bgamma '.repeat(size), whiteSpace: 'normal' },
  { name: 'entry-controls', text: size => 'a\u2060\u0301bc '.repeat(size), whiteSpace: 'normal' },
  { name: 'long-word', text: size => 'abcdefghij'.repeat(size), whiteSpace: 'normal' },
  { name: 'long-grapheme', text: size => `a${'\u0301'.repeat(size)}`.repeat(8), whiteSpace: 'normal' },
  { name: 'tabs', text: size => 'a\t\t\u200Bb\n'.repeat(size), whiteSpace: 'pre-wrap' },
]

const rows: NumericRow[] = []
// Exercise both source-size extremes at every spacing sign, plus an ordinary
// middle size. These are API/no-Canvas checks, not a preparation benchmark.
const preparations = [[1, -1], [1, 0], [1, 1], [16, 0], [512, -1], [512, 0], [512, 1]] as const
for (const recipe of recipes) for (const [size, letterSpacing] of preparations) {
  const text = recipe.text(size)
  const options = { whiteSpace: recipe.whiteSpace, letterSpacing }
  phase = 'prepare'
  counts = { measureCalls: 0, submittedUTF16: 0, maxSubmittedUTF16: 0 }
  api.clearCache()
  const opaque = api.prepare(text, '16px Probe', options)
  const prepared = api.prepareWithSegments(text, '16px Probe', options)
  const preparedRich = rich.prepareRichInline([{ text, font: '16px Probe', letterSpacing }])
  const row: NumericRow = { recipe: recipe.name, size, letterSpacing, sourceUTF16: text.length, preparation: { ...counts }, passedContracts: [], failures: [] }
  for (const width of [1, 27.86, 96, Number.POSITIVE_INFINITY]) {
    const widthLabel = Number.isFinite(width) ? width : 'unbounded'
    phase = 'numeric'
    forbiddenMeasurement = false
    try {
      const counted = api.layout(opaque, width, 20)
      const stats = api.measureLineStats(prepared, width)
      const ranges: LayoutLineRange[] = []
      api.walkLineRanges(prepared, width, range => {
        if (ranges.length > text.length + 1) throw new Error('Range walker did not terminate')
        ranges.push(range)
      })
      const streamed: LayoutLineRange[] = []
      let cursor = { segmentIndex: 0, graphemeIndex: 0 }
      for (let i = 0; i <= text.length + 1; i++) {
        const range = api.layoutNextLineRange(prepared, cursor, width)
        if (range === null) break
        streamed.push(range)
        cursor = { ...range.end }
        if (i === text.length + 1) throw new Error('Range streaming did not terminate')
      }
      if (counted.lineCount !== ranges.length || stats.lineCount !== ranges.length || JSON.stringify(ranges) !== JSON.stringify(streamed)) {
        row.failures.push({ contract: 'numeric/api-agreement', detail: 'Count, stats, walked ranges, and streamed ranges disagree', width: widthLabel })
      } else {
        row.passedContracts.push({ contract: 'numeric/api-agreement', width: widthLabel })
      }
      rich.measureRichInlineStats(preparedRich, width)
      let richLines = 0
      rich.walkRichInlineLineRanges(preparedRich, width, () => {
        if (richLines++ > text.length + 1) throw new Error('Rich range walker did not terminate')
      })
      if (forbiddenMeasurement) throw new Error('Canvas called during numeric layout')
      row.passedContracts.push({ contract: 'numeric/no-canvas', width: widthLabel }, { contract: 'numeric/completion', width: widthLabel })
      phase = 'materialize'
      for (const range of ranges) api.materializeLineRange(prepared, range)
      if (forbiddenMeasurement) throw new Error('Canvas called during materialization')
      row.passedContracts.push({ contract: 'materialize/no-canvas', width: widthLabel }, { contract: 'materialize/completion', width: widthLabel })
    } catch (error) {
      for (let i = row.passedContracts.length - 1; i >= 0; i--) {
        const result = row.passedContracts[i]!
        if (result.width === widthLabel && result.contract.startsWith(`${phase}/`)) row.passedContracts.splice(i, 1)
      }
      const detail = error instanceof Error ? error.message : String(error)
      row.failures.push({ contract: `${phase}/completion`, detail, width: widthLabel })
      if (forbiddenMeasurement) row.failures.push({ contract: `${phase}/no-canvas`, detail, width: widthLabel })
    }
  }
  if (recipe.name === 'entry-controls' && size === 1 && letterSpacing === -1) {
    // Replacing an observation must not alter a held handle or its JSON copy.
    // A changed synthetic context affects only fresh, tracked measurements.
    const context = measurement.getMeasureContext()
    const originalRendering = context.textRendering
    const saved = JSON.stringify(prepared)
    const copied = JSON.parse(saved) as typeof prepared
    const result = (value: typeof prepared) => {
      phase = 'numeric'
      return JSON.stringify([1, 8, 27].map(width => api.layoutWithLines(value, width, 20)))
    }
    const original = result(prepared)
    try {
      phase = 'prepare'
      const positive = api.prepareWithSegments(text, '16px Probe', { ...options, letterSpacing: 1 })
      api.clearCache()
      const positiveCold = api.prepareWithSegments(text, '16px Probe', { ...options, letterSpacing: 1 })
      if (result(positive) !== result(positiveCold)) throw new Error('Cached geometry ignored the letter spacing')
      phase = 'prepare'
      const replaced = api.prepareWithSegments(text, '16px Probe', options)
      if (result(replaced) !== original) throw new Error('Spacing replacement changed matching preparation')
      context.textRendering = 'optimizeLegibility'
      phase = 'prepare'
      const changed = api.prepareWithSegments(text, '16px Probe', options)
      api.clearCache()
      const cold = api.prepareWithSegments(text, '16px Probe', options)
      if (result(changed) !== result(cold)) throw new Error('Cached geometry ignored the measurement context')
      if (JSON.stringify(prepared) !== saved || result(prepared) !== original || result(copied) !== original) {
        throw new Error('Replacing cached geometry changed a held or copied preparation')
      }
      row.passedContracts.push({ contract: 'numeric/cache-lifetime', width: 'unbounded' })
    } catch (error) {
      row.failures.push({ contract: 'numeric/cache-lifetime', width: 'unbounded', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      context.textRendering = originalRendering
    }
  }
  rows.push(row)
}

const sourceHashes = Object.fromEntries(
  readdirSync(source, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.ts')).sort().map(file => [
    file, createHash('sha256').update(readFileSync(resolve(source, file))).digest('hex'),
  ]),
)
// Preserve the original cross-profile TAB counterexamples as public outputs.
// Unverified profiles can compare these against main; installed desktop
// browser correctness is established separately with native observations.
const tabSizing = []
phase = 'prepare'
advances = { space: 16 * 0.33, tab: 16 * 1.32, other: 16 * 0.6 }
api.clearCache()
for (const fontSize of [16, 50]) for (const letterSpacing of [-4, -1, 0, 1, 4]) {
  for (const text of ['\t', '\tB', 'A\t', 'A\tB', 'A\t\tB', 'A\n\tB', ' \tB', 'A \tB']) {
    const prepared = api.prepareWithSegments(text, `${fontSize}px Probe`, { whiteSpace: 'pre-wrap', letterSpacing })
    const lines = api.layoutWithLines(prepared, 10000, 20).lines.map(line => ({ text: line.text, width: line.width }))
    tabSizing.push({ fontSize, letterSpacing, text, lines })
  }
}
mkdirSync(dirname(output), { recursive: true })
await Bun.write(output, JSON.stringify({
  schemaVersion: 1, source, profile: profile.name, sourceHashes,
  scope: 'Synthetic Canvas call topology and numeric API consistency. Not native shaping, elapsed performance, or proof of no Intl/string work.',
  rows, tabSizing,
}, null, 2))
console.log(`${profile.name}: ${rows.length} numeric preparations; ${rows.reduce((sum, row) => sum + row.failures.length, 0)} failures; wrote ${output}`)
