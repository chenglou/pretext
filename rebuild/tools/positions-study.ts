// A study tool, not a test: where the Blink port's repeated Canvas questions happen (research/PROFILING-START.md, item 2),
// offline. It changes nothing in rebuild/src: the library is loaded through a source transform that makes measure16 name
// the range it measures (tools/positions-study-core.ts), so a repeat is classed by offsets as well as by its string.
//
//   bun rebuild/tools/positions-study.ts --part=chat --set=mix|latin [--count=2000] [--tree=<a checkout's rebuild folder>] [--out=<report.json>]
//   bun rebuild/tools/positions-study.ts --part=tier [--sets=a,b] [--tree=...] [--out=...]
//
// - chat: the bench's chat messages under the stand-in Canvas (tools/stand-in-canvas.ts), each prepared from scratch and
//   filled at 320px as the bench's `scratch, count` row does, then kept and filled at 260, 380 and 440px, and at those
//   three once more, as its resize rows do. The stand-in is no font, and its Blink counts run above real Chrome's:
//   tools/positions-probe.ts makes the same pass in the browser.
// - tier: Chrome's recorded tier cases without facts on the plain path (lab/baselines/plain-predictor.ts: prepare, every
//   line filled, every line's pieces read), answered from real Chrome's recorded answers; held-out sets and twins left out.
// `--tree` studies another checkout's library with this tool (a branch before and after a change).
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { INSTRUMENTED, instrument, makeStudy } from './positions-study-core.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const part = options.get('part') ?? 'chat'
const tree = resolve(options.get('tree') ?? join(import.meta.dir, '..'))

Bun.plugin({
  name: 'positions-study',
  setup(build) {
    build.onLoad({ filter: INSTRUMENTED }, args => ({ contents: instrument(args.path, readFileSync(args.path, 'utf8')), loader: 'ts' }))
  },
})

const study = makeStudy()
;(globalThis as unknown as { positionsStudy: unknown }).positionsStudy = study.hooks

// Deep enough for every library frame of a call (measure16 recurses once per script edge).
Error.stackTraceLimit = 2000

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const

// Wraps the installed OffscreenCanvas: every context reports its calls with the settings assigned to it.
function installLog(): void {
  const globals = globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Record<string, unknown> & { measureText(text: string): unknown } } }
  const Inner = globals.OffscreenCanvas
  class Logged {
    inner = new Inner(1, 1).getContext('2d')
    assigned: Record<string, string> = {}
    measureText(text: string): unknown {
      let key = ''
      for (let i = 0; i < SETTINGS.length; i++) key += `${this.assigned[SETTINGS[i]!] ?? ''}|`
      study.call(this, key, text, new Error().stack ?? '')
      return this.inner.measureText(text)
    }
  }
  for (let i = 0; i < SETTINGS.length; i++) {
    const name = SETTINGS[i]!
    Object.defineProperty(Logged.prototype, name, {
      get(this: Logged): unknown { return this.inner[name] },
      set(this: Logged, value: unknown): void {
        this.assigned[name] = String(value)
        this.inner[name] = value
      },
    })
  }
  globals.OffscreenCanvas = class { getContext(): Logged { return new Logged() } } as never
}

const report: Record<string, unknown> = { part, tree }

if (part === 'chat') {
  const set = options.get('set') ?? 'mix'
  const count = Number(options.get('count') ?? 2000)
  const lib = await import(join(tree, 'src/index.ts'))
  const model = await import(join(tree, 'src/model.ts'))
  const cases = await import(join(tree, 'bench/cases.ts'))
  const standIn = await import(join(tree, 'tools/stand-in-canvas.ts'))
  standIn.installStandInCanvas({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', devicePixelRatio: 2, pageLang: cases.CHAT_STYLE.lang })
  installLog()
  const detected = lib.detectEnvironment({ engine: 'blink', build: '153.0.8010.50', contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  const messages = cases.buildChat(set, count)
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 }
  const edge = { margin: 0, border: 0, padding: cases.CHAT_CODE_PADDING }
  const fillAll = (prepared: unknown, width: number): void => {
    for (let start = lib.firstLine(prepared); start !== null;) start = lib.fillLine(prepared, start, { width, left: 0, right: 0 }).next
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    // bench/page.ts chatInputs: the message as the rebuild takes it, no font facts supplied.
    const content: unknown[] = []
    for (let k = 0; k < message.parts.length; k++) {
      const p = message.parts[k]
      if (p.code) content.push({ ...text, kind: 'span', font: { ...cases.CHAT_CODE_FONT, facts: model.UNKNOWN_FONT_FACTS }, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: p.text }] })
      else content.push({ kind: 'text', text: p.text })
    }
    const s = cases.CHAT_STYLE
    const paragraph = { ...text, font: { ...s.font, facts: model.UNKNOWN_FONT_FACTS }, content, lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start' }
    study.paragraph(message.kind)
    const prepared = lib.prepare(paragraph, detected.env, false)
    fillAll(prepared, cases.CHAT_WIDTH)
    for (let again = 0; again < 2; again++) {
      for (let w = 0; w < cases.CHAT_RESIZE_WIDTHS.length; w++) {
        study.pass(again === 0 ? 'new-width' : 'met-width')
        fillAll(prepared, cases.CHAT_RESIZE_WIDTHS[w])
      }
    }
  }
  report['set'] = set
  report['messages'] = count
}

if (part === 'tier') {
  const replay = await import(join(tree, 'tests/replay.ts'))
  const measurements = await import(join(tree, 'lab/measurements.ts'))
  const plain = await import(join(tree, 'lab/baselines/plain-predictor.ts'))
  const dir = replay.referenceDir('chrome', 'no-facts')
  const manifest = replay.readInputs(dir)
  const chosen: string[] = (options.get('sets') ?? Object.keys(manifest.sets).filter((name: string) => !name.startsWith('heldout') && name !== 'twins').join(',')).split(',')
  let cases = 0
  let leftOut = 0
  for (let n = 0; n < chosen.length; n++) {
    const shards = manifest.sets[chosen[n]!].shards
    for (let k = 0; k < shards.length; k++) {
      const inputs = replay.readShard(join(dir, 'inputs', shards[k].file))
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i]
        const installed = measurements.installReplay(input.record, input.env, 'predict')
        installLog()
        study.paragraph(chosen[n]!)
        try {
          plain.predict(input.case, { browser: input.browser, build: input.build.engine, languages: input.languages })
          cases++
        } catch (error) {
          if (!(error instanceof measurements.NewQuestion)) throw error
          leftOut++
        } finally {
          installed.restore()
        }
      }
    }
  }
  report['sets'] = chosen
  report['cases'] = cases
  report['leftOutForANewQuestion'] = leftOut
}

Object.assign(report, study.report() as object)
const out = options.get('out')
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify(report, null, 1)}\n`)
else console.log(JSON.stringify(report, null, 1))
