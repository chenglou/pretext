// Helpers shared by the data generators (tools/gen-*.ts). Each generator reads pinned engine data, checks every
// input against a recorded sha256, and writes one TypeScript module under src/**/generated/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const REBUILD = resolve(import.meta.dir, '..')
export const DATA = resolve(REBUILD, 'data')
export const BROWSER_ENGINES = resolve(process.env['HOME'] ?? '', 'github/browser-engines')

export function sha256(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(bytes)
  return hasher.digest('hex')
}

// Reads a file and fails unless its sha256 is the recorded one.
export function readVerified(path: string, expectedSha256: string): Uint8Array {
  const bytes = new Uint8Array(readFileSync(path))
  const actual = sha256(bytes)
  if (actual !== expectedSha256) throw new Error(`${path}: sha256 ${actual}, expected ${expectedSha256}`)
  return bytes
}

export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

// 223 rows of 28 bytes from `B(a, b, c, d, e, f, g, h)` groups, B = a | b << 1 | ... | h << 7, starting at the
// first group after `declaration`. Blink's generated kFastLineBreakTable and WebKit's LineBreakTable share this form.
export function parsePairBitmap(source: string, declaration: string): Uint8Array {
  const from = source.indexOf(declaration)
  if (from < 0) throw new Error(`missing ${declaration}`)
  const groups = source.slice(from).match(/B\(\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*\)/g)
  const bytes = new Uint8Array(223 * 28)
  if (groups === null || groups.length < bytes.length) throw new Error(`expected ${bytes.length} B() groups after ${declaration}`)
  for (let i = 0; i < bytes.length; i++) {
    const bits = groups[i]!.match(/[01]/g)!
    let byte = 0
    for (let k = 0; k < 8; k++) byte |= Number(bits[k]) << k
    bytes[i] = byte
  }
  return bytes
}

export function writeModule(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
  console.log(`wrote ${path} (${source.length} bytes)`)
}
