// main's engine facts as browser cases. src/layout.test.ts pins 36 rules main learned about the engines (research/TESTS.md
// §1c in the rebuild), each against a fake Canvas and one engine profile, and 33 of them use texts no browser case holds.
// data/engine-facts.json keeps the texts of the 28 whose tests lay out plain text, taken from the tests once, with the
// white-space and word-break modes and page languages each test names. Each fact's test name and line number are
// those of main before #340 (harness/README.md, Adding a case), and the number names its family, so both stay as the
// tests change. The tab-stop fact has a second row, in pre-wrap alone, under the same name: tabs under half a space,
// under half a `0` and exactly half a `0` before a stop, which its own text, `a`, tab, `b`, never reaches; its rule's
// test is now "a tab nearer its stop than the engine's minimum takes the stop after". The fact of Firefox's tab that
// doesn't hang has a second row too: a word, a tab, a space and a tab after a break, where Firefox ends no line inside
// the run of white space, so its line returns to the break or, on a line without one, wraps before the second tab.
// The ones that lay out rich items are in rich.ts, and three read only the user agent. A fact added since keeps its
// test's line as of the pull request or commit that added it, which harness/README.md names (Adding a case), and names
// the paragraph directions it runs in where a browser's lines turn on them (left-to-right otherwise). Here each text
// runs in 16px Arial, or in each family its fact names where the fact is a font's, and widths.ts finds where each
// browser's lines change.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { font, paragraph } from './build.ts'
import type { Template } from './widths.ts'

type Fact = { test: string; texts: string[]; modes: Array<'normal' | 'pre-wrap' | 'keep-all'>; pageLangs: string[]; families?: string[]; directions?: Array<'ltr' | 'rtl'> }

export function factTemplates(): Template[] {
  const facts = JSON.parse(readFileSync(join(import.meta.dir, 'data/engine-facts.json'), 'utf8')) as Fact[]
  const out: Template[] = []
  for (let f = 0; f < facts.length; f++) {
    const fact = facts[f]!
    const line = /:(\d+) /.exec(fact.test)![1]!
    const families = fact.families ?? ['Arial']
    const directions = fact.directions ?? ['ltr']
    for (let d = 0; d < directions.length; d++) for (let t = 0; t < fact.texts.length; t++) for (let m = 0; m < fact.modes.length; m++) for (let l = 0; l < fact.pageLangs.length; l++) for (let k = 0; k < families.length; k++) {
      const mode = fact.modes[m]!
      const lang = fact.pageLangs[l]!
      out.push({
        family: `facts/layout.test.ts:${line}`, origin: fact.test, pageLang: lang, widths: [], grid: true,
        paragraph: paragraph({ font: font(families[k]!, 16), lang, whiteSpace: mode === 'pre-wrap' ? 'pre-wrap' : 'normal', wordBreak: mode === 'keep-all' ? 'keep-all' : 'normal', direction: directions[d]! }, [fact.texts[t]!]),
      })
    }
  }
  return out
}
