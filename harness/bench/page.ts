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
}
export type DocResult =
  | { id: string; timerStep: number; start: Snapshot; end: Snapshot; ops: Array<{ op: string; rounds: Sample[][] }> }
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
      else if (spec.op === 'seen') sink += e.lib.run('seen', spec.texts!, [320], 1, doc.font, doc.options)
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
  return { id: doc.id, timerStep, start, end: snap(), ops }
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
