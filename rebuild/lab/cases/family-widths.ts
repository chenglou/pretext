// Seeded widths for the rule and feature family paragraphs (family prefix 'rule/').
//
// The family builders in rebuild/tests/families take a seeded stream and never draw from it: every seed gives the same
// 3,276 paragraphs, and derive.ts gives them the same widths, so a new seed makes no new case. What can vary is the width.
// This generator reads a browser's derived family cases (rebuild/tests/derive.ts, <dir>/final/family-cases.ndjson) and lays
// each family paragraph out at widths nobody observed:
// - near a derived bracket (70%): a reach or short case's width moved by ±2 to ±128 units of 1/64 px, so the browser's
//   decision at the bracket stays what derivation observed while the prediction's margin at that decision is new;
// - between brackets (30%): a width drawn between the paragraph's narrowest and widest derived widths, on the 1/64 px grid.
// A paragraph with line slots never goes below its narrowest derived width, which derivation kept above the slot floor
// (rebuild/tests/derive.ts minimumUnits), so the slot protocol holds. The cases keep their family and browser scope, and
// their origin names the case they came from. Nothing here reads a prediction.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BrowserKind, Case } from '../types.ts'
import { makeCase, mergeCases, sortCases } from './case.ts'
import { createRng } from './prng.ts'

const REPO = resolve(import.meta.dir, '../../..')
const NEAR_UNITS = [2, 3, 4, 6, 8, 16, 32, 64, 128] as const

// The derivations of 2026-09-16 (rule families) and 2026-09-17 (feature families). Installed Safari takes webkit-host's.
export function defaultFamilyDirs(browser: BrowserKind): string[] {
  const name = browser === 'safari' ? 'webkit-host' : browser
  return [
    join(REPO, '.artifacts/charter-20260916/tests/families-20260916', name, 'final'),
    join(REPO, '.artifacts/tests/features-20260917', name, 'final'),
  ]
}

type Derived = { value: Case; role: string }

export type FamilyWidthsResult = { cases: Case[]; paragraphs: number; sources: Array<{ file: string; cases: number; paragraphs: number }> }

// `perParagraph` widths for every family paragraph with a derived bracket. `used` ids are skipped, and a width that
// collides is drawn again, up to 8 times.
export function familyWidthCases(seed: string, dirs: readonly string[], perParagraph: number, used: ReadonlySet<string>): FamilyWidthsResult {
  const out: Case[] = []
  const sources: FamilyWidthsResult['sources'] = []
  let paragraphs = 0
  for (let d = 0; d < dirs.length; d++) {
    const file = join(dirs[d]!, 'family-cases.ndjson')
    if (!existsSync(file)) throw new Error(`No derived family cases at ${file}`)
    const byParagraph = new Map<string, Derived[]>()
    const lines = readFileSync(file, 'utf8').split('\n')
    let count = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === '') continue
      const value = JSON.parse(lines[i]!) as Case
      count++
      // A case shared by several paragraphs lists every role in its origin; the first names the paragraph it is kept under.
      const match = /paragraph=(p-[0-9a-f]{16}) role=([A-Za-z-]+)/.exec(value.origin)
      if (match === null) continue
      let list = byParagraph.get(match[1]!)
      if (list === undefined) byParagraph.set(match[1]!, (list = []))
      list.push({ value, role: match[2]! })
    }
    let withBrackets = 0
    for (const key of [...byParagraph.keys()].sort()) {
      const sized = byParagraph.get(key)!.filter(entry => entry.role === 'reach' || entry.role === 'short')
      if (sized.length === 0) continue
      withBrackets++
      sized.sort((a, b) => a.value.paragraph.width - b.value.paragraph.width || (a.value.id < b.value.id ? -1 : 1))
      const narrowest = sized[0]!.value.paragraph.width
      const widest = sized[sized.length - 1]!.value.paragraph.width
      const rng = createRng(`${seed}/family-widths/${key}`)
      const seen = new Set<string>()
      for (let n = 0; n < perParagraph; n++) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const from = rng.pick(sized).value
          const slots = from.inline !== undefined && from.inline.lineSlots.length > 0
          let width: number
          let note: string
          if (rng.chance(0.7) || widest === narrowest) {
            const units = rng.pick(NEAR_UNITS) * (rng.chance(0.5) ? 1 : -1)
            width = from.paragraph.width + units / 64
            note = `near=${units}/64px`
          } else {
            width = Math.round((narrowest + rng.next() * (widest - narrowest)) * 64) / 64
            note = 'between'
          }
          if (!(width >= 1) || (slots && width < narrowest)) continue
          const value = makeCase({
            family: from.family, origin: `fresh-widths seed=${seed} paragraph=${key} from=${from.id} ${note}`, pageLang: from.pageLang,
            paragraph: { ...from.paragraph, width }, browsers: from.browsers, fontFixtures: from.fontFixtures, inline: from.inline,
          })
          if (used.has(value.id) || seen.has(value.id)) continue
          seen.add(value.id)
          out.push(value)
          break
        }
      }
    }
    paragraphs += withBrackets
    sources.push({ file, cases: count, paragraphs: withBrackets })
  }
  return { cases: sortCases(mergeCases(out)), paragraphs, sources }
}
