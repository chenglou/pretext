// Gecko's word scan (src/engines/gecko/lines.ts wordScan) has no switch and keeps no count in the library. What the tests
// and the study need of it lives here: a copy of rebuild/src in the system's temporary folder with lines.ts edited at
// one marked line, which a tool imports or bundles beside the tree's own library.
// - `loop`: no scan goes to the word scan, so every plain scan is the engine's loop: the library before the word scan.
// - `proven`: the word scan never passes over a unit's inner candidates, so it decides only what needs no premise.
// - `checked`: every scan the word scan decides is decided by the engine's loop too, and a difference in any of the
//   record's seven fields throws; `globalThis.wordScanTally` counts the scans it decided and the scans it left.
// An edit's marker must stand in lines.ts exactly once, or this throws: a change to the dispatcher has to come here too.
// The copy is named by a hash of the edited tree, so processes that want the same one share it, and a stale one is never
// read.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type WordScanVariant = 'loop' | 'proven' | 'checked'
export type WordScanTally = { decided: number; left: number }

const SRC = resolve(import.meta.dir, '../src')
const LINES = 'engines/gecko/lines.ts'
const ARGS = 'p, prov, aStart, aMaxLength, aWidth, suppress, canWordWrap, canWhitespaceWrap, isBreakSpaces, wantTrimmable, priorityIn'

const EDITS: Record<WordScanVariant, { marker: string; with: string }> = {
  loop: { marker: '  if (consulted === null) {\n    const decided = wordScan(', with: '  if (false) {\n    const decided = wordScan(' },
  proven: {
    marker: '    if (natural >= 0 || (wrapping >= 0 && breakPriority <= WORD_WRAP_BREAK)) {\n',
    with: '    if (natural >= 0 || (wrapping >= 0 && breakPriority <= WORD_WRAP_BREAK)) {\n      return null\n',
  },
  checked: {
    marker: '    if (decided !== null) return decided\n',
    with: `    const tally = ((globalThis as { wordScanTally?: { decided: number; left: number } }).wordScanTally ??= { decided: 0, left: 0 })
    if (decided !== null) {
      const loop = charScan(${ARGS}, consulted)
      if (loop.charsFit !== decided.charsFit || loop.advance !== decided.advance || loop.trimmableChars !== decided.trimmableChars ||
        loop.trimmableAdvance !== decided.trimmableAdvance || loop.usedHyphenation !== decided.usedHyphenation || loop.lastBreak !== decided.lastBreak ||
        loop.breakPriority !== decided.breakPriority) {
        throw new Error(\`gecko: the word scan differs from the engine's loop at \${aStart}, length \${aMaxLength}, width \${aWidth}: \${JSON.stringify(decided)} against \${JSON.stringify(loop)}\`)
      }
      tally.decided++
      return decided
    }
    tally.left++
`,
  },
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
  const edit = EDITS[variant]
  const lines = readFileSync(join(SRC, LINES), 'utf8')
  if (lines.split(edit.marker).length !== 2) throw new Error(`word-scan-variants: the marker of '${variant}' doesn't stand exactly once in ${LINES}`)
  const edited = lines.replace(edit.marker, () => edit.with)
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

export async function wordScanLibrary(variant: WordScanVariant): Promise<typeof import('../src/index.ts')> {
  return await import(join(wordScanVariant(variant), 'index.ts')) as typeof import('../src/index.ts')
}
