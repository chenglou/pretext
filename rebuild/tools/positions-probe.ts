// A probe for research/PROFILING-START.md item 2: where the Blink port's repeated Canvas questions happen, counted in a
// real browser over the chat benchmark's first messages (tools/positions-study.ts has the offline passes and says what
// is counted). Counts only, so the machine's load doesn't matter.
//
//   [POSITIONS_TREE=<a checkout's rebuild folder>] [POSITIONS_MESSAGES=1000] bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/tools/positions-probe.ts --out=<dir> --probe-timeout-ms=900000 --stall-ms=900000   (under the browser lock)
//
// POSITIONS_TREE studies another checkout's library with this tool (a branch before and after a change).
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CHAT_RESIZE_WIDTHS, CHAT_SETS, CHAT_WIDTH, buildChat } from '../bench/cases.ts'
import type { Probe } from '../probes/types.ts'
import { INSTRUMENTED, instrument } from './positions-study-core.ts'

export default async function positionsProbes(): Promise<Probe[]> {
  const tree = resolve(process.env['POSITIONS_TREE'] ?? join(import.meta.dir, '..'))
  const count = Number(process.env['POSITIONS_MESSAGES'] ?? 1000)
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, 'positions-probe-entry.ts')], target: 'browser', format: 'iife', minify: false,
    plugins: [{
      name: 'positions-study',
      setup(build) {
        // The entry names the library beside it; the studied tree's takes its place.
        build.onResolve({ filter: /^\.\.\/src\// }, args => args.importer.endsWith('positions-probe-entry.ts') ? { path: join(tree, args.path.slice(3)) } : undefined)
        build.onLoad({ filter: INSTRUMENTED }, args => ({ contents: instrument(args.path, readFileSync(args.path, 'utf8')), loader: 'ts' }))
      },
    }],
  })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  if (!bundle.includes('positionsStudy?.range(')) throw new Error('the bundle holds no instrumented measure16')
  const probes: Probe[] = []
  for (let s = 0; s < CHAT_SETS.length; s++) {
    const set = CHAT_SETS[s]!
    const body = `${bundle}\nconst out = globalThis.positionsProbe.run(${JSON.stringify(buildChat(set, count))}, ${CHAT_WIDTH}, ${JSON.stringify(CHAT_RESIZE_WIDTHS)});\nreturn { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, set: ${JSON.stringify(set)}, ...out };`
    probes.push({ id: `positions ${set}`, spec: 'PROFILING-START item 2: where Blink\'s repeated questions happen', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: body }] })
  }
  return probes
}
