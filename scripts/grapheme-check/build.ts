// Builds the grapheme check into .artifacts/grapheme-check/page/: a page that compares
// src/graphemes.ts with the browser's own Intl.Segmenter (page.ts), and the texts it reads, which
// are the harness's case texts, whole and run by run. The book set holds every corpus whole.
//
//   bun scripts/grapheme-check/build.ts
//   bun scripts/grapheme-check/run.ts --browser=chrome|firefox|webkit-host
//   ENGINE=webkit bun scripts/grapheme-check/offline.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Case } from '../../harness/types.ts'

const root = resolve(import.meta.dir, '../..')
const out = join(root, '.artifacts/grapheme-check')
mkdirSync(join(out, 'page'), { recursive: true })

const texts = new Set<string>()
const cases = join(root, 'harness/cases')
const files = readdirSync(cases).filter(name => name.endsWith('.ndjson')).sort()
for (let f = 0; f < files.length; f++) {
  const lines = readFileSync(join(cases, files[f]!), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue
    const runs = (JSON.parse(lines[i]!) as Case).paragraph.runs
    texts.add(runs.map(run => run.text).join(''))
    if (runs.length > 1) for (let r = 0; r < runs.length; r++) texts.add(runs[r]!.text)
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
