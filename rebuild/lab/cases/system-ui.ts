// x-sysui experiment: the platform UI font (families 'sysui/'). macOS's system font under its three CSS names, of which
// each engine knows only some (font-facts.json rules.systemUI): alone, first in a list, and as the fallback after a named
// family that lacks the text's characters; sizes 9 to 40px with fractional ones and the sizes around the optical size
// switch; weights 100 to 900 and italic; letter and word spacing; Latin with kerning pairs and ligatures, digits and
// punctuation, emoji, Arabic, Thai, and Chinese, Japanese and Korean under five page languages; rich inline mixes with
// named fonts; narrow and wide widths; white-space normal and pre-wrap.
//
//   bun rebuild/lab/cases/system-ui.ts --seed=<name> --out=<file.ndjson>
//
// Ids used by any earlier set are left out (used-ids.ts), under the generation lock.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Case, FontDecl, Paragraph } from '../types.ts'
import { el, font, leaf, paragraph, span, text, treeParagraph, type Part } from './build.ts'
import { countFamilies, makeCase, mergeCases, sortCases } from './case.ts'
import { createRng, type Rng } from './prng.ts'
import { SCRIPT_INFO } from './texts.ts'
import { collectUsedIds, generationLock } from './used-ids.ts'
import { estimateParagraphWidth, pickWidths } from './widths.ts'

const SYSTEM = ['system-ui', '-apple-system', 'BlinkMacSystemFont'] as const
// The platform UI font first, with what follows it in stylesheets people ship.
const STACKS = [
  'system-ui, Arial',
  'system-ui, sans-serif',
  '-apple-system, BlinkMacSystemFont, sans-serif',
  '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  'BlinkMacSystemFont, -apple-system, Georgia',
] as const
// A named family without Latin letters, then the platform UI font: Geeza Pro has the space and no letter, digit or hyphen,
// and Apple Color Emoji the space and the digits (font-facts.json coverage).
const LATIN_FALLBACK = ['"Geeza Pro", system-ui', '"Apple Color Emoji", system-ui', '"Geeza Pro", -apple-system, BlinkMacSystemFont'] as const
// A named Latin family, then the platform UI font, for text the named family lacks.
const OTHER_FALLBACK = ['Georgia, system-ui', 'Menlo, -apple-system, BlinkMacSystemFont'] as const

const SIZES = [9, 10, 11, 12, 13, 13.33, 14, 14.5, 15, 16, 16.8, 17, 17.3, 18, 19, 19.5, 20, 20.5, 21, 22, 24, 28, 32, 36, 40] as const
const COMMON_SIZES = [12, 13, 14, 16, 17.3, 20, 24] as const
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

const KERNED = [
  'AVATAR Wave To. Yo, Ty. WATER LT Vo',
  'office affluent fifty ffi fl fjord waffle',
  'Typography: To Vote, We Try. A final offer',
  'The quick brown fox jumps over the lazy dog.',
  'Settings · Wi-Fi · Bluetooth · Notifications',
  'Save changes? Your edits to “Untitled” will be lost.',
  'Your trial ends Tuesday. Try Yearly: save over 40%',
] as const
const DIGITS = [
  '1,234,567.89 (42%) 12:30–14:45 $1,000.00',
  'v2.3.1-rc.4 #1017 @user +81-3-1234-5678',
  '11/17/2026, 7:41 AM — 3 of 12 items; 0.5×',
  'a[0] = {x: 1, y: 2}; // “quotes” & ‘more’…',
] as const
const LATIN = [...KERNED, ...DIGITS]
// Ideographs whose glyphs differ between the Chinese, Japanese and Korean fonts, so the font chosen shows in nothing but
// the language (the advances are the same em; the test is that nothing else moves).
const HAN_ONLY = ['直骨海角過誤認', '今令写真画戶戸別判', '所有設定已儲存完畢'] as const
const MIXED_UI = ['Settings 设置 設定 설정', 'Wi-Fi 接続済み 12:30', 'OK 确定 확인 キャンセル', '3 件の通知 · 2 new 消息'] as const
const PRE_WRAP = [
  'Name:  system-ui   \nSize:\t16px\nTo  Yo  fi',
  'Wave  To.   office  \n\n  fifty ffi   ',
  'a\tbb\tccc\tAVATAR\n1,234\t56.7\t8',
  '   leading and trailing   ',
] as const

type Shape = { group: string; pageLang: string; base: Paragraph; widths: number[]; note: string }

function widthsFor(rng: Rng, p: Paragraph, count: number, extras: readonly ('narrow' | 'wide')[] = []): number[] {
  const natural = estimateParagraphWidth(p)
  const out = pickWidths(rng, natural, count, { narrowChance: 0.08 })
  for (let i = 0; i < extras.length; i++) out.push(extras[i] === 'wide' ? Math.ceil(natural * 1.8) + 40 : rng.pick([1, 8, 23.5]))
  return [...new Set(out)]
}

function sizes(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/sizes`)
  const shapes: Shape[] = []
  for (const family of SYSTEM) {
    for (const size of SIZES) {
      const texts = [rng.pick(KERNED), rng.pick(LATIN)]
      for (let t = 0; t < texts.length; t++) {
        const p = paragraph({ font: font(family, size), lang: 'en' }, [text(texts[t]!)])
        shapes.push({ group: 'sizes', pageLang: 'en', base: p, widths: widthsFor(rng, p, 2, t === 0 ? ['wide'] : ['narrow']), note: `family=${family} size=${size}` })
      }
    }
  }
  return shapes
}

function weights(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/weights`)
  const shapes: Shape[] = []
  for (const family of SYSTEM) {
    for (const weight of WEIGHTS) {
      for (const style of ['normal', 'italic'] as const) {
        const picked = new Set<number>()
        while (picked.size < 3) picked.add(rng.pick(COMMON_SIZES))
        for (const size of picked) {
          const p = paragraph({ font: font(family, size, weight, style), lang: 'en' }, [text(rng.pick(LATIN))])
          shapes.push({ group: 'weights', pageLang: 'en', base: p, widths: widthsFor(rng, p, 2), note: `family=${family} weight=${weight} style=${style} size=${size}` })
        }
      }
    }
  }
  return shapes
}

function stacks(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/stacks`)
  const shapes: Shape[] = []
  for (const family of STACKS) {
    for (const size of [12, 13.33, 14, 16, 17.3, 19, 20, 21, 24, 32]) {
      for (let variant = 0; variant < 2; variant++) {
        const p = paragraph({ font: font(family, size, rng.pick([400, 400, 600, 700]), rng.chance(0.15) ? 'italic' : 'normal'), lang: 'en' }, [text(rng.pick(LATIN))])
        shapes.push({ group: 'stacks', pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `stack=${family} size=${size}` })
      }
    }
  }
  return shapes
}

function fallback(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/fallback`)
  const shapes: Shape[] = []
  for (const family of LATIN_FALLBACK) {
    for (const size of [12, 14.5, 16, 20, 24]) {
      for (const weight of [400, 700]) {
        const p = paragraph({ font: font(family, size, weight), lang: 'en' }, [text(rng.pick(LATIN))])
        shapes.push({ group: 'fallback-latin', pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `list=${family} size=${size} weight=${weight}` })
      }
    }
  }
  for (const family of OTHER_FALLBACK) {
    for (const script of ['ja', 'zh-Hans', 'ko', 'ar', 'th', 'emoji'] as const) {
      for (const size of [13, 16, 20]) {
        const info = SCRIPT_INFO[script]
        const body = `${rng.pick(['Title: ', 'To: ', ''])}${rng.pick(info.snippets)}`
        const p = paragraph({ font: font(family, size, rng.pick([400, 700])), lang: info.lang }, [text(body)])
        shapes.push({ group: 'fallback-other', pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `list=${family} script=${script} size=${size}` })
      }
    }
  }
  return shapes
}

function spacing(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/spacing`)
  const shapes: Shape[] = []
  for (const family of [...SYSTEM, STACKS[3]]) {
    for (const letterSpacing of [-0.5, 0, 0.5, 1, 2.5]) {
      for (const wordSpacing of [0, 3, -1]) {
        if (letterSpacing === 0 && wordSpacing === 0) continue
        for (let variant = 0; variant < 2; variant++) {
          const size = rng.pick([12, 14.5, 16, 20, 24])
          const body = variant === 0 ? KERNED[1] : rng.pick(LATIN)
          const p = paragraph({ font: font(family, size, rng.pick([400, 400, 700])), lang: 'en', letterSpacing, wordSpacing }, [text(body)])
          shapes.push({ group: 'spacing', pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `family=${family} ls=${letterSpacing} ws=${wordSpacing} size=${size}` })
        }
      }
    }
  }
  return shapes
}

function scripts(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/scripts`)
  const shapes: Shape[] = []
  const pageLangs = ['en', 'ja', 'zh-Hans', 'zh-Hant', 'ko'] as const
  for (const pageLang of pageLangs) {
    for (const source of ['ja', 'zh-Hans', 'zh-Hant', 'ko', 'han', 'mixed'] as const) {
      for (const family of SYSTEM) {
        const picked = new Set<number>()
        while (picked.size < 2) picked.add(rng.pick([14, 16, 20, 24]))
        for (const size of picked) {
          const body = source === 'han' ? rng.pick(HAN_ONLY) : source === 'mixed' ? rng.pick(MIXED_UI) : rng.pick(SCRIPT_INFO[source].snippets)
          // The content's language is the page's: no lang of its own.
          const p = paragraph({ font: font(family, size, rng.pick([400, 400, 700])), lang: pageLang }, [text(body)])
          shapes.push({ group: 'cjk', pageLang, base: p, widths: widthsFor(rng, p, 2, ['wide']), note: `pageLang=${pageLang} text=${source} family=${family} size=${size}` })
        }
      }
    }
  }
  // Content with its own lang under an English page.
  for (const script of ['ja', 'zh-Hans', 'zh-Hant', 'ko', 'ar', 'th'] as const) {
    for (const family of SYSTEM) {
      for (const size of [14, 16, 20]) {
        const info = SCRIPT_INFO[script]
        const p = paragraph({ font: font(family, size, rng.pick([400, 700])), lang: info.lang, direction: info.direction }, [text(rng.pick(info.snippets))])
        shapes.push({ group: 'own-lang', pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `script=${script} family=${family} size=${size}` })
      }
    }
  }
  // Arabic, Thai and emoji under the page's English.
  for (const script of ['ar', 'th', 'emoji'] as const) {
    for (const family of SYSTEM) {
      for (const size of [13, 16, 20, 28]) {
        const info = SCRIPT_INFO[script]
        const body = script === 'emoji' ? rng.pick(info.snippets) : `${rng.pick(['', 'Re: '])}${rng.pick(info.snippets)}`
        const p = paragraph({ font: font(family, size, rng.pick([400, 400, 700])), lang: 'en' }, [text(body)])
        shapes.push({ group: script === 'emoji' ? 'emoji' : 'complex', pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `script=${script} family=${family} size=${size}` })
      }
    }
  }
  return shapes
}

function rich(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/rich`)
  const shapes: Shape[] = []
  const named = ['Georgia', 'Menlo', 'Arial', '"Helvetica Neue"', '"Times New Roman"'] as const
  for (const family of SYSTEM) {
    for (const size of [13, 16, 20]) {
      for (let variant = 0; variant < 3; variant++) {
        const system = font(family, size)
        const other = font(rng.pick(named), rng.pick([size, size, size + 2]), rng.pick([400, 700]), rng.chance(0.2) ? 'italic' : 'normal')
        const kinds: ReadonlyArray<readonly [string, FontDecl, Part[]]> = [
          ['named-span', system, [text('To open '), span('office.pdf', other), text(' tap Yes, or Wave To. ')]],
          ['system-span', other, [text('The label '), span('Wi-Fi Settings', system), text(' uses the system font, fifty ')]],
          ['weight-span', system, [text('Try '), span('Yearly', font(family, size, 700)), text(': save '), span('40%', font(family, size, 600, 'italic')), text(' To. AVATAR')]],
          ['split-word', system, [text('an of'), span('fi', font(family, size, 700)), text('ce AV'), span('AT', other), text('AR Wave')]],
          ['size-span', system, [text('Total '), span('$1,234.56', font(family, rng.pick([size + 4, 19, 21]), 700)), text(' due Tuesday To. '), span('Yo', font(family, 11))]],
        ]
        for (const [kind, base, parts] of kinds) {
          const p = paragraph({ font: base, lang: 'en', letterSpacing: rng.chance(0.15) ? 0.5 : 0 }, parts)
          shapes.push({ group: `rich-${kind}`, pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `family=${family} size=${size} other=${other.family}` })
        }
      }
    }
  }
  return shapes
}

function richTree(seed: string): Case[] {
  const rng = createRng(`${seed}/sysui/rich-tree`)
  const cases: Case[] = []
  let shape = 0
  for (const family of SYSTEM) {
    for (const size of [13, 16, 20]) {
      for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
        shape++
        const system = font(family, size)
        const tree = treeParagraph({ font: system, lang: 'en', whiteSpace }, [
          leaf('Tap '),
          el({ font: font(family, size, 700), start: { padding: 4, border: 1 }, end: { padding: 4, border: 1 } }, leaf('Try Yearly')),
          leaf(whiteSpace === 'pre-wrap' ? '  or  ' : ' or '),
          el({ font: font('Georgia', size, 400, 'italic'), start: { margin: 3 }, end: { margin: 3 } }, leaf('office'), el({ font: font(family, size + 3) }, leaf(' To. Yo'))),
          leaf(' fifty ffi'),
        ])
        const widths = widthsFor(rng, tree.paragraph, 3)
        for (let w = 0; w < widths.length; w++) {
          cases.push(makeCase({
            family: 'sysui/rich-tree', origin: `generator=sysui/rich-tree seed=${seed} shape=${shape} family=${family} size=${size} white-space=${whiteSpace}`, pageLang: 'en',
            paragraph: { ...tree.paragraph, width: widths[w]! }, inline: tree.inline,
          }))
        }
      }
    }
  }
  return cases
}

function preWrap(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/pre-wrap`)
  const shapes: Shape[] = []
  for (const family of SYSTEM) {
    for (const size of [13, 16, 17.3, 20]) {
      for (const body of PRE_WRAP) {
        const p = paragraph({ font: font(family, size, rng.pick([400, 400, 700])), lang: 'en', whiteSpace: 'pre-wrap', tabSize: rng.pick([8, 4]) }, [text(body)])
        shapes.push({ group: 'pre-wrap', pageLang: 'en', base: p, widths: widthsFor(rng, p, 3), note: `family=${family} size=${size}` })
      }
      const long = paragraph({ font: font(family, size), lang: 'en', whiteSpace: 'pre-wrap', letterSpacing: rng.pick([0, 0.5]) }, [text(`${rng.pick(KERNED)}  ${rng.pick(DIGITS)} `)])
      shapes.push({ group: 'pre-wrap', pageLang: 'en', base: long, widths: widthsFor(rng, long, 3), note: `family=${family} size=${size} long` })
    }
  }
  return shapes
}

// Narrow boxes and breaks inside words, where a line's width is a prefix of a kerned word.
function narrow(seed: string): Shape[] {
  const rng = createRng(`${seed}/sysui/narrow`)
  const shapes: Shape[] = []
  for (const family of SYSTEM) {
    for (const size of [12, 16, 19, 20, 21, 24]) {
      for (const [overflowWrap, wordBreak] of [['normal', 'normal'], ['break-word', 'normal'], ['anywhere', 'normal'], ['normal', 'break-all']] as const) {
        const body = rng.pick(['AVATAR Waffle Typography', 'officefifty Wave To.Yo,Ty', 'Supercalifragilisticexpialidocious 1,234,567.89', 'Notifications-and-Settings'])
        const p = paragraph({ font: font(family, size, rng.pick([400, 600])), lang: 'en', overflowWrap, wordBreak }, [text(body)])
        shapes.push({ group: 'narrow', pageLang: 'en', base: p, widths: [1, rng.pick([8, 12]), rng.pick([30, 47.5, 64]), rng.pick([90, 120.25]), 2000], note: `family=${family} size=${size} overflow-wrap=${overflowWrap} word-break=${wordBreak}` })
      }
    }
  }
  return shapes
}

export function generateSystemUi(seed: string): Case[] {
  const cases: Case[] = []
  const groups = [sizes, weights, stacks, fallback, spacing, scripts, rich, preWrap, narrow]
  for (let g = 0; g < groups.length; g++) {
    const shapes = groups[g]!(seed)
    for (let s = 0; s < shapes.length; s++) {
      const shape = shapes[s]!
      const family = `sysui/${shape.group}`
      for (let w = 0; w < shape.widths.length; w++) {
        cases.push(makeCase({ family, origin: `generator=${family} seed=${seed} shape=${s + 1} ${shape.note}`, pageLang: shape.pageLang, paragraph: { ...shape.base, width: shape.widths[w]! } }))
      }
    }
  }
  cases.push(...richTree(seed))
  return sortCases(mergeCases(cases))
}

if (import.meta.main) {
  let seed = 'sysui-1'
  let out = ''
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--seed=')) seed = arg.slice(7)
    else if (arg.startsWith('--out=')) out = resolve(arg.slice(6))
    else throw new Error(`Unknown argument ${arg}; usage: bun rebuild/lab/cases/system-ui.ts [--seed=S] --out=FILE`)
  }
  if (out === '') throw new Error('--out=FILE is required')
  await generationLock(`system-ui ${seed}`, () => {
    const used = collectUsedIds({ skip: dirname(out), failOnMissing: false })
    const all = generateSystemUi(seed)
    const cases = all.filter(value => !used.ids.has(value.id))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, cases.map(value => `${JSON.stringify(value)}\n`).join(''))
    const families = countFamilies(cases)
    writeFileSync(`${out.replace(/\.ndjson$/, '')}.summary.json`, `${JSON.stringify({ file: out, seed, generated: all.length, alreadyUsed: all.length - cases.length, cases: cases.length, usedIds: used.ids.size, usedSources: used.sources.length, families }, null, 2)}\n`)
    console.log(`${out}: ${cases.length} cases (${all.length - cases.length} of ${all.length} left out as used; ${used.ids.size} used ids from ${used.sources.length} files)`)
    console.log(JSON.stringify(families, null, 2))
  })
}
