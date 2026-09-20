// What a Canvas measureText call costs in Chrome (2026-09-20, the upstream study): M1, a call by what the string is
// (a string the canvas has met, as the same object and as a new object; a string it has never met, by length, script
// and spaces), reading the width against reading the ink box too, the font setter and a new context; R1, the library's
// own stream of Canvas calls for the chat benchmark's first messages played back with nothing of the library inside
// the clock. tools/measuretext-cost-body.ts has the page side and what the two variants of every sample are.
// Measurement only, raw values, no checks. A timed run takes the exclusive lock:
//
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/measuretext-cost-probe.ts --out=<dir> \
//     --probe-timeout-ms=600000 --stall-ms=600000
//
// MEASURETEXT_COST_ROUNDS, MEASURETEXT_COST_SCALE and MEASURETEXT_COST_MESSAGES change the rounds (12), the calls per
// sample (times 1) and R1's messages (300). tools/measuretext-cost-shell.ts runs the same page in another Chromium.
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat } from '../bench/cases.ts'
import { MICRO_BODY, REPLAY_BODY } from './measuretext-cost-body.ts'

// spinMs, spinClass and spinVariant are the shell driver's, for a profiler: the probe never spins.
export type CostParams = { rounds: number; scale: number; messages: number; spinMs: number; spinClass: string; spinVariant: 0 | 1 }

export function costParams(): CostParams {
  const number = (name: string, fallback: number): number => {
    const value = Number(process.env[name] ?? fallback)
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
    return value
  }
  return { rounds: number('MEASURETEXT_COST_ROUNDS', 12), scale: number('MEASURETEXT_COST_SCALE', 1), messages: number('MEASURETEXT_COST_MESSAGES', 300), spinMs: 0, spinClass: '', spinVariant: 0 }
}

// JSON with every unit over 127 escaped, so the page gets 8-bit strings where the characters allow, as the bench's plan
// does.
function asciiJson(value: unknown): string {
  const json = JSON.stringify(value)
  let out = ''
  for (let i = 0; i < json.length; i++) {
    const unit = json.charCodeAt(i)
    out += unit < 128 ? json[i]! : `${String.fromCharCode(92)}u${unit.toString(16).padStart(4, '0')}`
  }
  return out
}

// The two scripts, each the body of an async function.
export async function costScripts(params: CostParams): Promise<{ micro: string; replay: string }> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'measuretext-cost-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  const head = `const PARAMS = ${JSON.stringify(params)};\n`
  const messages = asciiJson(buildChat('mix', params.messages))
  return { micro: head + MICRO_BODY, replay: `${bundle}\n${head}const MESSAGES = ${messages};\n${REPLAY_BODY}` }
}

export default async function measureTextCostProbes(): Promise<Probe[]> {
  const scripts = await costScripts(costParams())
  return [
    { id: 'measuretext-cost M1', spec: 'upstream study: a measureText call, a font assignment and a new context by kind', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: scripts.micro }] },
    { id: 'measuretext-cost R1', spec: 'upstream study: the library\'s stream of Canvas calls for chat messages, played back', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: scripts.replay }] },
  ]
}
