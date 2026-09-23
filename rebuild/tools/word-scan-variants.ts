// Gecko's word scan (src/engines/gecko/lines.ts wordScan) has no switch in the library. What the attacks and the probes
// need of it lives here: a copy of rebuild/src in the system's temporary folder with lines.ts edited at one marked line,
// which a tool imports or bundles beside the tree's own library.
// - `loop`: no scan goes to the word scan, so every scan is the engine's loop: the library before the word scan.
// - `proven`: the word scan never passes over a unit's inner candidates, so it decides only what needs no premise.
// - `counted`: the tree's library, which counts in `globalThis.wordScanTally` the scans the word scan decided, those it
//   left to the loop, and the units it passed over on the premise.
// The tree's own inspected paragraphs hold every scan the word scan decides against the loop (gaps.ts negativeWordTail),
// which is the checked form.
// An edit's marker must stand in lines.ts exactly once, or this throws: a change to the dispatcher has to come here too.
// The copy is named by a hash of the edited tree, so processes that want the same one share it, and a stale one is never
// read.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type WordScanVariant = 'loop' | 'proven' | 'counted'
export type WordScanTally = { decided: number; left: number; passed: number }

const SRC = resolve(import.meta.dir, '../src')
const LINES = 'engines/gecko/lines.ts'

const TALLY = '((globalThis as { wordScanTally?: { decided: number; left: number; passed: number } }).wordScanTally ??= { decided: 0, left: 0, passed: 0 })'
const EDITS: Record<WordScanVariant, { marker: string; with: string }[]> = {
  loop: [{ marker: '  const word = prov.run.hasTab ? null : wordScan(', with: '  const word = true ? null : wordScan(' }],
  proven: [{
    marker: '    if (natural >= 0 || (wrapping >= 0 && breakPriority <= WORD_WRAP_BREAK)) {\n',
    with: '    if (natural >= 0 || (wrapping >= 0 && breakPriority <= WORD_WRAP_BREAK)) {\n      return null\n',
  }],
  counted: [
    { marker: '  if (word === null) return loop ?? charScan(', with: `  ;${TALLY}[word === null ? 'left' : 'decided']++\n  if (word === null) return loop ?? charScan(` },
    { marker: '      lastBreakInside = true\n', with: `      lastBreakInside = true\n      ;${TALLY}.passed++\n` },
  ],
}

function filesUnder(dir: string, prefix: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.isDirectory()) filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`, out)
    else out.push(`${prefix}${entry.name}`)
  }
}

// The folder of the variant's copy of rebuild/src, made where it isn't there yet.
export function wordScanVariant(variant: WordScanVariant): string {
  let edited = readFileSync(join(SRC, LINES), 'utf8')
  const edits = EDITS[variant]
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!
    if (edited.split(edit.marker).length !== 2) throw new Error(`word-scan-variants: a marker of '${variant}' doesn't stand exactly once in ${LINES}`)
    edited = edited.replace(edit.marker, () => edit.with)
  }
  const files: string[] = []
  filesUnder(SRC, '', files)
  const hash = new Bun.CryptoHasher('sha256')
  hash.update(edited)
  for (let i = 0; i < files.length; i++) {
    hash.update(files[i]!)
    if (files[i] !== LINES) hash.update(readFileSync(join(SRC, files[i]!)))
  }
  const dir = join(tmpdir(), `pretext-word-scan-${variant}-${hash.digest('hex').slice(0, 16)}`)
  if (!existsSync(dir)) {
    const making = `${dir}.${process.pid}`
    mkdirSync(making, { recursive: true })
    cpSync(SRC, making, { recursive: true })
    writeFileSync(join(making, LINES), edited)
    // Another process may make it meanwhile; its copy is the same, and the rename then fails.
    try {
      renameSync(making, dir)
    } catch (error) {
      if (!existsSync(dir)) throw error
    }
  }
  return dir
}
