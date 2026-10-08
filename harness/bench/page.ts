// The bench's page. run.ts serves it in a cross-origin-isolated document and hands it one document's work: the
// libraries' bundles (base, candidate and a copy of base as the control), evaluated here, and the operations to time.
// Each round times every library once per operation in an order shuffled with the document's seed, a MessageChannel
// yield before each sample. A new-text sample prepares its own batch, read forward, so nothing is timed twice; a
// repeated sample runs its operation enough times to take the target time, sized from the fastest library in the
// warm-up rounds. Focus and visibility are checked around every sample when the run is in the foreground. A fresh
// document holds one library: it times compiling and running the bundle apart, then two batches of new messages.
export type Sample = { label: string; ms: number; units: number }
export type Snapshot = { visible: boolean; focused: boolean; dpr: number }
export type OpSpec = {
  op: string
  // New text: a batch a sample, in order. Otherwise `texts` every sample, prepared into handles first when `handles`
  // names a kind; `widths` empty means new fractional widths each round.
  batches?: unknown[][]
  batchUnits?: number[]
  texts?: unknown[]
  textUnits?: number
  handles?: 'fast' | 'segments' | 'rich'
  widths: number[]
}
export type Doc = {
  id: string; seed: string; font: string; options: object; focus: boolean; warm: number; rounds: number; targetMs: number
  libraries: Array<{ label: string; code: string }>
  ops: OpSpec[]
  fresh?: { batches: string[][]; units: number[] }
  // Scratch (rp3-whole-rich): count, for each copy of the library, the numbers in its paragraphs' lists that aren't whole.
  checkWhole?: boolean
  // Scratch (rp3-whole-rich): measure these characters in these fonts with the page's own Canvas (FontProbe).
  probe?: { fonts: string[]; characters: string }
}
// Scratch (rp3-whole-rich). What one copy's paragraphs hold: the handles its line operations ran on and every new batch
// prepared again. `widths` counts the numbers in every list named `widths`, `others` those in every other list;
// `example` is the first number that isn't whole, with the property it was under.
export type WholeCheck = { label: string; paragraphs: number; widths: number; widthFractions: number; others: number; otherFractions: number; example: string }
// Scratch (rp3-whole-rich). A space's width in each font of the document's items, as this browser's Canvas gives it:
// no list of these paragraphs holds it, and where it is a fraction V8 comes to hold every measured width as a double
// (the notes of the plain trial of 2026-10-07), so it says what a list of whole widths is in Chrome.
export type SpaceWidth = { font: string; space: number }
// Scratch (rp3-whole-rich). The font probe: for each font, how many of the characters measure a width that isn't
// whole, alone, with the first such character and its width, and a space's width.
export type FontProbe = { font: string; characters: number; fractions: number; example: string; space: number }
export type DocResult =
  | { id: string; timerStep: number; start: Snapshot; end: Snapshot; ops: Array<{ op: string; rounds: Sample[][] }>; whole?: WholeCheck[]; spaces?: SpaceWidth[]; probe?: FontProbe[] }
  | { id: string; timerStep: number; start: Snapshot; end: Snapshot; label: string; compileMs: number; runMs: number; batches: Sample[] }

type Library = { prepare: (kind: string, texts: unknown[], font: string, options: object) => unknown[]; run: (op: string, data: unknown[], widths: number[], reps: number, font: string, options: object) => number }

const snap = (): Snapshot => ({ visible: document.visibilityState === 'visible', focused: document.hasFocus(), dpr: devicePixelRatio })
const pause = (): Promise<void> => new Promise(done => {
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    channel.port1.close()
    done()
  }
  channel.port2.postMessage(0)
})

// Runs a bundle as a classic script, which the browser parses whole before it runs: the script's first statement marks
// where compiling ends and running starts.
function evaluate(code: string): { lib: Library; compileMs: number; runMs: number } {
  const script = document.createElement('script')
  script.textContent = `globalThis.__benchStarted = performance.now();\n${code}`
  const before = performance.now()
  document.head.append(script)
  const after = performance.now()
  const started = Reflect.get(globalThis, '__benchStarted') as number
  return { lib: Reflect.get(globalThis, '__benchLibrary') as Library, compileMs: started - before, runMs: after - started }
}

// Scratch (rp3-whole-rich). Every number in every list reachable from a handle, typed arrays aside, each list once.
function countNumbers(value: unknown, key: string, seen: Set<object>, out: WholeCheck): void {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value) || seen.has(value)) return
  seen.add(value)
  if (!Array.isArray(value)) {
    for (const name of Object.keys(value)) countNumbers(Reflect.get(value, name), name, seen, out)
    return
  }
  for (let i = 0; i < value.length; i++) {
    const v: unknown = value[i]
    if (typeof v !== 'number') {
      countNumbers(v, key, seen, out)
      continue
    }
    const whole = Number.isInteger(v)
    if (key === 'widths') {
      out.widths++
      if (!whole) out.widthFractions++
    } else {
      out.others++
      if (!whole) out.otherFractions++
    }
    if (!whole && out.example === '') out.example = `${key}[${i}] = ${v}`
  }
}

async function runDoc(doc: Doc): Promise<DocResult> {
  if (!crossOriginIsolated) throw new Error('the bench page must be cross-origin isolated, for a fine timer')
  for (let i = 0; doc.focus && i < 100 && !(snap().visible && snap().focused); i++) await new Promise(done => setTimeout(done, 20))
  const check = (): void => {
    const s = snap()
    if (doc.focus && !(s.visible && s.focused)) throw new Error('the bench page lost focus')
  }
  check()
  let timerStep = Infinity
  for (let k = 0; k < 1000; k++) {
    const a = performance.now()
    let b = a
    while (b === a) b = performance.now()
    timerStep = Math.min(timerStep, b - a)
  }
  const start = snap()
  if (doc.fresh !== undefined) {
    const { lib, compileMs, runMs } = evaluate(doc.libraries[0]!.code)
    const batches: Sample[] = []
    for (let b = 0; b < doc.fresh.batches.length; b++) {
      const t = performance.now()
      lib.run('new', doc.fresh.batches[b]!, [320], 1, doc.font, doc.options)
      batches.push({ label: doc.libraries[0]!.label, ms: performance.now() - t, units: doc.fresh.units[b]! })
    }
    check()
    return { id: doc.id, timerStep, start, end: snap(), label: doc.libraries[0]!.label, compileMs, runMs, batches }
  }
  const libs = doc.libraries.map(entry => ({ label: entry.label, lib: evaluate(entry.code).lib, handles: [] as unknown[][] }))
  let seed = 2166136261
  for (let i = 0; i < doc.seed.length; i++) seed = Math.imul(seed ^ doc.seed.charCodeAt(i), 16777619)
  const shuffled = (round: number): number[] => {
    let a = (seed ^ Math.imul(round + 7, 0x9e3779b1)) >>> 0
    const order = libs.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), a | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const j = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (i + 1))
      const x = order[i]!
      order[i] = order[j]!
      order[j] = x
    }
    return order
  }
  let sink = 0
  let widthCounter = 0
  const ops: Array<{ op: string; rounds: Sample[][] }> = []
  for (let o = 0; o < doc.ops.length; o++) {
    const spec = doc.ops[o]!
    // Handles, or the first exposure of the texts a seen sample prepares again, in a shuffled order.
    const first = shuffled(-100 - o)
    for (let k = 0; k < first.length; k++) {
      const e = libs[first[k]!]!
      if (spec.handles !== undefined) e.handles[o] = e.lib.prepare(spec.handles, spec.texts!, doc.font, doc.options)
      else if (spec.op === 'seen' || spec.op === 'rich-seen') sink += e.lib.run(spec.op, spec.texts!, spec.widths, 1, doc.font, doc.options)
    }
    let reps = 1
    let batch = 0
    const rounds: Sample[][] = []
    for (let round = -doc.warm; round < doc.rounds; round++) {
      const order = shuffled(round + 1000 * o)
      let widths = spec.widths
      if (widths.length === 0) {
        widths = []
        for (let r = 0; r < reps; r++) widths.push(240 + ((widthCounter++ * 0.6180339887498949) % 1) * 220)
      }
      const samples: Sample[] = []
      for (let k = 0; k < order.length; k++) {
        const e = libs[order[k]!]!
        const b = spec.batches === undefined ? -1 : batch++
        const data = b >= 0 ? spec.batches![b]! : spec.handles !== undefined ? e.handles[o]! : spec.texts!
        const n = b >= 0 ? 1 : reps
        await pause()
        check()
        const t = performance.now()
        sink += e.lib.run(spec.op, data, widths, n, doc.font, doc.options)
        const ms = performance.now() - t
        check()
        samples.push({ label: e.label, ms, units: b >= 0 ? spec.batchUnits![b]! : spec.textUnits! * n })
      }
      if (round >= 0) rounds.push(samples)
      else if (spec.batches === undefined) reps = Math.max(1, Math.ceil(reps * doc.targetMs / Math.max(timerStep, Math.min(...samples.map(s => s.ms)))))
    }
    ops.push({ op: spec.op, rounds })
  }
  document.body.dataset['sink'] = String(sink)
  if (doc.probe !== undefined) {
    const context = new OffscreenCanvas(1, 1).getContext('2d')!
    const probe: FontProbe[] = []
    for (const font of doc.probe.fonts) {
      context.font = font
      const entry: FontProbe = { font, characters: doc.probe.characters.length, fractions: 0, example: '', space: context.measureText(' ').width }
      for (let i = 0; i < doc.probe.characters.length; i++) {
        const width = context.measureText(doc.probe.characters[i]!).width
        if (Number.isInteger(width)) continue
        entry.fractions++
        if (entry.example === '') entry.example = `${doc.probe.characters[i]!} ${width}`
      }
      probe.push(entry)
    }
    return { id: doc.id, timerStep, start, end: snap(), ops, probe }
  }
  if (doc.checkWhole !== true) return { id: doc.id, timerStep, start, end: snap(), ops }
  // Scratch (rp3-whole-rich). After every round was timed: this loop reads every copy's lists, and JavaScriptCore
  // converts a list of integers to doubles where one loop has read both kinds, which before the timing would undo the
  // state the document is there to time.
  const end = snap()
  const whole: WholeCheck[] = []
  for (let k = 0; k < libs.length; k++) {
    const e = libs[k]!
    const out: WholeCheck = { label: e.label, paragraphs: 0, widths: 0, widthFractions: 0, others: 0, otherFractions: 0, example: '' }
    const seen = new Set<object>()
    for (let o = 0; o < doc.ops.length; o++) {
      const spec = doc.ops[o]!
      const lists = spec.batches === undefined ? (e.handles[o] === undefined ? [] : [e.handles[o]!]) : spec.batches.map(batch => e.lib.prepare('rich', batch, doc.font, doc.options))
      for (let l = 0; l < lists.length; l++) {
        out.paragraphs += lists[l]!.length
        countNumbers(lists[l]!, '', seen, out)
      }
    }
    whole.push(out)
  }
  const fonts = new Set<string>()
  for (let o = 0; o < doc.ops.length; o++) {
    const spec = doc.ops[o]!
    const paragraphs = (spec.batches === undefined ? spec.texts! : spec.batches.flat()) as Array<Array<{ font: string }>>
    for (let i = 0; i < paragraphs.length; i++) for (let k = 0; k < paragraphs[i]!.length; k++) fonts.add(paragraphs[i]![k]!.font)
  }
  const context = new OffscreenCanvas(1, 1).getContext('2d')!
  const spaces: SpaceWidth[] = []
  for (const font of fonts) {
    context.font = font
    spaces.push({ font, space: context.measureText(' ').width })
  }
  return { id: doc.id, timerStep, start, end, ops, whole, spaces }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const query = `job=${params.get('job')}&n=${params.get('n')}`
  const doc = await (await fetch(`/api/doc?${query}`)).json() as Doc
  let body: unknown
  try {
    body = { result: await runDoc(doc) }
  } catch (error) {
    body = { error: error instanceof Error ? error.message : String(error) }
  }
  const reply = await (await fetch(`/api/result?${query}`, { method: 'POST', body: JSON.stringify(body) })).json() as { next: string | null }
  if (reply.next === null) document.title = 'harness done'
  else location.replace(reply.next)
}

void main()
