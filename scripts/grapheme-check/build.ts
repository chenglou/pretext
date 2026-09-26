// Builds the grapheme check into .artifacts/grapheme-check/page/: a page that compares
// src/graphemes.ts with the browser's own Intl.Segmenter (page.ts), and the texts it reads, which
// are every corpus paragraph and the wrapping suite's texts and items.
//
//   bun scripts/grapheme-check/build.ts
//   bun scripts/grapheme-check/run.ts --browser=chrome|safari|firefox
//   ENGINE=webkit bun scripts/grapheme-check/offline.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { generateCases } from '../../tests/wrapping/cases.ts'

const root = resolve(import.meta.dir, '../..')
const out = join(root, '.artifacts/grapheme-check')
mkdirSync(join(out, 'page'), { recursive: true })

const texts = new Set<string>()
const corpora = join(root, 'corpora')
const files = readdirSync(corpora)
for (let f = 0; f < files.length; f++) {
  if (!files[f]!.endsWith('.txt')) continue
  const paragraphs = readFileSync(join(corpora, files[f]!), 'utf8').split(/\n\s*\n/)
  for (let p = 0; p < paragraphs.length; p++) if (paragraphs[p]!.trim() !== '') texts.add(paragraphs[p]!.trim())
}
const browsers = ['chrome', 'safari', 'firefox'] as const
for (let b = 0; b < browsers.length; b++) {
  const cases = generateCases(text => text.length * 8, { schedule: 'full', browser: browsers[b]! })
  for (let c = 0; c < cases.length; c++) {
    texts.add(cases[c]!.text)
    const parts = cases[c]!.parts ?? []
    for (let k = 0; k < parts.length; k++) texts.add(parts[k]!)
  }
}
writeFileSync(join(out, 'page/texts.json'), JSON.stringify([...texts]))
writeFileSync(join(out, 'page/index.html'), `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Grapheme check</title>
<body style="font: 12px Menlo; white-space: pre">
<div id="status"></div>
<script type="module" src="./check.js"></script>
</body>
</html>
`)
const result = await Bun.build({ entrypoints: [join(import.meta.dir, 'page.ts')], target: 'browser', format: 'esm' })
if (!result.success) throw new AggregateError(result.logs, 'bundling the grapheme check failed')
await Bun.write(join(out, 'page/check.js'), result.outputs[0]!)
console.log(`built ${out}: ${texts.size} texts`)
