// Where the plain path's Canvas questions come from, on the stand-in Canvas (tests/stand-in-canvas.ts): every measureText
// call's stack is read and tallied by the chain of rebuild/src functions that led to it. The stand-in is no font, so the
// counts are the shape of the questions, not a browser's; tools/audit/replay-sites.ts does the same over recorded answers.
//
//   bun rebuild/tools/audit/sites.ts --browser=chrome|firefox|webkit-host --inputs=chat-mix:1000|chat-latin:1000|real:400 [--depth=6] [--top=40]
import { fillLineRange, firstLine, prepare, type LineStart } from '../../src/index.ts'
import { installStandIn } from '../../tests/stand-in-canvas.ts'
import { BROWSERS, chatInputs, environmentFor, PAGE, realTextInputs, type BrowserName, type Input } from './common.ts'

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? ''] as const }))
const browser = (args.get('browser') ?? 'chrome') as BrowserName
if (!BROWSERS.includes(browser)) throw new Error(`--browser=${browser}`)
const depth = Number(args.get('depth') ?? 6)
const top = Number(args.get('top') ?? 40)

export function inputsFrom(spec: string): Input[] {
  const out: Input[] = []
  for (const part of spec.split(',')) {
    const [kind, n] = part.split(':')
    if (kind === 'chat-mix') out.push(...chatInputs('mix', Number(n ?? 1000)))
    else if (kind === 'chat-latin') out.push(...chatInputs('latin', Number(n ?? 1000)))
    else if (kind === 'chat-real') out.push(...chatInputs('real', Number(n ?? 1000)))
    else if (kind === 'real') out.push(...realTextInputs(Number(n ?? 400)))
    else throw new Error(`--inputs part ${part}`)
  }
  return out
}

const inputs = inputsFrom(args.get('inputs') ?? 'chat-mix:1000')
const page = PAGE[browser]
const standIn = installStandIn({ userAgent: page.userAgent, devicePixelRatio: page.devicePixelRatio, pageLang: page.pageLang } as never)
const env = environmentFor(browser)

// Wrap the stand-in context's measureText: it is the prototype of every context the library makes.
Error.stackTraceLimit = 200
const probe = new OffscreenCanvas(1, 1).getContext('2d') as unknown as { measureText: (s: string) => unknown }
const proto = Object.getPrototypeOf(probe) as { measureText: (this: unknown, s: string) => unknown }
const original = proto.measureText
type Tally = { calls: number; chars: number }
const byChain = new Map<string, Tally>()
const byFunction = new Map<string, Tally>()
let calls = 0
let chars = 0
proto.measureText = function (this: unknown, s: string) {
  calls++
  chars += s.length
  const stack = new Error().stack ?? ''
  const names: string[] = []
  const lines = stack.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.includes('/rebuild/src/')) continue
    const m = /at (?:async )?([^\s(]+)/.exec(line)
    const file = /\/rebuild\/src\/([^:]+)/.exec(line)?.[1] ?? '?'
    names.push(`${m?.[1] ?? '?'}@${file.replace(/^engines\//, '').replace(/\.ts$/, '')}`)
  }
  const chain = names.slice(0, depth).join(' < ')
  const t = byChain.get(chain) ?? { calls: 0, chars: 0 }
  t.calls++
  t.chars += s.length
  byChain.set(chain, t)
  const seen = new Set<string>()
  for (let i = 0; i < names.length; i++) {
    const n = names[i]!
    if (seen.has(n)) continue
    seen.add(n)
    const f = byFunction.get(n) ?? { calls: 0, chars: 0 }
    f.calls++
    f.chars += s.length
    byFunction.set(n, f)
  }
  return original.call(this, s)
}

let units = 0
let lines = 0
const doc = (globalThis as unknown as { document: { documentElement: { lang: string } } }).document
for (let i = 0; i < inputs.length; i++) {
  const input = inputs[i]!
  units += input.units
  const prepared = prepare(input.paragraph, env, false)
  for (let w = 0; w < input.widths.length; w++) {
    for (let start: LineStart | null = firstLine(prepared); start !== null;) {
      const filled = fillLineRange(prepared, start, { width: input.widths[w]!, left: 0, right: 0 })
      if (filled.kind === 'line' && filled.hasLineBox) lines++
      start = filled.next
    }
  }
}
void doc

console.log(`${browser}: ${inputs.length} paragraphs, ${units} units, ${lines} lines; ${calls} calls (${(calls / inputs.length).toFixed(1)} a paragraph), ${chars} characters (${(chars / units).toFixed(2)} per unit), ${standIn.contexts} contexts`)
const sorted = [...byChain.entries()].sort((a, b) => b[1].chars - a[1].chars)
console.log(`\nby chain (innermost first, ${depth} frames), top ${top} by characters:`)
for (let i = 0; i < Math.min(top, sorted.length); i++) {
  const [k, t] = sorted[i]!
  console.log(`${String(t.calls).padStart(9)} calls ${(100 * t.calls / calls).toFixed(1).padStart(5)}%  ${String(t.chars).padStart(10)} chars ${(100 * t.chars / chars).toFixed(1).padStart(5)}%  ${k}`)
}
const fsorted = [...byFunction.entries()].sort((a, b) => b[1].calls - a[1].calls)
console.log(`\nby function on the stack (a call counts once for each function on its stack):`)
for (let i = 0; i < Math.min(top * 2, fsorted.length); i++) {
  const [k, t] = fsorted[i]!
  console.log(`${String(t.calls).padStart(9)} calls ${(100 * t.calls / calls).toFixed(1).padStart(5)}%  ${String(t.chars).padStart(10)} chars ${(100 * t.chars / chars).toFixed(1).padStart(5)}%  ${k}`)
}
