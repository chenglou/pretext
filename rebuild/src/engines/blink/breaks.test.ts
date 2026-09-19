// Break opportunities over one text node against the groundwork's C++ Blink oracle over Chrome 153's ICU data
// (DESIGN.md §8.2): runtime-parity/blink-webkit/work/blink-requests.jsonl and blink-answers.jsonl, 13,108 requests, each
// answered with the raw offsets where a line may start when ICU runs from the text start. SA runs need dictionary
// boundaries, which bun doesn't have (the lab runs them in Chrome), so only differences outside SA runs count.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { indexContent } from '../../content.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { forEachLine } from '../../../tools/lines.ts'
import { LineBreakIterator, lineTable } from './breaks.js'
import { buildContent, stylesOf } from './content.js'
import { LB_SA, lineBreakClass } from './props.js'

const WORK = `${process.env['HOME']}/github/browser-engines/pretext-emulation-20260915/runtime-parity/blink-webkit/work`

type Request = { id: string; text: string; whiteSpace: 'normal' | 'pre-wrap'; wordBreak: 'normal' | 'keep-all'; lang: string | null }
type Answer = { id: string; rules?: string; perLine?: number[][]; error?: string }

function paragraphOf(r: Request): Paragraph {
  const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts: UNKNOWN_FONT_FACTS }
  // The oracle's page has <html lang="en">; a request's lang is the div's (null: none, "": lang="").
  return {
    content: [{ kind: 'text', text: r.text }], font, letterSpacing: 0, wordSpacing: 0,
    lineHeight: 20, whiteSpace: r.whiteSpace, wordBreak: r.wordBreak, overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    // No lang on the div inherits <html lang="en">, which the model writes as the element's own lang.
    direction: 'ltr', lang: r.lang ?? 'en', textIndent: 0, textAlign: 'start',
  }
}

export function opportunities(r: Request): number[] {
  const paragraph = paragraphOf(r)
  // The oracle resolved lang "" as a null locale with UI language zh-CN (tools/diff-blink.ts ResolveLocale).
  const env: BlinkEnvironment = {
    engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'zh-CN',
    dictionaryBreaks: { kind: 'unavailable' },
  }
  const index = indexContent(paragraph)
  const { styles: st, styleOfLeaf, styleOfElement } = stylesOf(paragraph, index, 1)
  const content = buildContent(index, st, styleOfLeaf, styleOfElement)
  let is8Bit = true
  for (let i = 0; i < content.text.length; i++) if (content.text.charCodeAt(i) > 0xff) { is8Bit = false; break }
  const it = new LineBreakIterator(content.text, is8Bit, {
    autoWrap: true, strictness: 'default', breakType: r.wordBreak, breakAnywhereIfOverflow: false, softHyphen: true, breakSpace: 'after-space-run',
  }, env.uiLanguage, env.dictionaryBreaks)
  it.locale = st[0]!.locale
  it.setStartOffset(0)
  const out: number[] = []
  let previous = -1
  for (let q = 1; q < content.text.length; q++) {
    if (!it.isBreakable(q)) continue
    let raw = r.text.length
    for (let u = q; u < content.sourceOffsets.length; u++) if (content.sourceOffsets[u]! >= 0) { raw = content.sourceOffsets[u]!; break }
    if (raw !== previous) out.push(raw)
    previous = raw
  }
  return out
}

function insideSa(s: string, p: number): boolean {
  if (p <= 0 || p >= s.length) return false
  const before = s.codePointAt(p - 1)!
  const beforeCp = (before & 0xfc00) === 0xdc00 && p >= 2 ? s.codePointAt(p - 2)! : before
  return lineBreakClass(beforeCp) === LB_SA && lineBreakClass(s.codePointAt(p)!) === LB_SA
}

describe('blink break opportunities', () => {
  test('rule file per locale (specs/blink-canvas.md §2.3)', () => {
    expect(lineTable('en', 'default', 'zh-CN')).toBe('line_normal')
    expect(lineTable('zh-TW', 'default', 'en')).toBe('line_normal_cj')
    expect(lineTable('ja', 'normal', 'en')).toBe('line_normal_cj')
    expect(lineTable('ko', 'strict', 'zh-CN')).toBe('line_normal_cj')
    expect(lineTable('ko', 'strict', 'en')).toBe('line_normal')
    expect(lineTable(null, 'strict', 'zh-CN')).toBe('line_normal_cj')
    expect(lineTable('en', 'loose', 'zh-CN')).toBe('line_loose')
    // Without a given UI language, content without a locale opens line_normal (and reports ui-language).
    expect(lineTable(null, 'default', null)).toBe('line_normal')
  })

  test('worked examples (specs/blink-text.md §2.F.5)', () => {
    const at = (text: string, wordBreak: Request['wordBreak'] = 'normal'): number[] => opportunities({ id: '', text, whiteSpace: 'normal', wordBreak, lang: null })
    expect(at('a )')).toEqual([2])
    expect(at('x!é')).toEqual([2])
    expect(at('x!a')).toEqual([])
    expect(at('ABCD-1234')).toEqual([5])
    expect(at('x -1')).toEqual([2])
    expect(at('é-1')).toEqual([])
    expect(at('a-é')).toEqual([2])
  })

  test.skipIf(!existsSync(`${WORK}/blink-requests.jsonl`))('groundwork oracle answers', async () => {
    const answers = new Map<string, Answer>()
    await forEachLine(`${WORK}/blink-answers.jsonl`, line => { const a = JSON.parse(line) as Answer; answers.set(a.id, a) })
    let requests = 0
    let differing = 0
    const examples: string[] = []
    await forEachLine(`${WORK}/blink-requests.jsonl`, line => {
      const r = JSON.parse(line) as Request
      const a = answers.get(r.id)!
      if (a.perLine === undefined) return
      requests++
      const ours = opportunities(r)
      const oracle = a.perLine[0]!
      const set = new Set(oracle)
      const mine = new Set(ours)
      const outside: number[] = []
      for (const x of ours) if (!set.has(x) && !insideSa(r.text, x)) outside.push(x)
      for (const x of oracle) if (!mine.has(x) && !insideSa(r.text, x)) outside.push(x)
      if (outside.length > 0) {
        differing++
        if (examples.length < 8) examples.push(`${r.id} ${JSON.stringify(r.text.slice(0, 80))} ${r.whiteSpace} ${r.wordBreak} ${r.lang} at ${outside.slice(0, 6).join(',')}`)
      }
    })
    if (examples.length > 0) console.log(examples.join('\n'))
    console.log(JSON.stringify({ requests, differing }))
    expect(requests).toBe(13108)
    expect(differing).toBe(0)
  }, 120_000)
})
