// The audit's lab cases: the bench's chat messages (bench/cases.ts buildChat) at the chat width, inline code as a 14px Menlo
// span with 6px padding on each side (as bench/page.ts hands them to the library), and the census's real paragraphs
// (research/CALIBRATION.md §7). Never launches a browser.
//
//   bun rebuild/tools/audit/cases.ts --out=<dir> [--mix=1000] [--latin=500] [--real=1000] [--width=320]
// writes <dir>/chat.ndjson, <dir>/real-400.ndjson (one case a paragraph, at 400px) and <dir>/real-all.ndjson (all 4,686).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildChat, CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_STYLE } from '../../bench/cases.ts'
import type { ChatSetId } from '../../bench/protocol.ts'
import { el, leaf, treeParagraph, type TreePart } from '../../lab/cases/build.ts'
import { canonicalFontFamily } from '../../lab/cases/font.ts'
import { makeCase } from '../../lab/cases/case.ts'
import type { Case } from '../../lab/types.ts'
import { REAL_TEXT_CASES } from './common.ts'

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? ''] as const }))
const out = args.get('out')
if (out === undefined) throw new Error('--out=<dir>')
const width = Number(args.get('width') ?? 320)

export function chatCases(set: ChatSetId, count: number, at: number): Case[] {
  const messages = buildChat(set, count)
  const font = { ...CHAT_STYLE.font, family: canonicalFontFamily(CHAT_STYLE.font.family) }
  const code = { ...CHAT_CODE_FONT, family: canonicalFontFamily(CHAT_CODE_FONT.family) }
  const edge = { margin: 0, border: 0, padding: CHAT_CODE_PADDING }
  const cases: Case[] = []
  for (let i = 0; i < messages.length; i++) {
    const parts: TreePart[] = []
    const message = messages[i]!
    for (let k = 0; k < message.parts.length; k++) {
      const part = message.parts[k]!
      parts.push(part.code ? el({ font: code, start: edge, end: edge }, leaf(part.text)) : leaf(part.text))
    }
    const tree = treeParagraph({ font, lang: CHAT_STYLE.lang, direction: CHAT_STYLE.direction, lineHeight: CHAT_STYLE.lineHeight, overflowWrap: 'break-word' }, parts)
    cases.push(makeCase({
      family: `chat/${set}/${message.kind}`, origin: `audit chat set=${set} index=${i}`, pageLang: CHAT_STYLE.lang,
      paragraph: { ...tree.paragraph, width: at }, inline: tree.inline,
    }))
  }
  return cases
}

mkdirSync(out, { recursive: true })
const chat: Case[] = []
const seen = new Set<string>()
for (const [set, key] of [['mix', 'mix'], ['latin', 'latin'], ['real', 'real']] as const) {
  const n = Number(args.get(key) ?? (key === 'latin' ? 500 : 1000))
  const made = chatCases(set, n, width)
  for (let i = 0; i < made.length; i++) {
    if (seen.has(made[i]!.id)) continue
    seen.add(made[i]!.id)
    chat.push(made[i]!)
  }
}
writeFileSync(join(out, 'chat.ndjson'), chat.map(c => JSON.stringify(c)).join('\n') + '\n')
const real = readFileSync(REAL_TEXT_CASES, 'utf8').split('\n').filter(l => l !== '')
writeFileSync(join(out, 'real-all.ndjson'), real.join('\n') + '\n')
writeFileSync(join(out, 'real-400.ndjson'), real.filter(l => (JSON.parse(l) as Case).paragraph.width === 400).join('\n') + '\n')
console.log(`chat ${chat.length} cases (${chat.length - seen.size} duplicates dropped), real ${real.length}`)
