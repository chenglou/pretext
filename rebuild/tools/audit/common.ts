// Shared pieces of the requirements audit (research/REQUIREMENTS-AUDIT.md): the inputs (chat messages as the bench builds
// them, the census's real paragraphs), the page facts of the three pinned browsers, and a Canvas wrapper that counts
// every measureText call and the characters it sends, and names the library functions on the stack that asked it.
// Nothing in rebuild/src counts anything; the counting sits on the Canvas the library is handed.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildChat, CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_STYLE } from '../../bench/cases.ts'
import type { ChatSetId } from '../../bench/protocol.ts'
import { detectEnvironment, type Environment, type GivenFacts } from '../../src/env.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../../src/model.ts'

export type BrowserName = 'chrome' | 'firefox' | 'webkit-host'
export const BROWSERS: readonly BrowserName[] = ['chrome', 'firefox', 'webkit-host']

// The page facts and process languages of the census's real-text rows (2026-09-19), which are this machine's pinned
// browsers at DPR 2.
export const PAGE: Record<BrowserName, { userAgent: string; devicePixelRatio: number; pageLang: string; given: GivenFacts }> = {
  chrome: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    devicePixelRatio: 2, pageLang: 'en',
    given: { engine: 'blink', build: '153.0.8010.50', contentLanguage: null, uiLanguage: 'zh-CN' },
  },
  firefox: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
    devicePixelRatio: 2, pageLang: 'en',
    given: { engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: 'zh-hans-us' },
  },
  'webkit-host': {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15 webkit-host/22625.1.29.11.27',
    devicePixelRatio: 2, pageLang: 'en',
    given: { engine: 'webkit', build: '22625.1.29.11.27', contentLanguage: null, pageZoom: 1, preferredLanguages: ['zh-CN', 'zh-Hans'], icuDefaultLocale: 'en_US_POSIX' },
  },
}

export function environmentFor(browser: BrowserName): Environment {
  const detected = detectEnvironment(PAGE[browser].given)
  if (detected.kind !== 'supported') throw new Error(`unsupported: ${detected.reason}`)
  return detected.env
}

// One input paragraph with a name and the width it is filled at.
export type Input = { id: string; family: string; units: number; paragraph: Paragraph; widths: number[] }

const TEXT = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const

// The bench's chat messages (bench/cases.ts buildChat) as the bench page hands them to the library (bench/page.ts
// chatInputs): one declaration for the bubble, inline code as a 14px Menlo span with 6px padding on each side.
export function chatInputs(set: ChatSetId, count: number, widths: number[] = [320]): Input[] {
  const messages = buildChat(set, count)
  const font: FontDecl = { ...CHAT_STYLE.font, facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { ...CHAT_CODE_FONT, facts: UNKNOWN_FONT_FACTS }
  const edge: BoxEdge = { margin: 0, border: 0, padding: CHAT_CODE_PADDING }
  const out: Input[] = []
  for (let i = 0; i < messages.length; i++) {
    const parts = messages[i]!.parts
    const content: InlineNode[] = []
    let units = 0
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k]!
      units += part.text.length
      if (part.code) content.push({ ...TEXT, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
      else content.push({ kind: 'text', text: part.text })
    }
    out.push({
      id: `chat-${set}-${i}`, family: `chat/${set}/${messages[i]!.kind}`, units,
      paragraph: { ...TEXT, font, content, lineHeight: CHAT_STYLE.lineHeight, direction: CHAT_STYLE.direction, lang: CHAT_STYLE.lang, textIndent: 0, textAlign: 'start' },
      widths,
    })
  }
  return out
}

// A lab case (lab/types.ts Case) with plain runs as the library's paragraph, as lab/predictor-core.ts layoutInput builds
// it for runs without inline structure.
type CaseFont = { family: string; size: number; weight: number; style: string }
type CaseRun = { text: string; node: 'text' | 'span'; font: CaseFont; letterSpacing: number; wordSpacing: number; lang: string | null }
export type LabCase = {
  id: string; family: string; pageLang: string
  paragraph: {
    runs: CaseRun[]; font: CaseFont; letterSpacing: number; wordSpacing: number; width: number; lineHeight: number
    whiteSpace: Paragraph['whiteSpace']; wordBreak: Paragraph['wordBreak']; overflowWrap: Paragraph['overflowWrap']; lineBreak: Paragraph['lineBreak']
    tabSize: number; direction: Paragraph['direction']; lang: string
  }
}

export function paragraphOfCase(c: LabCase): Paragraph {
  const p = c.paragraph
  const decl = (font: CaseFont): FontDecl => ({ ...(font as FontDecl), facts: UNKNOWN_FONT_FACTS })
  const style = (font: CaseFont, letterSpacing: number, wordSpacing: number) => ({
    font: decl(font), letterSpacing, wordSpacing, whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, tabSize: p.tabSize,
  })
  const content: InlineNode[] = []
  for (let r = 0; r < p.runs.length; r++) {
    const run = p.runs[r]!
    if (run.node === 'text') content.push({ kind: 'text', text: run.text })
    else content.push({ ...style(run.font, run.letterSpacing, run.wordSpacing), kind: 'span', lang: run.lang, inlineStart: { margin: 0, border: 0, padding: 0 }, inlineEnd: { margin: 0, border: 0, padding: 0 }, verticalAlign: 'baseline', children: [{ kind: 'text', text: run.text }] })
  }
  return { ...style(p.font, p.letterSpacing, p.wordSpacing), content, lang: p.lang, direction: p.direction, lineHeight: p.lineHeight, textIndent: 0, textAlign: 'start' }
}

export const REAL_TEXT_CASES = resolve(process.env['HOME']!, 'github/pretext-rebuild/.artifacts/census-20260919/real-text/cases.ndjson')

// The census's real paragraphs (research/CALIBRATION.md §7): 781 paragraphs of 18 corpora at 6 widths. `oneWidth` keeps
// one case per paragraph, at that width, for per-paragraph costs.
export function realTextCases(oneWidth: number | null = null): LabCase[] {
  const out: LabCase[] = []
  const lines = readFileSync(REAL_TEXT_CASES, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue
    const c = JSON.parse(lines[i]!) as LabCase
    if (oneWidth !== null && c.paragraph.width !== oneWidth) continue
    out.push(c)
  }
  return out
}

export function realTextInputs(oneWidth: number | null = 400): Input[] {
  const cases = realTextCases(oneWidth)
  const out: Input[] = []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!
    let units = 0
    for (let r = 0; r < c.paragraph.runs.length; r++) units += c.paragraph.runs[r]!.text.length
    out.push({ id: c.id, family: c.family, units, paragraph: paragraphOfCase(c), widths: [c.paragraph.width] })
  }
  return out
}
