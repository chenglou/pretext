// A lab set from the samples of probe gecko-windows-attack: each sample, one paragraph of one text node without spaces,
// at widths that put breaks beside window edges. For full-width text 16 clusters are 16 times the font size, so at that
// width every line ends at a cut, one px under it a line ends one cluster before, and the third width walks the breaks
// through every phase of the grid. Run the set in pinned Firefox from a tree without windows inside long shaping units
// and from a tree with them, and hold the rows against each other with lab/compare-rows.ts
// --prediction=without-measure: line ranges, widths, exact values, gap lists and painted lines must be equal.
//
//   bun rebuild/tools/windows-attack-cases.ts <out.ndjson>
import { writeFileSync } from 'node:fs'
import { samples } from '../probes/gecko-windows-attack.ts'

const FIXTURES = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Shantell Sans']
const out = process.argv[2]
if (out === undefined) throw new Error('an output path')
const all = samples()
const lines: string[] = []
for (let i = 0; i < all.length; i++) {
  const s = all[i]!
  // A font of 100px and more makes lines of a cluster or two; the probe covers those units.
  if (s.cls === 'wide') continue
  const font = { family: s.family, size: s.size, weight: s.weight, style: s.style }
  const widths = s.cls === 'long' ? [16 * s.size] : [16 * s.size, 16 * s.size - 1, Math.round(7.3 * s.size * 8) / 8]
  const fontFixtures = FIXTURES.filter(family => s.family.includes(family))
  for (let w = 0; w < widths.length; w++) {
    lines.push(JSON.stringify({
      id: `windows-attack/${i}-${w}`, family: `windows-attack/${s.cls}`, origin: `probe gecko-windows-attack sample ${i}: ${s.id}`, pageLang: 'en',
      paragraph: {
        runs: [{ text: s.text, node: 'text', font, letterSpacing: s.letterSpacing, wordSpacing: 0, lang: null }],
        font, letterSpacing: s.letterSpacing, wordSpacing: 0, width: widths[w]!, lineHeight: Math.ceil(s.size * 1.6), whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto',
        tabSize: 8, direction: s.direction, lang: s.lang,
      },
      ...(fontFixtures.length > 0 ? { fontFixtures } : {}),
    }))
  }
}
writeFileSync(out, lines.join('\n') + '\n')
console.log(`${lines.length} cases`)
