// Reading row files, plain or compressed. `.artifacts/session/compress-rows.sh` turns `<name>-rows.ndjson` into
// `<name>-rows.ndjson.zst` (rows are most of the lab's disk use), so every tool that reads rows goes through this file: a
// compressed file can never look like a missing run, or make a tool ask for `zstd -d` by hand. rows.test.ts holds the rules,
// and checks that no other lab or tests file opens a rows file on its own.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// The file that holds `path`'s rows: `path` itself, or the other spelling (`path` with or without `.zst`) when only that one
// exists. null when neither exists.
export function existingRows(path: string): string | null {
  if (existsSync(path)) return path
  const other = path.endsWith('.zst') ? path.slice(0, -'.zst'.length) : `${path}.zst`
  return existsSync(other) ? other : null
}

function mustExist(path: string): string {
  const found = existingRows(path)
  if (found === null) throw new Error(`${path}: no such rows file, plain or .zst`)
  return found
}

// Lines of an NDJSON file, split on LF only (JSON strings can hold U+2028); a .zst file is read through zstd. One line is
// held at a time. Empty lines are skipped.
export async function* readLines(path: string): AsyncGenerator<string> {
  const file = mustExist(path)
  const zstd = file.endsWith('.zst') ? Bun.spawn(['zstd', '-dc', '--', file], { stdout: 'pipe', stderr: 'inherit' }) : null
  const stream: ReadableStream<Uint8Array> = zstd === null ? Bun.file(file).stream() : zstd.stdout
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true })
      let start = 0
      for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n', start)) {
        if (index > start) yield buffer.slice(start, index)
        start = index + 1
      }
      buffer = buffer.slice(start)
    }
    buffer += decoder.decode()
    if (buffer.trim() !== '') yield buffer
    if (zstd !== null && (await zstd.exited) !== 0) throw new Error(`zstd -dc ${file} exited ${zstd.exitCode}`)
  } finally {
    // A reader that stops early (a --limit) leaves zstd blocked on a full pipe.
    if (zstd !== null && zstd.exitCode === null) zstd.kill()
  }
}

// A plain file with `path`'s rows, for tools that read rows by byte offset (score.ts indexRows, readRowAt): the file itself,
// or a decompressed copy in a temporary folder, which release() removes. The copy also goes when the process
// exits without releasing it.
export function plainRows(path: string): { path: string; release: () => void } {
  const file = mustExist(path)
  if (!file.endsWith('.zst')) return { path: file, release: () => {} }
  const dir = mkdtempSync(join(tmpdir(), 'lab-rows-'))
  const plain = join(dir, basename(file).slice(0, -'.zst'.length))
  execFileSync('zstd', ['-dq', '-o', plain, '--', file], { stdio: ['ignore', 'ignore', 'inherit'] })
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    rmSync(dir, { recursive: true, force: true })
  }
  process.once('exit', release)
  return { path: plain, release }
}
