// The grapheme check under Bun, as the WebKit (Bun on macOS reads libicucore) or another engine's
// profile picks by ENGINE=blink|webkit|gecko, from the repository root:
//   bun scripts/grapheme-check/build.ts
//   ENGINE=webkit bun scripts/grapheme-check/offline.ts > bun.json
// Node can't load src/ directly, whose .js specifiers point at .ts sources; bundle it first:
//   bun build --target=node scripts/grapheme-check/offline.ts --outfile=.artifacts/grapheme-check/offline.mjs
//   ENGINE=blink node .artifacts/grapheme-check/offline.mjs > node.json
import { readFileSync } from 'node:fs'
import { runGraphemeCheck } from './check.ts'

const texts = JSON.parse(readFileSync('.artifacts/grapheme-check/page/texts.json', 'utf8')) as string[]

const engine = process.env['ENGINE'] ?? 'webkit'
const userAgent = engine === 'gecko' ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0'
  : engine === 'webkit' ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15'
  : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true })
// prepareWithSegments() measures; any width does here.
Reflect.set(globalThis, 'OffscreenCanvas', class {
  getContext() { return { font: '', letterSpacing: '0px', measureText: (text: string) => ({ width: text.length * 8 }) } }
})
console.log(JSON.stringify(await runGraphemeCheck(texts, Number(process.env['FUZZ'] ?? 200_000), line => console.error(line))))
