// Explicit cross-tree diagnostic; excluded from maintained test discovery.
import { isDeepStrictEqual } from 'node:util'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../src/env.js'
import * as current from '../../src/engines/gecko/index.js'
import { createContextPool } from '../../src/measure/canvas.js'
import { installStandInCanvas } from '../../tools/stand-in-canvas.ts'
import { cases, type PlainCase } from './cases.ts'

const base = process.argv[2]
if (base === undefined) throw new Error('Supply the frozen baseline repository path')
const baseline: typeof current = await import(`${base}/rebuild/src/engines/gecko/index.ts`)
const baselineCanvas: { createContextPool: typeof createContextPool } = await import(`${base}/rebuild/src/measure/canvas.ts`)
const env: GeckoEnvironment = { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en',
  contentLanguage: null, regionalPrefsLocale: 'en-US', dictionaryBreaks: { kind: 'intl-segmenter-word' } }
const userAgent = 'Mozilla/5.0 Firefox/156.0'

function observe(lib: typeof current, c: PlainCase) {
  const canvas = installStandInCanvas({ userAgent, devicePixelRatio: 2, pageLang: c.paragraph.lang })
  try {
    const contexts = lib === current ? createContextPool() : baselineCanvas.createContextPool()
    const p = lib.prepare(structuredClone(c.paragraph), { ...env, pageLang: c.paragraph.lang }, true, contexts)
    const out: unknown[] = []
    let consulted = 0, repeated = 0
    // Retained reordered widths and a fresh retry of a refused band must start a new endpoint traversal.
    for (const width of [37, 14, 96, 1, 320, 14, 37]) {
      let first = true
      for (let start = lib.firstLine(p); start !== null;) {
        if (first) {
          const refused = lib.fillLine(p, start, { width, left: width, right: 0 })
          if (refused.kind !== 'below-floats' || !isDeepStrictEqual(refused.next, start)) throw new Error('Float refusal/continuation differs')
          first = false
        }
        const f = lib.fillLine(p, start, { width, left: 0, right: 0 })
        if (f.kind !== 'line') throw new Error('unexpected refusal')
        const offsets = f.line.inspect!.consulted
        consulted += offsets.length
        repeated += offsets.length - new Set(offsets).size
        // Check exact observations, including duplicate consulted offsets, before reading geometry or pieces.
        out.push(JSON.parse(JSON.stringify({ start: f.start, end: f.end, next: f.next, hasLineBox: f.hasLineBox,
          consulted: offsets, inspection: lib.inspectLine(p, f.line), pieces: lib.linePieces(p, f.line) })) as unknown)
        start = f.next
      }
    }
    return { out, consulted, repeated, canvas: canvas.asked() }
  } finally { canvas.restore() }
}

const selected = cases([]).filter(c => c.id.startsWith('endpoint/'))
let consulted = 0, repeated = 0
for (const c of selected) {
  const actual = observe(current, c), expected = observe(baseline, c)
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Exact endpoint observation differs: ${c.id}`)
  consulted += actual.consulted
  repeated += actual.repeated
}
if (consulted === 0 || repeated === 0) throw new Error('Controls did not exercise stand-in consultation and duplicates')
console.log(JSON.stringify({ cases: selected.length, exactObservationsEqual: true, consulted, repeated }))
