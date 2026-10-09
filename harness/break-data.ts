// Whether a browser still holds, byte for byte, the files of scripts/engine-data that sources.json lists: the compiled
// rules and character properties the engine tables were generated from (scripts/generate-engine-break-data.ts), not
// the two pair tables (DEVELOPMENT.md, Engine Data). Chrome and the system's ICU keep line and character rules as
// brkitr entries of an ICU common data file; Firefox bakes ICU4X's line and grapheme data into XUL as byte arrays,
// which the databake files hold as Rust byte strings; and ICU's character properties, which the script classes come
// from, are arrays of its C sources, compiled into Chrome's framework and into XUL. `bun harness repin` prints it.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import SOURCES from '../scripts/engine-data/sources.json'

const ENGINE_DATA = join(import.meta.dir, '../scripts/engine-data')

// The entries of a little-endian ICU common data file (format CmnD), by name without the package prefix
// ("brkitr/char.brk"). Its table of contents, after the header, gives each entry's name and data as offsets from the
// table's start, and an entry runs to the next one's data.
export function icuEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header = view.getUint16(0, true)
  if (bytes[2] !== 0xda || bytes[3] !== 0x27 || bytes[8] !== 0 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'CmnD') throw new Error('Not a little-endian ICU common data file')
  const count = view.getUint32(header, true)
  const names: string[] = []
  const starts: number[] = []
  for (let i = 0; i < count; i++) {
    const name = header + view.getUint32(header + 4 + 8 * i, true)
    const full = new TextDecoder().decode(bytes.subarray(name, bytes.indexOf(0, name)))
    names.push(full.slice(full.indexOf('/') + 1))
    starts.push(header + view.getUint32(header + 8 + 8 * i, true))
  }
  const order = names.map((_, i) => i).sort((a, b) => starts[a]! - starts[b]!)
  const out = new Map<string, Uint8Array>()
  for (let k = 0; k < count; k++) out.set(names[order[k]!]!, bytes.subarray(starts[order[k]!], k + 1 < count ? starts[order[k + 1]!] : bytes.length))
  return out
}

// A Rust source's byte strings (b"..."), decoded.
export function rustByteStrings(source: string): Uint8Array[] {
  const out: Uint8Array[] = []
  const escapes: Record<string, number> = { '0': 0, n: 10, r: 13, t: 9, '\\': 92, '"': 34, "'": 39 }
  for (const match of source.matchAll(/\bb"((?:[^"\\]|\\.)*)"/gs)) {
    const text = match[1]!
    const bytes: number[] = []
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '\\') {
        bytes.push(text.charCodeAt(i))
        continue
      }
      const escape = text[++i]!
      if (escape === 'x') {
        bytes.push(parseInt(text.slice(i + 1, i + 3), 16))
        i += 2
      } else if (escape in escapes) bytes.push(escapes[escape]!)
      else throw new Error(`Unknown escape \\${escape}`)
    }
    out.push(new Uint8Array(bytes))
  }
  return out
}

// A C source's arrays of unsigned integers whose length is written as a number (`static const uint16_t
// name[24108]={...}`), by name, as a little-endian build lays them out. ICU's two arrays of header fields, sized by an
// enum, are left out: they are read at constant indices, which a compiler folds, so no build keeps them.
export function cArrays(source: string): Map<string, Uint8Array | Uint16Array | Uint32Array> {
  const types = { uint8_t: Uint8Array, uint16_t: Uint16Array, uint32_t: Uint32Array }
  const out = new Map<string, Uint8Array | Uint16Array | Uint32Array>()
  for (const match of source.matchAll(/\b(uint(?:8|16|32)_t) (\w+)\[\d+\]=\{([^}]*)\}/g)) {
    const values = match[3]!.split(',').map(Number)
    if (values.some(Number.isNaN)) throw new Error(`${match[2]} holds more than numbers`)
    out.set(match[2]!, types[match[1] as keyof typeof types].from(values))
  }
  return out
}

// One line: each file of the browser's scripts/engine-data folder that the browser holds as it is (sources.json, which the
// generator reads too), and whether the browser holds its bytes: Chrome in its icudtl.dat, Safari in the system's ICU
// data (its line and character rules), Firefox in XUL, where `app` is the app, or the system for Safari. Then each
// file whose arrays the browser's build compiles in (`compiledIn`), and how many of them its binary holds.
export function breakDataReport(browser: 'chrome' | 'firefox' | 'safari', app: string): string {
  const { dir, inBrowser: files, compiledIn } = SOURCES[browser]
  const verdicts: string[] = []
  let same = true
  const binary = browser === 'safari' ? null
    : readFileSync(join(app, browser === 'firefox' ? 'Contents/MacOS/XUL' : 'Contents/Frameworks/Google Chrome Framework.framework/Versions/Current/Google Chrome Framework'))
  if (browser === 'firefox') {
    const xul = binary!
    for (let i = 0; i < files.length; i++) {
      const arrays = rustByteStrings(readFileSync(join(ENGINE_DATA, dir, files[i]!), 'utf8'))
      let found = 0
      for (let k = 0; k < arrays.length; k++) if (xul.indexOf(arrays[k]!) >= 0) found++
      same &&= found === arrays.length
      verdicts.push(`${files[i]} ${found} of ${arrays.length} byte arrays in XUL`)
    }
  } else {
    const icu = browser === 'chrome' ? join(app, 'Contents/Frameworks/Google Chrome Framework.framework/Versions/Current/Resources/icudtl.dat')
      : join('/usr/share/icu', readdirSync('/usr/share/icu').find(name => /^icudt\d+l\.dat$/.test(name))!)
    const entries = icuEntries(new Uint8Array(readFileSync(icu)))
    for (let i = 0; i < files.length; i++) {
      const entry = entries.get(`brkitr/${files[i]}`)
      const equal = entry !== undefined && Buffer.from(entry).equals(readFileSync(join(ENGINE_DATA, dir, files[i]!)))
      same &&= equal
      verdicts.push(`${files[i]} ${equal ? 'same' : entry === undefined ? 'MISSING' : 'DIFFERS'}`)
    }
  }
  for (let i = 0; i < compiledIn.length; i++) {
    const arrays = [...cArrays(readFileSync(join(ENGINE_DATA, dir, compiledIn[i]!), 'utf8')).values()]
    let found = 0
    for (let k = 0; k < arrays.length; k++) if (binary!.indexOf(new Uint8Array(arrays[k]!.buffer)) >= 0) found++
    same &&= found === arrays.length
    verdicts.push(`${compiledIn[i]} ${found} of ${arrays.length} arrays in the binary`)
  }
  const refresh = same ? '' : '; refresh that folder from this build, run bun run generate:engine-break-data, then the grapheme check (DEVELOPMENT.md)'
  return `${browser}'s break data: ${same ? 'the' : 'NOT the'} bytes of scripts/engine-data/${dir} (${verdicts.join(', ')})${refresh}`
}
