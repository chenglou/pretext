// A small set of real paragraphs for the calibration table: the long-form corpora main keeps in corpora/, cut at their
// own line ends, up to 60 paragraphs a corpus taken evenly through the text, each at six widths, styled the way main's
// canaries style that corpus (corpora/sources.json: font stack, size, line height, language, direction).
//   bun rebuild/tools/census/real-text.ts <cases.ndjson>
// A paragraph counts from 40 UTF-16 units, so headings and one-word lines stay out. One family a corpus: real/<corpus id>.
// `mixed-app-text` is main's synthetic stress text, not prose; the tables show it apart.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Source = { id: string; language: string; direction: 'ltr' | 'rtl'; output: string; font_family: string; font_size_px: number; line_height_px: number }

const ROOT = join(import.meta.dir, '../../..')
const WIDTHS = [240, 320, 400, 480, 600, 720]
const PER_CORPUS = 60
const MIN_UNITS = 40

const sources = JSON.parse(readFileSync(join(ROOT, 'corpora/sources.json'), 'utf8')) as Source[]
const out: string[] = []
for (let s = 0; s < sources.length; s++) {
  const source = sources[s]!
  const lines = readFileSync(join(ROOT, source.output), 'utf8').split('\n')
  const paragraphs: Array<{ line: number; text: string }> = []
  for (let l = 0; l < lines.length; l++) {
    const text = lines[l]!.trim()
    if (text.length >= MIN_UNITS) paragraphs.push({ line: l + 1, text })
  }
  const take = Math.min(PER_CORPUS, paragraphs.length)
  for (let k = 0; k < take; k++) {
    const paragraph = paragraphs[Math.floor(k * paragraphs.length / take)]!
    const font = { family: source.font_family, size: source.font_size_px, weight: 400, style: 'normal' }
    for (let w = 0; w < WIDTHS.length; w++) {
      out.push(JSON.stringify({
        id: `real-${source.id}-l${paragraph.line}-w${WIDTHS[w]}`,
        family: `real/${source.id}`,
        origin: `${source.output}:${paragraph.line}`,
        pageLang: source.language,
        paragraph: {
          runs: [{ text: paragraph.text, node: 'text', font, letterSpacing: 0, wordSpacing: 0, lang: null }],
          font, letterSpacing: 0, wordSpacing: 0, width: WIDTHS[w], lineHeight: source.line_height_px,
          whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
          direction: source.direction, lang: source.language,
        },
      }))
    }
  }
}
writeFileSync(process.argv[2]!, out.join('\n') + '\n')
console.log(`${out.length} cases from ${sources.length} corpora`)
