// Break-policy families (prefix 'policy/'): word-break, overflow-wrap and line-break values over CJK,
// Korean, Thai, emoji sequences, URLs and long numbers, and Chinese under page/paragraph languages.

import type { Case, FontDecl, Paragraph } from '../types.ts'
import { emitter, font, paragraph, span, text, type Generator, type Part } from './build.ts'
import { createRng, type Rng } from './prng.ts'
import { EMOJI_SEQUENCES, excerpt, NUMBER_TEXTS, phrase, SCRIPT_INFO, URL_TEXTS, type Script, corpusLines } from './texts.ts'
import { estimateParagraphWidth, pickCjkWidths, pickWidths } from './widths.ts'

type TextKind = 'en' | 'long-word' | 'ja' | 'zh' | 'ko' | 'th' | 'emoji' | 'url' | 'number' | 'mixed' | 'ar'

const E = EMOJI_SEQUENCES

function kindText(rng: Rng, kind: TextKind): { value: string; script: Script } {
  switch (kind) {
    case 'en': return { value: phrase(rng, 'latin', 30, 100), script: 'latin' }
    case 'long-word': return { value: rng.pick(['Donaudampfschifffahrtsgesellschaftskapitän sails', 'antidisestablishmentarianism and floccinaucinihilipilification', 'Supercalifragilisticexpialidocious']), script: 'latin' }
    case 'ja': return { value: phrase(rng, 'ja', 12, 60), script: 'ja' }
    case 'zh': return { value: rng.chance(0.5) ? phrase(rng, 'zh-Hans', 12, 60) : phrase(rng, 'zh-Hant', 12, 60), script: 'zh-Hans' }
    case 'ko': return { value: phrase(rng, 'ko', 12, 60), script: 'ko' }
    case 'th': return { value: phrase(rng, 'th', 12, 60), script: 'th' }
    case 'emoji': return { value: phrase(rng, 'emoji', 10, 60), script: 'emoji' }
    case 'url': return { value: `See ${rng.pick(URL_TEXTS)} now`, script: 'latin' }
    case 'number': return { value: `Total ${rng.pick(NUMBER_TEXTS)} and ${rng.pick(NUMBER_TEXTS)}`, script: 'latin' }
    case 'mixed': return { value: rng.pick(['日本語とEnglishの混在テキストです', '中文English混排123测试', '한국어English혼합텍스트', 'ภาษาไทยEnglish123']), script: 'ja' }
    case 'ar': return { value: phrase(rng, 'ar', 12, 60), script: 'ar' }
  }
}

function widthsFor(rng: Rng, p: Paragraph, script: Script, count: number, narrowChance: number): number[] {
  const natural = estimateParagraphWidth(p)
  return SCRIPT_INFO[script].cjk && script !== 'ko'
    ? pickCjkWidths(rng, natural, p.font.size, count, { narrowChance })
    : pickWidths(rng, natural, count, { narrowChance })
}

function scriptFont(rng: Rng, script: Script, sizes: readonly number[] = [14, 16, 18, 20]): FontDecl {
  return font(rng.pick(SCRIPT_INFO[script].fonts), rng.pick(sizes))
}

const ALL_KINDS: readonly TextKind[] = ['en', 'long-word', 'ja', 'zh', 'ko', 'th', 'emoji', 'url', 'number', 'mixed', 'ar']

function wordBreak(seed: string): Case[] {
  const family = 'policy/word-break'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (const value of ['normal', 'break-all', 'keep-all', 'break-word'] as const) {
    for (const kind of ALL_KINDS) {
      for (let shape = 0; shape < 3; shape++) {
        const { value: content, script } = kindText(rng, kind)
        const info = SCRIPT_INFO[script]
        const p = paragraph({
          font: scriptFont(rng, script), lang: info.lang, wordBreak: value, overflowWrap: rng.chance(0.5) ? 'normal' : 'break-word',
          direction: info.direction,
        }, [text(content)])
        emit.shape('en', p, widthsFor(rng, p, script, 2, 0.12), `text=${kind}`)
      }
    }
  }
  return emit.cases
}

function unbreakable(rng: Rng, kind: string): { value: string; script: Script } {
  switch (kind) {
    case 'url': return { value: rng.pick(URL_TEXTS), script: 'latin' }
    case 'long-word': return { value: 'pneumonoultramicroscopicsilicovolcanoconiosis', script: 'latin' }
    case 'number': return { value: rng.pick(['100000000000000000000000', '3.14159265358979323846264338327950288', 'a3f5c9e1b2d4f6a8c0e2d4f6a8b0c2e4']), script: 'latin' }
    case 'emoji': return { value: `${E[0]}${E[1]}${E[2]}${E[3]}${E[4]}${E[6]}${E[7]}`, script: 'emoji' }
    case 'cjk-punct': return { value: '「日本語」。、！？……——（中文）', script: 'ja' }
    case 'thai': return { value: phrase(rng, 'th', 20, 40).replace(/ /g, ''), script: 'th' }
    case 'email': return { value: 'firstname.lastname+newsletter@subdomain.example.co.uk', script: 'latin' }
    case 'arabic': return { value: 'وَالْمُسْتَشْفَيَاتُ', script: 'ar' }
    default: throw new Error(`Unknown unbreakable kind ${kind}`)
  }
}

function overflowWrap(seed: string): Case[] {
  const family = 'policy/overflow-wrap'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  const kinds = ['url', 'long-word', 'number', 'emoji', 'cjk-punct', 'thai', 'email', 'arabic']
  for (const value of ['normal', 'break-word', 'anywhere'] as const) {
    for (const wordBreakValue of ['normal', 'keep-all'] as const) {
      for (const kind of kinds) {
        for (let shape = 0; shape < 2; shape++) {
          const { value: long, script } = unbreakable(rng, kind)
          const info = SCRIPT_INFO[script]
          const context = rng.chance(0.6)
          const parts: Part[] = context ? [text(`${phrase(rng, script, 3, 12)}${info.spaced ? ' ' : ''}${long}${info.spaced ? ' ' : ''}${phrase(rng, script, 3, 12)}`)] : [text(long)]
          const p = paragraph({ font: scriptFont(rng, script), lang: info.lang, overflowWrap: value, wordBreak: wordBreakValue, direction: info.direction }, parts)
          // Widths below the unbreakable string's own estimate make overflow-wrap decide.
          emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), 2, { narrowChance: 0.3, maxLines: 16 }), `text=${kind}${context ? ' context' : ''}`)
        }
      }
    }
  }
  return emit.cases
}

const LINE_BREAK_TEXTS = [
  'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ',
  'コンピューターとサーバーのデータベース',
  '人々は時々、日々のように言う。',
  'ゝゞヽヾのような踊り字〻',
  '〜から〜まで、‐ハイフン‐と゠カタカナ゠',
  '本当ですか？！はい！！そうです。。',
  '「かぎ括弧」『二重かぎ括弧』（丸括弧）【隅付き括弧】',
  '価格は¥12,800です。割引は20％、送料€5。',
  '中文。、，：；！？标点“引号”…省略号——破折号',
  '約3ヶ月、ちょっと待って',
  '한국어 “인용”과 문장부호。',
  'English words, hyphen-ated, and em—dash; with “quotes”.',
] as const

const LINE_BREAK_FONTS: Record<string, string> = {
  ja: '"Hiragino Sans"', 'zh-Hans': '"PingFang SC"', 'zh-Hant': '"PingFang TC"', ko: '"Apple SD Gothic Neo"', en: '"Hiragino Sans"',
}

function lineBreak(seed: string): Case[] {
  const family = 'policy/line-break'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (const value of ['auto', 'loose', 'normal', 'strict', 'anywhere'] as const) {
    for (const lang of ['ja', 'zh-Hans', 'zh-Hant', 'ko', 'en'] as const) {
      for (const content of rng.sample(LINE_BREAK_TEXTS, 12)) {
        const latin = /^English/.test(content)
        const size = rng.pick([16, 20] as const)
        const p = paragraph({
          font: font(latin ? 'Arial' : LINE_BREAK_FONTS[lang]!, size), lang, lineBreak: value,
          wordBreak: rng.chance(0.15) ? 'keep-all' : 'normal', overflowWrap: rng.chance(0.7) ? 'break-word' : 'normal',
        }, [text(content)])
        const natural = estimateParagraphWidth(p)
        const widths = latin ? pickWidths(rng, natural, 1, { narrowChance: 0.2 }) : pickCjkWidths(rng, natural, size, 1, { narrowChance: 0.05 })
        emit.shape('en', p, widths)
      }
    }
  }
  return emit.cases
}

function korean(seed: string): Case[] {
  const family = 'policy/korean'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (let shape = 0; shape < 150; shape++) {
    const content = phrase(rng, 'ko', 12, 70)
    const p = paragraph({
      font: font('"Apple SD Gothic Neo"', rng.pick([16, 18, 20] as const)), lang: rng.chance(0.7) ? 'ko' : 'en',
      wordBreak: rng.pick(['normal', 'keep-all', 'break-all'] as const), lineBreak: rng.pick(['auto', 'auto', 'strict', 'loose', 'anywhere'] as const),
      overflowWrap: rng.chance(0.7) ? 'break-word' : 'normal',
    }, [text(content)])
    emit.shape(rng.chance(0.8) ? 'en' : 'ko', p, pickWidths(rng, estimateParagraphWidth(p), 1, { narrowChance: 0.05 }))
  }
  return emit.cases
}

function thai(seed: string): Case[] {
  const family = 'policy/thai'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (let shape = 0; shape < 150; shape++) {
    let content = phrase(rng, 'th', 15, 80)
    const variant = rng.pick(['plain', 'plain', 'zwsp', 'latin', 'digits'] as const)
    if (variant === 'zwsp') content = content.replace(/(.{4,7})/gu, match => (rng.chance(0.5) ? `${match}​` : match))
    if (variant === 'latin') content = `${content} Pretext ${phrase(rng, 'th', 5, 20)}`
    if (variant === 'digits') content = `${content} ๑๒๓ 2026`
    const lang = rng.chance(0.7) ? 'th' : 'en'
    const p = paragraph({
      font: font('Thonburi', rng.pick([16, 18, 20] as const)), lang,
      wordBreak: rng.pick(['normal', 'normal', 'break-all', 'keep-all'] as const), overflowWrap: rng.chance(0.7) ? 'break-word' : 'normal',
    }, [text(content)])
    emit.shape(rng.chance(0.7) ? 'en' : 'th', p, pickWidths(rng, estimateParagraphWidth(p), 1, { narrowChance: 0.05 }), `variant=${variant}`)
  }
  return emit.cases
}

function emoji(seed: string): Case[] {
  const family = 'policy/emoji'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  const templates = [
    (): string => `Status: ${rng.pick(E)} working, ${rng.pick(E)} testing, ${rng.pick(E)} done`,
    (): string => rng.sample(E, 6).join(''),
    (): string => `${rng.sample(E, 3).join('​')} and ${rng.sample(E, 3).join(' ')}`,
    (): string => `日本語${rng.pick(E)}テキスト${rng.pick(E)}です`,
    (): string => `word${rng.pick(E)}word${rng.pick(E)}word`,
    (): string => `${E[6]}${E[6]}${E[6]} keycaps and flags ${E[4]}${E[5]}${E[4]}`,
  ]
  for (let shape = 0; shape < 150; shape++) {
    const p = paragraph({
      font: font(rng.pick(['Arial', '"Helvetica Neue"', '"Hiragino Sans"']), rng.pick([12, 16, 20, 24] as const)), lang: 'en',
      wordBreak: rng.pick(['normal', 'normal', 'break-all', 'keep-all'] as const),
      lineBreak: rng.chance(0.8) ? 'auto' : 'anywhere',
      overflowWrap: rng.pick(['normal', 'break-word', 'anywhere'] as const),
    }, [text(rng.pick(templates)())])
    emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), 1, { narrowChance: 0.1 }))
  }
  return emit.cases
}

function urlNumber(seed: string): Case[] {
  const family = 'policy/url-number'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (let shape = 0; shape < 200; shape++) {
    const token = rng.chance(0.5) ? rng.pick(URL_TEXTS) : rng.pick(NUMBER_TEXTS)
    const content = rng.chance(0.6) ? `${phrase(rng, 'latin', 5, 30)} ${token} ${phrase(rng, 'latin', 5, 30)}` : token
    const p = paragraph({
      font: font(rng.pick(['Arial', 'Georgia', '"Courier New"', 'Verdana'] as const), rng.pick([14, 16, 18] as const)), lang: 'en',
      wordBreak: rng.pick(['normal', 'normal', 'break-all', 'keep-all'] as const),
      overflowWrap: rng.pick(['normal', 'break-word', 'anywhere'] as const),
      lineBreak: rng.chance(0.9) ? 'auto' : 'anywhere',
      whiteSpace: rng.chance(0.85) ? 'normal' : 'pre-wrap',
    }, [text(content)])
    emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), 1, { narrowChance: 0.15 }))
  }
  return emit.cases
}

function zhLang(seed: string): Case[] {
  const family = 'policy/zh-lang'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (const pageLang of ['zh', 'en'] as const) {
    for (const lang of ['zh', 'en'] as const) {
      for (let shape = 0; shape < 50; shape++) {
        const r = rng.next()
        const content = r < 0.4 ? phrase(rng, 'zh-Hans', 12, 60)
          : r < 0.7 ? excerpt(rng, rng.pick(corpusLines(rng.pick(['zh-zhufu', 'zh-guxiang']))), 20, 90, false)
            : rng.pick(['我们使用Pretext来预测浏览器的换行位置。', '中文‘abc’中文“quote”中文', '价格是¥12,800元（含税）。', 'Hello，世界！Hello, world!'])
        const size = rng.pick([16, 20] as const)
        const p = paragraph({
          font: font(rng.pick(['"PingFang SC"', '"PingFang SC"', '"Songti SC"', 'sans-serif', 'serif']), size), lang,
          lineBreak: rng.pick(['auto', 'auto', 'strict', 'normal', 'loose'] as const),
          wordBreak: rng.chance(0.8) ? 'normal' : 'keep-all', overflowWrap: rng.chance(0.7) ? 'break-word' : 'normal',
        }, [rng.chance(0.85) ? text(content) : span(content, font('"PingFang SC"', size), { lang: lang === 'zh' ? 'en' : 'zh' })])
        emit.shape(pageLang, p, pickCjkWidths(rng, estimateParagraphWidth(p), size, 1, { narrowChance: 0.05 }))
      }
    }
  }
  return emit.cases
}

export const POLICY_GENERATORS: readonly Generator[] = [
  { family: 'policy/word-break', generate: wordBreak },
  { family: 'policy/overflow-wrap', generate: overflowWrap },
  { family: 'policy/line-break', generate: lineBreak },
  { family: 'policy/korean', generate: korean },
  { family: 'policy/thai', generate: thai },
  { family: 'policy/emoji', generate: emoji },
  { family: 'policy/url-number', generate: urlNumber },
  { family: 'policy/zh-lang', generate: zhLang },
]
