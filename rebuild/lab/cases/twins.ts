// Twin-string families (prefix 'twins/'; research/ARCHITECTURE-PLAN-2.md §7 check 9). In one style of a paragraph that
// Blink segments by script, the same run of 13 or more brackets stands once after Latin text and once after Arabic. The
// paragraph shapes the first under Latin and the second under Arabic, so the Blink port asks Canvas for the first as a
// one-byte string and for the second as a two-byte slice of the same characters (engines/blink/shape.ts canvasString).
// Chrome shapes the two differently in Amiri and keeps the first shaping per canvas (probes/blink-twins.ts,
// probes/blink-storage.ts S3). At the correctness line the slice reached Canvas as one-byte all the same, because
// measure/canvas.ts looked it up in the string memo first and V8 hands Blink a one-byte string after a keyed use. Since
// the string storage fix (research/BLINK-STRING-STORAGE.md) the slice reaches Canvas as built and a segmented paragraph
// measures its one-byte strings on contexts of their own, so no canvas is asked both. Few other tier cases ask such a
// slice at all (tools/twin-scan.ts: 96 of 66,692 Chrome case lines outside this set, none of them a pair on one context),
// and no offline tier sees a string's storage, so these cases are where a change of storage or of canvas shows, in tier 2
// alone. Never launches a browser.
//
//   bun rebuild/lab/cases/twins.ts [--out=FILE]
//
// Default out .artifacts/lab/cases/twins.ndjson; writes `<out>.summary.json` with the family counts next to it. The
// cases are fixed: there is nothing to draw, so no seed.
// - twins/latin-first and twins/arabic-first: the two orders, in a left-to-right block;
// - twins/rtl-block: both orders in a right-to-left block;
// - twins/spans: the two runs in spans of one style, and of two styles (two canvases: a control, no twin);
// - twins/short: 12 brackets, which V8 copies into a one-byte string when sliced (a control, no twin).
// Every shape at widths that keep the paragraph on one line, break between the two runs, and break inside them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Case } from '../types.ts'
import { font, paragraph, span, text, type ParagraphSpec, type Part } from './build.ts'
import { countFamilies, makeCase, mergeCases, sortCases } from './case.ts'

const ARABIC = 'عربي'
const RUNS = ['(((((((((((((', ')))))))))))))', '(((((((((((((((((((', '([{([{([{([{([{', '((((((()))))))', '[[[[[[[[[[[[[[', '«««««««««««««'] as const
const WIDTHS = [1200, 520, 330, 170, 90] as const

type Shape = { family: string; note: string; spec: ParagraphSpec; parts: Part[] }

function shapes(): Shape[] {
  const out: Shape[] = []
  for (const size of [16, 24]) {
    const amiri = font('Amiri', size)
    const block: ParagraphSpec = { font: amiri, lang: 'en', overflowWrap: 'anywhere' }
    for (let r = 0; r < RUNS.length; r++) {
      const run = RUNS[r]!
      out.push({ family: 'twins/latin-first', note: `run ${r + 1} at ${size}px`, spec: block, parts: [text(`abc ${run} ${ARABIC} ${run} def`)] })
      out.push({ family: 'twins/arabic-first', note: `run ${r + 1} at ${size}px`, spec: block, parts: [text(`${ARABIC} ${run} abc ${run} def`)] })
      out.push({ family: 'twins/latin-first', note: `run ${r + 1} at ${size}px, no spaces`, spec: block, parts: [text(`abc${run}${ARABIC}${run}def`)] })
      out.push({ family: 'twins/arabic-first', note: `run ${r + 1} at ${size}px, no spaces`, spec: block, parts: [text(`${ARABIC}${run}abc${run}def`)] })
    }
    const rtl: ParagraphSpec = { ...block, lang: 'ar', direction: 'rtl' }
    for (let r = 0; r < 3; r++) {
      const run = RUNS[r]!
      out.push({ family: 'twins/rtl-block', note: `run ${r + 1} at ${size}px, Latin first`, spec: rtl, parts: [text(`abc ${run} ${ARABIC} ${run} def`)] })
      out.push({ family: 'twins/rtl-block', note: `run ${r + 1} at ${size}px, Arabic first`, spec: rtl, parts: [text(`${ARABIC} ${run} abc ${run} ${ARABIC}`)] })
    }
    const run = RUNS[0]!
    out.push({ family: 'twins/spans', note: `${size}px, one style`, spec: block, parts: [span(`abc ${run} `, amiri), span(`${ARABIC} ${run}`, amiri), text(' def')] })
    out.push({ family: 'twins/spans', note: `${size}px, two styles`, spec: block, parts: [span(`abc ${run} `, amiri), span(`${ARABIC} ${run}`, font('Amiri', size, 700)), text(' def')] })
    const short = run.slice(0, 12)
    out.push({ family: 'twins/short', note: `${size}px, Latin first`, spec: block, parts: [text(`abc ${short} ${ARABIC} ${short} def`)] })
    out.push({ family: 'twins/short', note: `${size}px, Arabic first`, spec: block, parts: [text(`${ARABIC} ${short} abc ${short} def`)] })
  }
  return out
}

export function generateTwins(): Case[] {
  const cases: Case[] = []
  const all = shapes()
  for (let s = 0; s < all.length; s++) {
    const shape = all[s]!
    const made = paragraph(shape.spec, shape.parts)
    for (let w = 0; w < WIDTHS.length; w++) {
      cases.push(makeCase({
        family: shape.family, origin: `generator=twins shape=${s + 1} ${shape.note}`, pageLang: 'en', browsers: ['chrome'], fontFixtures: ['Amiri'],
        paragraph: { ...made, width: WIDTHS[w]! },
      }))
    }
  }
  return sortCases(mergeCases(cases))
}

if (import.meta.main) {
  let out = resolve(import.meta.dir, '../../../.artifacts/lab/cases/twins.ndjson')
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--out=')) out = resolve(arg.slice(6))
    else throw new Error(`Unknown argument ${arg}; usage: bun rebuild/lab/cases/twins.ts [--out=FILE]`)
  }
  const cases = generateTwins()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, cases.map(value => `${JSON.stringify(value)}\n`).join(''))
  const families = countFamilies(cases)
  writeFileSync(`${out.replace(/\.ndjson$/, '')}.summary.json`, `${JSON.stringify({ file: out, cases: cases.length, families }, null, 2)}\n`)
  console.log(`${out}: ${cases.length} cases`)
  console.log(JSON.stringify(families, null, 2))
}
