// A build's src/ for the bench and `equal`, and the bench's minified bundle of it. The bench's loops are inside each
// bundle, so every library runs its own code, and each copy a document evaluates carries a comment of its own, so no
// document or library reuses code another compiled.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')

// A src/ directory as it is, or a git ref's build unpacked once into .artifacts/harness-builds/<sha>: its src/, and the
// harness's top-level files, whose page.ts predicts with it (run.ts).
export function srcOf(refOrDir: string): string {
  if (existsSync(join(refOrDir, 'layout.ts'))) return resolve(refOrDir)
  const sha = execFileSync('git', ['rev-parse', refOrDir], { cwd: ROOT, encoding: 'utf8' }).trim()
  const dir = join(ROOT, '.artifacts/harness-builds', sha)
  if (!existsSync(join(dir, 'src/layout.ts'))) {
    mkdirSync(dir, { recursive: true })
    execFileSync('sh', ['-c', `git archive ${sha} src $(git ls-tree --name-only ${sha} harness/ | grep '\\.ts$') | tar -x -C "${dir}"`], { cwd: ROOT })
  }
  return join(dir, 'src')
}

// What a document runs of a library: handles of each kind, and one operation over them `reps` times, a width a rep.
const ENTRY = `import * as L from 'LIB/layout.ts'
import * as R from 'LIB/rich-inline.ts'
function prepare(kind, texts, font, options) {
  const out = new Array(texts.length)
  for (let i = 0; i < texts.length; i++) out[i] = kind === 'rich' ? R.prepareRichInline(texts[i]) : kind === 'segments' ? L.prepareWithSegments(texts[i], font, options) : L.prepare(texts[i], font, options)
  return out
}
function run(op, data, widths, reps, font, options) {
  let n = 0
  for (let r = 0; r < reps; r++) {
    const w = widths[r % widths.length]
    for (let i = 0; i < data.length; i++) {
      const p = data[i]
      switch (op) {
        case 'new': case 'seen': n += L.layout(L.prepare(p, font, options), w, 20).lineCount; break
        case 'prepare': n += L.prepare(p, font, options) === null ? 0 : 1; break
        case 'rich-new': n += R.measureRichInlineStats(R.prepareRichInline(p), w).lineCount; break
        case 'layout': n += L.layout(p, w, 20).lineCount; break
        case 'stats': { const s = L.measureLineStats(p, w); n += s.lineCount + s.maxLineWidth; break }
        case 'walk': n += L.walkLineRanges(p, w, line => { n += line.width }); break
        case 'stream': for (let c = { segmentIndex: 0, graphemeIndex: 0 }; ;) { const line = L.layoutNextLineRange(p, c, w); if (line === null) break; n += line.width; c = line.end } break
        case 'lines': n += L.layoutWithLines(p, w, 20).lines.length; break
        case 'rich-stats': n += R.measureRichInlineStats(p, w).maxLineWidth; break
        case 'rich-walk': n += R.walkRichInlineLineRanges(p, w, line => { n += line.width }); break
        case 'rich-stream': for (let c = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }; ;) { const line = R.layoutNextRichInlineLineRange(p, w, c); if (line === null) break; n += line.width; c = line.end } break
        default: throw new Error('unknown operation ' + op)
      }
    }
  }
  return n
}
globalThis.__benchLibrary = { prepare, run }
`

export async function benchBundle(src: string): Promise<{ code: string; bytes: number; gzipped: number }> {
  const dir = join(ROOT, '.artifacts/harness-bench/entries')
  mkdirSync(dir, { recursive: true })
  const entry = join(dir, `${Bun.hash(src).toString(36)}.js`)
  writeFileSync(entry, ENTRY.replaceAll('LIB', src))
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: true })
  if (!built.success) throw new Error(built.logs.map(String).join('\n'))
  const code = await built.outputs[0]!.text()
  return { code, bytes: Buffer.byteLength(code), gzipped: Bun.gzipSync(code).length }
}
