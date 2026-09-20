// Reads one CPU profile that tools/js-profile.ts wrote and prints where the time went: inside Canvas and outside it, the
// port's own JavaScript by source file and by function (self time), and the functions by the time under them.
//
//   bun rebuild/tools/js-profile-report.ts <name>.cpuprofile --lib=<out>/lib-<label>.js [--top=25] [--messages=10000]
//
// A sample's time is its timeDelta, and a node's self time the sum over its samples. V8 gives a native callback a node of
// its own with an empty url: measureText, a context's setters ("set font") and TextMetrics' getters ("get width") are
// Canvas; any other native (a string or array builtin V8 didn't inline, Intl.Segmenter) is counted with the nearest
// JavaScript function above it, as that function's own work, and listed by itself too. "(garbage collector)" and
// "(program)" hang off the root, so no function can be charged for them. A function's source file is read from the
// bundle's module comments.
import { readFileSync } from 'node:fs'

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }
type Profile = { nodes: Node[]; samples: number[]; timeDeltas: number[] }

const flags = new Map<string, string>()
let file = ''
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) file = raw
  else flags.set(match[1]!, match[2]!)
}
if (file === '' || !flags.has('lib')) throw new Error('<name>.cpuprofile --lib=<bundle>')
const top = Number(flags.get('top') ?? 25)
const messages = Number(flags.get('messages') ?? 10000)
const profile = JSON.parse(readFileSync(file, 'utf8')) as Profile
const bundle = readFileSync(flags.get('lib')!, 'utf8').split('\n')

// Bundle line (0-based) to the module it came from.
const moduleOfLine: string[] = []
let current = '(bundle)'
for (let i = 0; i < bundle.length; i++) {
  const marker = /^\s*\/\/ (?:\S*\/)?rebuild\/(\S+\.ts)$/.exec(bundle[i]!)
  if (marker !== null) current = marker[1]!
  moduleOfLine.push(current)
}

const CANVAS = /^(measureText|getContext|OffscreenCanvas|(get|set) (width|actualBoundingBoxLeft|actualBoundingBoxRight|font|lang|letterSpacing|wordSpacing|fontKerning|textRendering|direction))$/
const SPECIAL = ['(root)', '(program)', '(idle)', '(garbage collector)']

type Kind = 'canvas' | 'special' | 'native' | 'js'
const nodes = new Map<number, Node>()
const parent = new Map<number, number>()
for (let i = 0; i < profile.nodes.length; i++) {
  const node = profile.nodes[i]!
  nodes.set(node.id, node)
  const children = node.children ?? []
  for (let c = 0; c < children.length; c++) parent.set(children[c]!, node.id)
}
function kindOf(node: Node): Kind {
  const name = node.callFrame.functionName
  if (SPECIAL.includes(name)) return 'special'
  if (node.callFrame.url !== '') return 'js'
  return CANVAS.test(name) ? 'canvas' : 'native'
}
function keyOf(node: Node): string {
  const frame = node.callFrame
  switch (kindOf(node)) {
    case 'special': return frame.functionName
    case 'canvas': return `Canvas: ${frame.functionName}`
    case 'native': return `native: ${frame.functionName}`
    case 'js': return /\/lib-\d+\.js$/.test(frame.url) ? `${frame.functionName === '' ? '(anonymous)' : frame.functionName} [${moduleOfLine[frame.lineNumber] ?? '?'}]` : `${frame.functionName === '' ? '(anonymous)' : frame.functionName} [the page's script]`
  }
}

const self = new Map<number, number>()
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const delta = profile.timeDeltas[i]!
  self.set(profile.samples[i]!, (self.get(profile.samples[i]!) ?? 0) + delta)
  total += delta
}

// Self time by function; a native's time also goes to the nearest JavaScript function above it (`withNatives`).
const selfByKey = new Map<string, number>()
const withNatives = new Map<string, number>()
const byModule = new Map<string, number>()
let canvasMeasure = 0
let canvasOther = 0
let native = 0
let js = 0
const special = new Map<string, number>()
for (const [id, time] of self) {
  const node = nodes.get(id)!
  const kind = kindOf(node)
  const key = keyOf(node)
  selfByKey.set(key, (selfByKey.get(key) ?? 0) + time)
  if (kind === 'special') {
    special.set(key, (special.get(key) ?? 0) + time)
    continue
  }
  if (kind === 'canvas') {
    if (node.callFrame.functionName === 'measureText') canvasMeasure += time
    else canvasOther += time
    continue
  }
  let owner = node
  while (kindOf(owner) !== 'js' && parent.has(owner.id)) owner = nodes.get(parent.get(owner.id)!)!
  const ownerKey = keyOf(owner)
  withNatives.set(ownerKey, (withNatives.get(ownerKey) ?? 0) + time)
  if (kind === 'native') native += time
  else js += time
  const module = /\[(.*)\]$/.exec(ownerKey)
  const moduleName = module === null ? ownerKey : module[1]!
  byModule.set(moduleName, (byModule.get(moduleName) ?? 0) + time)
}

// Time under a function (itself and everything it calls), and the Canvas part of it; a recursive function counts once.
const under = new Map<number, { all: number; canvas: number }>()
function totalsOf(id: number): { all: number; canvas: number } {
  const node = nodes.get(id)!
  const own = self.get(id) ?? 0
  const sum = { all: own, canvas: kindOf(node) === 'canvas' ? own : 0 }
  const children = node.children ?? []
  for (let c = 0; c < children.length; c++) {
    const child = totalsOf(children[c]!)
    sum.all += child.all
    sum.canvas += child.canvas
  }
  under.set(id, sum)
  return sum
}
totalsOf(profile.nodes[0]!.id)
const underByKey = new Map<string, { all: number; canvas: number }>()
for (const [id, sum] of under) {
  const node = nodes.get(id)!
  if (kindOf(node) !== 'js') continue
  const key = keyOf(node)
  let nested = false
  for (let up = parent.get(id); up !== undefined && !nested; up = parent.get(up)) nested = keyOf(nodes.get(up)!) === key
  if (nested) continue
  const entry = underByKey.get(key) ?? { all: 0, canvas: 0 }
  entry.all += sum.all
  entry.canvas += sum.canvas
  underByKey.set(key, entry)
}

// The Blink port's phases. A sample belongs to the first phase that a frame of its stack names, in this order, so a
// question asked by the cut search or by a fill counts as a question, and what is left of those two is their own work.
// A phase is named by source file where it can be, since V8 leaves a function it inlined into a caller that isn't the
// sample's top frame off the stack (fillLine and nextLine went missing that way).
const PHASES: Array<[RegExp, string]> = [
  [/^measure16 \[/, 'the questions: their strings, their contexts and the call (measure16 and under)'],
  [/\[src\/measure\/font-checks\.ts\]$/, 'the font checks but their questions'],
  [/^(fillLine|fillAll|relayout) \[|\[src\/engines\/blink\/(line-breaker|breaks)\.ts\]$/, 'the fill but its questions: the line loop, candidates, fit tests'],
  [/^(measureGroups|addPieces) \[/, 'the cut search but its questions'],
  [/\[src\//, 'paragraph analysis: content, bidi, scripts, graphemes, items, shaping groups'],
]
const phaseOfNode = new Map<number, number>()
function phaseOf(id: number): number {
  const known = phaseOfNode.get(id)
  if (known !== undefined) return known
  const above = parent.has(id) ? phaseOf(parent.get(id)!) : PHASES.length
  const key = keyOf(nodes.get(id)!)
  const own = PHASES.findIndex(phase => phase[0].test(key))
  const phase = own >= 0 && own < above ? own : above
  phaseOfNode.set(id, phase)
  return phase
}
const phaseTimes = PHASES.map(() => ({ own: 0, canvas: 0 }))
phaseTimes.push({ own: 0, canvas: 0 })
for (const [id, time] of self) {
  const kind = kindOf(nodes.get(id)!)
  if (kind === 'special') continue
  const entry = phaseTimes[phaseOf(id)]!
  if (kind === 'canvas') entry.canvas += time
  else entry.own += time
}

const ms = (time: number): string => (time / 1000).toFixed(1).padStart(8)
const share = (time: number): string => `${(100 * time / total).toFixed(1).padStart(5)}%`
const each = (time: number): string => `${(time / messages).toFixed(1).padStart(6)} µs`
const row = (label: string, time: number): string => `${ms(time)} ms ${share(time)} ${each(time)}  ${label}`
const sorted = <T>(map: Map<string, T>, value: (entry: T) => number): Array<[string, T]> => [...map].sort((a, b) => value(b[1]) - value(a[1]))

const out: string[] = [file, `${profile.samples.length} samples, ${(total / 1000).toFixed(1)} ms; "µs" is a message's share (${messages} messages)`, '', 'The split']
out.push(row('Canvas: measureText', canvasMeasure), row('Canvas: a context made, its setters, TextMetrics getters', canvasOther), row('own JavaScript', js), row('natives called by own JavaScript (builtins V8 did not inline)', native))
for (const [key, time] of sorted(special, value => value)) out.push(row(key, time))
out.push('', 'By phase: own JavaScript, then Canvas under it')
for (let i = 0; i < phaseTimes.length; i++) out.push(`${row(i < PHASES.length ? PHASES[i]![1] : 'outside the library (the page\'s loop)', phaseTimes[i]!.own)}   Canvas ${(phaseTimes[i]!.canvas / 1000).toFixed(1)} ms, ${(phaseTimes[i]!.canvas / messages).toFixed(1)} µs`)
out.push('', 'Own JavaScript by source file (self time, natives included)')
for (const [key, time] of sorted(byModule, value => value)) if (time / total >= 0.001) out.push(row(key, time))
out.push('', `Own JavaScript by function, self time with the natives it calls, top ${top}`)
for (const [key, time] of sorted(withNatives, value => value).slice(0, top)) out.push(`${row(key, time)}   (self alone ${(((selfByKey.get(key) ?? 0)) / 1000).toFixed(1)} ms)`)
out.push('', 'Natives by name (already counted above with their callers)')
for (const [key, time] of sorted(selfByKey, value => value)) if (key.startsWith('native: ') && time / total >= 0.001) out.push(row(key, time))
out.push('', `Functions by the time under them, Canvas left out (own JavaScript under the function), top ${2 * top}`)
for (const [key, entry] of sorted(underByKey, value => value.all - value.canvas).slice(0, 2 * top)) out.push(`${row(key, entry.all - entry.canvas)}   (with Canvas ${(entry.all / 1000).toFixed(1)} ms)`)
console.log(out.join('\n'))
