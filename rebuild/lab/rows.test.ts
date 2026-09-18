// Row files read the same plain or compressed (rows.ts): compress-rows.sh must never make a run look missing, or make a
// tool ask for `zstd -d` by hand.
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { abcd, abcdExpected, abcdLayout, abcdNative, row } from './row-fixtures.ts'
import { existingRows, plainRows, readLines } from './rows.ts'
import { indexRows } from './score.ts'

// The same two rows plain in one folder and compressed in another, as compress-rows.sh leaves them (only the .zst stays).
function twoFolders(): { plain: string; compressed: string; lines: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'lab-rows-test-'))
  // U+2028 inside a JSON string must not split a line.
  const first = { ...row('chrome', abcd, abcdNative, abcdLayout, abcdExpected), id: 'c-1', family: 'line separator' }
  const second = { ...row('chrome', abcd, abcdNative, abcdLayout, abcdExpected), id: 'c-2' }
  const lines = [JSON.stringify(first), JSON.stringify(second)]
  mkdirSync(join(dir, 'plain'))
  mkdirSync(join(dir, 'compressed'))
  const plain = join(dir, 'plain/chrome-rows.ndjson')
  writeFileSync(plain, lines.join('\n') + '\n')
  execFileSync('zstd', ['-q', '-o', join(dir, 'compressed/chrome-rows.ndjson.zst'), '--', plain])
  return { plain, compressed: join(dir, 'compressed/chrome-rows.ndjson'), lines }
}

async function collect(path: string): Promise<string[]> {
  const out: string[] = []
  for await (const line of readLines(path)) out.push(line)
  return out
}

describe('rows read plain or compressed', () => {
  test('a rows file named by its plain path is found as .zst, and reads the same', async () => {
    const { plain, compressed, lines } = twoFolders()
    expect(existsSync(compressed)).toBe(false)
    expect(existingRows(compressed)).toBe(`${compressed}.zst`)
    expect(existingRows(plain)).toBe(plain)
    expect(existingRows(join(plain, 'nothing'))).toBeNull()
    expect(await collect(plain)).toEqual(lines)
    expect(await collect(compressed)).toEqual(lines)
    expect(await collect(`${compressed}.zst`)).toEqual(lines)
    await expect(collect(join(plain, 'nothing'))).rejects.toThrow('no such rows file')
  })

  test('tools that read rows by byte offset get a plain copy, which goes again', async () => {
    const { plain, compressed } = twoFolders()
    expect(plainRows(plain).path).toBe(plain)
    const copy = plainRows(compressed)
    expect(copy.path).not.toBe(compressed)
    expect(readFileSync(copy.path, 'utf8')).toBe(readFileSync(plain, 'utf8'))
    expect([...(await indexRows(copy.path)).keys()]).toEqual(['c-1', 'c-2'])
    copy.release()
    expect(existsSync(copy.path)).toBe(false)
  })

  test('score.ts scores compressed rows, against compressed rows of the other order', () => {
    const { plain, compressed } = twoFolders()
    const out = mkdtempSync(join(tmpdir(), 'lab-rows-score-'))
    const score = (rows: string, other: string, name: string): string => {
      const result = Bun.spawnSync(['bun', join(import.meta.dir, 'score.ts'), `--rows=${rows}`, `--native-compare=${other}`, `--out=${join(out, `${name}.json`)}`, `--per-case=${join(out, `${name}.ndjson`)}`])
      expect(result.exitCode).toBe(0)
      return readFileSync(join(out, `${name}.ndjson`), 'utf8')
    }
    expect(score(compressed, compressed, 'compressed')).toBe(score(plain, plain, 'plain'))
  })

  test('no other lab or tests file reads rows its own way', () => {
    // A second reader is how a compressed file came to look like a missing run: every reader is rows.ts's readLines.
    const root = join(import.meta.dir, '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts') && !path.endsWith('.test.ts') && path !== join(import.meta.dir, 'rows.ts')) {
          const source = readFileSync(path, 'utf8')
          if (/function\*? readLines\b/.test(source)) offenders.push(`${relative(root, path)} defines its own readLines`)
          if (/readLines\(/.test(source) && !/import \{[^}]*\breadLines\b[^}]*\} from '[^']*(rows|score)\.ts'/.test(source)) offenders.push(`${relative(root, path)} calls a readLines that isn't rows.ts's`)
        }
      }
    }
    walk(join(root, 'lab'))
    walk(join(root, 'tests'))
    expect(offenders).toEqual([])
  })
})
