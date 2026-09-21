// What Firefox does inside one DOM call, from a Gecko profiler file with native stacks.
//
// The Gecko profiler's raw JSON (what a shutdown or a SIGUSR2 dump writes, with the `stackwalk` feature on) holds
// native frames as addresses. This tool names them from a Breakpad symbol file of the same build (Mozilla's symbol
// server has one per library and build id: <server>/XUL/<breakpadId>/XUL.sym; the id is in the profile's `libs`),
// inlined functions included, and prints what lies under one label frame, for example
// `OffscreenCanvasRenderingContext2D.measureText`: a call tree, self time and inclusive time per function. Frames of
// libraries without a symbol file are named by their library.
//
//   bun rebuild/tools/gecko-profile-native.ts --profile=<profile.json> --sym=XUL=<XUL.sym> \
//     [--under=measureText] [--min=0.5] [--top=50] [--out=<report.txt>] [--full]
//
// `--under`: a substring of the label frame that roots the report. `--min`: the smallest share of the rooted samples,
// in percent, a tree node needs to be printed. A sample is one profiler tick (1 ms by default), so shares are shares
// of time on the thread. The thread is the content process main thread with the most samples under the label.

import { createReadStream, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

type Schema = Record<string, number>
type RawThread = {
  name: string
  pid: number | string
  processName?: string
  stringTable: string[]
  frameTable: { schema: Schema, data: (number | null)[][] }
  stackTable: { schema: Schema, data: (number | null)[][] }
  samples: { schema: Schema, data: (number | null)[][] }
}
type RawLib = { name: string, start: number, end: number, breakpadId: string }
type RawProcess = { meta?: { processType?: number }, libs?: RawLib[], threads?: RawThread[], processes?: RawProcess[] }

type Inline = { depth: number, origin: number, ranges: number[] }
type Func = { start: number, size: number, name: string, inlines: Inline[] }

function arg(name: string, fallback: string | null): string | null {
  const prefix = `--${name}=`
  for (let i = 2; i < process.argv.length; i++) {
    const value = process.argv[i]!
    if (value.startsWith(prefix)) return value.slice(prefix.length)
  }
  return fallback
}

const profilePath = arg('profile', null)
const symArg = arg('sym', null)
if (profilePath === null || symArg === null) throw new Error('usage: --profile=<json> --sym=<lib>=<file.sym>')
const symLib = symArg.slice(0, symArg.indexOf('='))
const symPath = symArg.slice(symArg.indexOf('=') + 1)
const under = arg('under', 'measureText')!
const minShare = Number(arg('min', '0.5'))
const top = Number(arg('top', '50'))
const outPath = arg('out', null)
const full = process.argv.includes('--full')

const profile = JSON.parse(await Bun.file(profilePath).text()) as RawProcess

// 1. The thread: of every process's GeckoMain, the one with the most samples under the label.
type Found = { process: RawProcess, thread: RawThread, rooted: number }
let best: Found | null = null
function stacksUnder(thread: RawThread): Int8Array {
  const strings = thread.stringTable
  const frameLocation = thread.frameTable.schema['location']!
  const stackPrefix = thread.stackTable.schema['prefix']!
  const stackFrame = thread.stackTable.schema['frame']!
  const frames = thread.frameTable.data
  const stacks = thread.stackTable.data
  const isRoot = new Uint8Array(frames.length)
  for (let i = 0; i < frames.length; i++) {
    const location = strings[frames[i]![frameLocation]!]!
    if (!location.startsWith('0x') && location.includes(under)) isRoot[i] = 1
  }
  // A stack's prefix always has a smaller index, so one forward pass settles every stack.
  const has = new Int8Array(stacks.length)
  for (let i = 0; i < stacks.length; i++) {
    const prefix = stacks[i]![stackPrefix]
    has[i] = isRoot[stacks[i]![stackFrame]!] === 1 || (prefix !== null && prefix !== undefined && has[prefix] === 1) ? 1 : 0
  }
  return has
}
function visit(node: RawProcess): void {
  const threads = node.threads ?? []
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i]!
    if (thread.name !== 'GeckoMain') continue
    const has = stacksUnder(thread)
    const sampleStack = thread.samples.schema['stack']!
    let rooted = 0
    for (let s = 0; s < thread.samples.data.length; s++) {
      const stack = thread.samples.data[s]![sampleStack]
      if (stack !== null && stack !== undefined && has[stack] === 1) rooted++
    }
    if (best === null || rooted > best.rooted) best = { process: node, thread, rooted }
  }
  const children = node.processes ?? []
  for (let i = 0; i < children.length; i++) visit(children[i]!)
}
visit(profile)
if (best === null || (best as Found).rooted === 0) throw new Error(`no sample under a label holding "${under}"`)
const found = best as Found
const thread = found.thread
const libs = (found.process.libs ?? []).slice().sort((a, b) => a.start - b.start)

// 2. Every native frame's library and address inside it. A frame that isn't a sample's leaf holds a return address,
// which can lie one instruction past the call's own line and inline records, so those are looked up one byte back.
const strings = thread.stringTable
const frames = thread.frameTable.data
const frameLocation = thread.frameTable.schema['location']!
const frameLib: (RawLib | null)[] = new Array(frames.length).fill(null)
const frameAddress = new Float64Array(frames.length)
const wanted: number[] = []
for (let i = 0; i < frames.length; i++) {
  const location = strings[frames[i]![frameLocation]!]!
  if (!location.startsWith('0x')) continue
  const address = Number.parseInt(location.slice(2), 16)
  let lib: RawLib | null = null
  for (let k = 0; k < libs.length; k++) {
    if (address >= libs[k]!.start && address < libs[k]!.end) { lib = libs[k]!; break }
  }
  frameLib[i] = lib
  if (lib === null) continue
  frameAddress[i] = address - lib.start
  if (lib.name === symLib) { wanted.push(address - lib.start); wanted.push(address - lib.start - 1) }
}
wanted.sort((a, b) => a - b)
function anyWantedIn(start: number, end: number): boolean {
  let low = 0
  let high = wanted.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (wanted[mid]! < start) low = mid + 1
    else high = mid
  }
  return low < wanted.length && wanted[low]! < end
}

// 3. The symbol file, streamed: every inline origin's name, and the functions that hold a wanted address.
const origins: string[] = []
const funcs: Func[] = []
let current: Func | null = null
let moduleLine = ''
const reader = createInterface({ input: createReadStream(symPath), crlfDelay: Infinity })
for await (const line of reader) {
  const first = line.charCodeAt(0)
  if (first === 70 /* F */ && line.startsWith('FUNC ')) {
    const parts = line.split(' ')
    let at = 1
    if (parts[at] === 'm') at++
    const start = Number.parseInt(parts[at]!, 16)
    const size = Number.parseInt(parts[at + 1]!, 16)
    if (anyWantedIn(start, start + size)) {
      current = { start, size, name: parts.slice(at + 3).join(' '), inlines: [] }
      funcs.push(current)
    } else {
      current = null
    }
  } else if (first === 73 /* I */ && line.startsWith('INLINE_ORIGIN ')) {
    const space = line.indexOf(' ', 14)
    origins[Number(line.slice(14, space))] = line.slice(space + 1)
  } else if (first === 73 && current !== null && line.startsWith('INLINE ')) {
    const parts = line.split(' ')
    const ranges: number[] = []
    for (let k = 5; k + 1 < parts.length; k += 2) {
      ranges.push(Number.parseInt(parts[k]!, 16), Number.parseInt(parts[k + 1]!, 16))
    }
    current.inlines.push({ depth: Number(parts[1]), origin: Number(parts[4]), ranges })
  } else if (first === 80 /* P */ && line.startsWith('PUBLIC ')) {
    const parts = line.split(' ')
    let at = 1
    if (parts[at] === 'm') at++
    const start = Number.parseInt(parts[at]!, 16)
    if (anyWantedIn(start, start + 1)) funcs.push({ start, size: 0, name: parts.slice(at + 2).join(' '), inlines: [] })
  } else if (first === 77 /* M */ && line.startsWith('MODULE ')) {
    moduleLine = line
  }
}
funcs.sort((a, b) => a.start - b.start)

// A name without its parameter list, so lines stay readable; template arguments stay.
function shortName(name: string): string {
  let depth = 0
  for (let i = 0; i < name.length; i++) {
    const c = name[i]
    if (c === '<') depth++
    else if (c === '>') depth--
    else if (c === '(' && depth === 0 && i > 0 && !name.startsWith('(anonymous', i) && !name.startsWith('operator()', i - 8)) {
      return name.slice(0, i)
    }
  }
  return name
}

// The names at one address, outermost first: the function, then what was inlined into it there.
function namesAt(address: number): string[] {
  let low = 0
  let high = funcs.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (funcs[mid]!.start <= address) low = mid + 1
    else high = mid
  }
  const func = low > 0 ? funcs[low - 1]! : null
  if (func === null || (func.size > 0 && address >= func.start + func.size)) return [`${symLib}+0x${address.toString(16)}`]
  const names = [shortName(func.name)]
  const byDepth: string[] = []
  for (let i = 0; i < func.inlines.length; i++) {
    const inline = func.inlines[i]!
    for (let k = 0; k < inline.ranges.length; k += 2) {
      if (address >= inline.ranges[k]! && address < inline.ranges[k]! + inline.ranges[k + 1]!) {
        byDepth[inline.depth] = shortName(origins[inline.origin] ?? `inline#${inline.origin}`)
        break
      }
    }
  }
  for (let d = 0; d < byDepth.length; d++) if (byDepth[d] !== undefined) names.push(byDepth[d]!)
  return names
}

const leafNames = new Map<number, string[]>()
const callerNames = new Map<number, string[]>()
function frameNames(frame: number, isLeaf: boolean): string[] {
  const cache = isLeaf ? leafNames : callerNames
  const hit = cache.get(frame)
  if (hit !== undefined) return hit
  const location = strings[frames[frame]![frameLocation]!]!
  let names: string[]
  if (!location.startsWith('0x')) names = [`[${location}]`]
  else {
    const lib = frameLib[frame]
    if (lib === null) names = ['(no library)']
    else if (lib.name !== symLib) names = [`{${lib.name}}`]
    else names = namesAt(frameAddress[frame]! - (isLeaf ? 0 : 1))
  }
  cache.set(frame, names)
  return names
}

// 4. The samples under the label, as name paths from the label down to the leaf.
type TreeNode = { name: string, total: number, self: number, children: Map<string, TreeNode> }
const root: TreeNode = { name: '(root)', total: 0, self: 0, children: new Map() }
const selfCount = new Map<string, number>()
const inclusiveCount = new Map<string, number>()
const stacks = thread.stackTable.data
const stackPrefix = thread.stackTable.schema['prefix']!
const stackFrame = thread.stackTable.schema['frame']!
const sampleStack = thread.samples.schema['stack']!
const hasRoot = stacksUnder(thread)
let threadSamples = 0
let rootedSamples = 0
for (let s = 0; s < thread.samples.data.length; s++) {
  const stack = thread.samples.data[s]![sampleStack]
  if (stack === null || stack === undefined) continue
  threadSamples++
  if (hasRoot[stack] !== 1) continue
  rootedSamples++
  const chain: number[] = []
  let cursor: number | null | undefined = stack
  while (cursor !== null && cursor !== undefined) {
    chain.push(stacks[cursor]![stackFrame]!)
    cursor = stacks[cursor]![stackPrefix]
  }
  // chain runs leaf first. Find the outermost label frame that matches, then walk down to the leaf.
  let rootAt = -1
  for (let i = chain.length - 1; i >= 0; i--) {
    const location = strings[frames[chain[i]!]![frameLocation]!]!
    if (!location.startsWith('0x') && location.includes(under)) { rootAt = i; break }
  }
  const path: string[] = []
  for (let i = rootAt; i >= 0; i--) {
    const names = frameNames(chain[i]!, i === 0)
    for (let k = 0; k < names.length; k++) {
      // A library without symbols gives one name per frame; fold runs of it into one step.
      if (path.length > 0 && names[k]!.startsWith('{') && path[path.length - 1] === names[k]) continue
      path.push(names[k]!)
    }
  }
  let node = root
  node.total++
  const seen = new Set<string>()
  for (let i = 0; i < path.length; i++) {
    const name = path[i]!
    let child = node.children.get(name)
    if (child === undefined) {
      child = { name, total: 0, self: 0, children: new Map() }
      node.children.set(name, child)
    }
    child.total++
    node = child
    if (!seen.has(name)) { seen.add(name); inclusiveCount.set(name, (inclusiveCount.get(name) ?? 0) + 1) }
  }
  node.self++
  const leaf = path[path.length - 1]!
  selfCount.set(leaf, (selfCount.get(leaf) ?? 0) + 1)
}

// 5. The report.
const out: string[] = []
function share(count: number): string {
  return `${(count * 100 / rootedSamples).toFixed(1).padStart(5)}%`
}
out.push(`profile: ${profilePath.slice(profilePath.lastIndexOf('/') + 1)}`)
out.push(`symbols: ${moduleLine}`)
out.push(`thread: GeckoMain of pid ${thread.pid} (${thread.processName ?? ''}); ${threadSamples} samples with a stack, ${rootedSamples} under a label holding "${under}" (${(rootedSamples * 100 / threadSamples).toFixed(1)}% of the thread)`)
out.push(`every share below is of those ${rootedSamples} samples`)
out.push('')
out.push(`== call tree, nodes of at least ${minShare}% (total, self) ==`)
// A wrapper is a node with no time of its own whose one child has all of its samples (an inlined forwarding function,
// a smart pointer's destructor): the tree prints the child in its place unless --full is given.
function printTree(node: TreeNode, depth: number): void {
  const children = [...node.children.values()].sort((a, b) => b.total - a.total)
  for (let i = 0; i < children.length; i++) {
    let child = children[i]!
    if (child.total * 100 / rootedSamples < minShare) continue
    while (!full && child.self === 0 && child.children.size === 1) {
      const only = child.children.values().next().value as TreeNode
      if (only.total !== child.total) break
      child = only
    }
    out.push(`${share(child.total)} ${share(child.self)}  ${'  '.repeat(depth)}${child.name}`)
    printTree(child, depth + 1)
  }
}
printTree(root, 0)
function printTop(title: string, counts: Map<string, number>): void {
  out.push('')
  out.push(`== ${title}, top ${top} ==`)
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
  for (let i = 0; i < rows.length; i++) out.push(`${share(rows[i]![1])}  ${rows[i]![0]}`)
}
printTop('self time by function (innermost inlined function)', selfCount)
printTop('inclusive time by function', inclusiveCount)
const text = out.join('\n') + '\n'
if (outPath !== null) writeFileSync(outPath, text)
process.stdout.write(text)
