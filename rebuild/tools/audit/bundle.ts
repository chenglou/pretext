// What the redo's bundle is made of and what the three ways to shrink it would give: one bundle a page (today), one bundle
// per engine, the break tables decoded when first used, and tables stored as differences from one base table. Sizes are
// minified characters (bun build --minify) and gzip / brotli bytes; the tables' own sizes are their base64 strings.
//   bun rebuild/tools/audit/bundle.ts [--out=<dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const SRC = resolve(import.meta.dir, '../../src')
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? join(process.env['TMPDIR'] ?? '/tmp', 'audit-bundle')
mkdirSync(out, { recursive: true })

// One entry per engine: what a page of that engine needs (the engine's function set and the shared font checks).
const ENTRIES: Record<string, string> = {
  all: `export * from '${SRC}/index.ts'\n`,
  blink: `export * from '${SRC}/engines/blink/index.ts'\nexport { blinkFontChecks } from '${SRC}/engines/blink/checks.ts'\nexport { withLearnedFontFacts } from '${SRC}/measure/font-checks.ts'\nexport { detectEnvironment } from '${SRC}/env.ts'\n`,
  gecko: `export * from '${SRC}/engines/gecko/index.ts'\nexport { geckoFontChecks } from '${SRC}/engines/gecko/checks.ts'\nexport { withLearnedFontFacts } from '${SRC}/measure/font-checks.ts'\nexport { detectEnvironment } from '${SRC}/env.ts'\n`,
  webkit: `export * from '${SRC}/engines/webkit/index.ts'\nexport { webkitFontChecks } from '${SRC}/engines/webkit/checks.ts'\nexport { withLearnedFontFacts } from '${SRC}/measure/font-checks.ts'\nexport { detectEnvironment } from '${SRC}/env.ts'\n`,
}

type Size = { chars: number; gzip: number; brotli: number }
const sizeOf = (text: string): Size => ({ chars: text.length, gzip: gzipSync(text, { level: 9 }).length, brotli: brotliCompressSync(text).length })
const k = (n: number): string => `${(n / 1000).toFixed(0)}K`

// Every base64 literal of 2,000 characters or more in a generated module, by name.
function tables(text: string): { name: string; chars: number }[] {
  const found: { name: string; chars: number }[] = []
  for (const m of text.matchAll(/([A-Za-z0-9_$]+)\s*[:=]\s*["'`]([A-Za-z0-9+/=]{2000,})["'`]/g)) found.push({ name: m[1]!, chars: m[2]!.length })
  return found
}

console.log('bundle          minified     gzip   brotli   base64 tables in it')
const bundles: Record<string, Size & { tables: number }> = {}
for (const [name, entry] of Object.entries(ENTRIES)) {
  const path = join(out, `entry-${name}.ts`)
  writeFileSync(path, entry)
  const built = await Bun.build({ entrypoints: [path], target: 'browser', format: 'esm', minify: true })
  if (!built.success) throw new Error(built.logs.map(String).join('\n'))
  const text = await built.outputs[0]!.text()
  writeFileSync(join(out, `bundle-${name}.js`), text)
  let tableChars = 0
  for (const t of tables(text)) tableChars += t.chars
  bundles[name] = { ...sizeOf(text), tables: tableChars }
  const b = bundles[name]!
  console.log(`${name.padEnd(12)} ${k(b.chars).padStart(9)} ${k(b.gzip).padStart(8)} ${k(b.brotli).padStart(8)}   ${k(tableChars)} (${(100 * tableChars / b.chars).toFixed(0)}%)`)
}

// The ICU line and grapheme tables, decoded, compared with each engine's `line` table and across engines.
const decode = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const blink = (await import(`${SRC}/engines/blink/generated/break-tables.ts`)).blinkBreakTableBase64 as Record<string, string>
const webkit = (await import(`${SRC}/engines/webkit/generated/break-tables.ts`)).webkitBreakTableBase64 as Record<string, string>
function differing(a: Uint8Array, b: Uint8Array): number {
  let n = Math.abs(a.length - b.length)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++
  return n
}
console.log('\ntable                 bytes   base64   brotli alone   bytes differing from the engine\'s line table')
for (const [engine, set] of [['blink', blink], ['webkit', webkit]] as const) {
  const line = decode(set['line']!)
  for (const [name, b64] of Object.entries(set)) {
    const bytes = decode(b64)
    console.log(`${`${engine}.${name}`.padEnd(20)} ${String(bytes.length).padStart(7)} ${String(b64.length).padStart(8)} ${String(brotliCompressSync(bytes).length).padStart(10)}   ${name === 'line' ? '' : differing(line, bytes)}`)
  }
}
for (const name of Object.keys(blink)) {
  if (webkit[name] === undefined) continue
  const a = decode(blink[name]!), b = decode(webkit[name]!)
  console.log(`blink.${name} against webkit.${name}: ${a.length} and ${b.length} bytes, ${differing(a, b)} differ${blink[name] === webkit[name] ? ' (identical)' : ''}`)
}

// A table set stored as the base table plus the others' differences: every table after the first as its brotli size given
// the base (the brotli of base+table less the brotli of base), a stand-in for a delta encoding.
for (const [engine, set] of [['blink', blink], ['webkit', webkit]] as const) {
  const base = decode(set['line']!)
  let alone = 0, given = 0
  const baseBrotli = brotliCompressSync(base).length
  for (const [name, b64] of Object.entries(set)) {
    const bytes = decode(b64)
    alone += brotliCompressSync(bytes).length
    if (name === 'line') { given += baseBrotli; continue }
    const both = new Uint8Array(base.length + bytes.length)
    both.set(base); both.set(bytes, base.length)
    given += brotliCompressSync(both).length - baseBrotli
  }
  console.log(`${engine}: its tables brotli'd one by one ${k(alone)}; the line table plus each other given it ${k(given)}`)
}

// Evaluation: what loading each engine's data module costs in bun (decode and parse of every table at load, as today).
for (const mod of ['engines/blink/data.ts', 'engines/webkit/data.ts', 'engines/gecko/props.ts']) {
  const t0 = performance.now()
  await import(`${SRC}/${mod}`)
  console.log(`load ${mod}: ${(performance.now() - t0).toFixed(1)} ms in bun (decode and parse at load)`)
}
writeFileSync(join(out, 'bundles.json'), JSON.stringify(bundles, null, 1))
void readFileSync
