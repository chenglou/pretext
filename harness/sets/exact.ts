// Filed reports, with the text, font, width and styles the reporter gave, which need no search for widths. Issues whose
// width was measured from the reporter's own Canvas go through the width search instead, as catalog templates in
// catalog.ts. The oracles for documented modes (pre-wrap, keep-all, symbols, letter spacing, soft hyphens), which the
// old harness ran in Chrome and Safari only, were taken once into oracles.ndjson, which every browser runs.
import type { Case, Paragraph } from '../types.ts'
import { makeCase, paragraph, parseFont, span } from './build.ts'

type Report = {
  issue: string
  text: string | ReadonlyArray<string | { text: string; font: string }>
  font: string
  width: number
  lineHeight?: number
  whiteSpace?: Paragraph['whiteSpace']
  lang?: string
  letterSpacing?: number
}

// Each report's text, font, width and styles as filed. A font the Mac lacks (Calibri, "Test Sans") stays as filed: the
// browser and Canvas fall back the same way an app on this Mac does.
const REPORTS: readonly Report[] = [
  { issue: '#49', text: 'alpha\u{200B}beta', font: '16px Inter', width: 10, lineHeight: 19 },
  { issue: '#49', text: 'alpha\u{200B}beta\u{200C}gamma', font: '16px Inter', width: 10, lineHeight: 19 },
  { issue: '#50', text: 'Hello 世界 مرحبا \u{1F30D} test', font: '16px Inter', width: 80, lineHeight: 19 },
  { issue: '#57', text: 'AGI 春天到了. بدأت الرحلة 🚀 Hello worsss!AGI 春天到了', font: '16px Inter, system-ui, -apple-system, "Segoe UI", Arial', width: 320, lineHeight: 22 },
  { issue: '#64', text: 'Hello, Pretext! 这是一个测试文本。This is a test text.', font: '16px Arial', width: 26, lineHeight: 20 },
  { issue: '#89', text: 'We must also consider edge-case strings. Consider a long, continuous tracking URL like https://www.super-long-domain-name.com/api/v1/tracking/xyz12345987654321.', font: '16px Inter, system-ui, sans-serif', width: 600, lineHeight: 24 },
  { issue: '#89', text: 'They remain hyper-focused on delivering a best-in-class experience.', font: '16px Inter, system-ui, sans-serif', width: 400, lineHeight: 24 },
  { issue: '#89', text: 'breaking before the full stop. Similarly, the Chinese localization, 我们正在测试文本换行和分段功能，看看浏览器如何处理它。, worked lawlessly even inside tightly constrained flexbox containers.', font: '16px Inter, system-ui, sans-serif', width: 600, lineHeight: 24 },
  { issue: '#89', text: 'Thai text, which requires dictionary-based line breaking, was also verified: นี่คือข้อความภาษาไทยสำหรับการทดสอบการตัดคำ.', font: '16px Inter, system-ui, sans-serif', width: 350, lineHeight: 24 },
  { issue: '#89', text: 'They remain hyper-focused on delivering a best-in-class experience (even when dealing with nested [bracketed {and heavily punctuated}] data!). Whether the user is typing in English, sending a 👩\u{200D}🚀 emoji, formatting currency like £3,450.75, or reading Thai (ทดสอบ), the layout engine must hold strong.', font: '16px Inter, system-ui, sans-serif', width: 610, lineHeight: 24 },
  { issue: '#142', text: 'ㅋㅋㅋ 진짜 웃기다 ㅋㅋㅋ 진짜로', font: '20px serif', width: 200, lang: 'ko' },
  { issue: '#142', text: '이거 ㄹㅇ임 ㄹㅇ 아니면 뭐야', font: '20px serif', width: 150, lang: 'ko' },
  { issue: '#142', text: 'ㄱㄴㄷ 호환 자모 ㄱㄴㄷ 호환 자모 ㄱㄴㄷ', font: '20px serif', width: 200, lang: 'ko' },
  { issue: '#145', text: '서울(Seoul)과 부산(Busan)', font: '20px serif', width: 180, lang: 'ko' },
  { issue: '#195', text: 'x'.repeat(56), font: 'bold 15px "Shantell Sans", cursive', width: 140, lineHeight: 18, whiteSpace: 'pre-wrap' },
  { issue: '#210', text: '\u{200B}≤100nA\u{200B}', font: '12px Calibri, sans-serif', width: 25, lineHeight: 20.96, whiteSpace: 'pre-wrap' },
  { issue: '#210', text: '\u{200B}', font: '12px Calibri, sans-serif', width: 25, lineHeight: 20.96, whiteSpace: 'pre-wrap' },
  { issue: '#323', text: ['the ', { text: 'inter', font: 'bold 16px Arial' }, 'na\u{AD}tion\u{AD}al'], font: '16px Arial', width: 52.5, lineHeight: 20 },
  { issue: '#323', text: ['the ', { text: 'inter', font: 'bold 16px Arial' }, 'na\u{AD}tion\u{AD}al'], font: '16px Arial', width: 54, lineHeight: 20 },
  { issue: '#323', text: ['the ', { text: 'inter', font: 'bold 16px Arial' }, 'na\u{AD}tion\u{AD}al'], font: '16px Arial', width: 56, lineHeight: 20 },
  { issue: '#334', text: '{测试内容.csjg.ysjcxxnr.ypbh}', font: '16px "Songti SC", "PingFang SC", serif', width: 120, lineHeight: 20.96 },
  { issue: '#334', text: '{测试内容.csjg.ysjcxxnr.ypbh}', font: '16px "Songti SC", "PingFang SC", serif', width: 135, lineHeight: 20.96 },
]

// #206 (fixed by #208): repeated symbols in a chat message, at the widths and letter spacing main's suite runs.
const SYMBOLS = ('{'.repeat(13) + ']'.repeat(13) + '\\'.repeat(13) + '|'.repeat(20) + '\\').repeat(5)

export function reportCases(): Case[] {
  const cases: Case[] = []
  const add = (r: Report): void => {
    const f = parseFont(r.font)
    const parts = typeof r.text === 'string' ? [r.text] : r.text.map(part => (typeof part === 'string' ? part : span(part.text, parseFont(part.font))))
    const p = paragraph({ font: f, lang: r.lang ?? 'en', width: r.width, ...(r.lineHeight === undefined ? {} : { lineHeight: r.lineHeight }), whiteSpace: r.whiteSpace ?? 'normal', letterSpacing: r.letterSpacing ?? 0 }, parts)
    cases.push(makeCase('report', { family: `report/${r.issue}`, origin: `github.com/chenglou/pretext/issues/${r.issue.slice(1)}, as filed`, pageLang: r.lang ?? 'en', paragraph: p }))
  }
  for (let i = 0; i < REPORTS.length; i++) add(REPORTS[i]!)
  for (const width of [50, 160, 320]) for (const letterSpacing of [0, 1]) add({ issue: '#206', text: SYMBOLS, font: '16px Arial', width, lineHeight: 20, letterSpacing })
  return cases
}
