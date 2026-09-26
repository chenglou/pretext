// Real-text lab cases for attacking Blink's words first and cut predictor (branch blink-words-first). Never launches a browser.
//   bun rebuild/tools/bwfa-realtext-cases.ts --out=<dir> --emoji-url=<emoji-url.ndjson> [--seed=bwfa]
// Writes:
//   prewrap.ndjson      chat messages under white-space: pre-wrap in the chat bubble style: one to four real messages (the
//                       texts of emoji-url.ndjson) joined by newlines or blank lines, with lists, indented code-like
//                       lines, tabs, double spaces after sentences and trailing spaces, at 200 to 440 px
//   headings.ndjson     headings and titles at 24 to 64 px, regular and bold, with the letter spacing design systems use
//                       (-0.02em to 0.1em): English, German, French, Spanish, Italian, Portuguese, Polish, Russian,
//                       Turkish and Vietnamese UI text from Chromium's translations, the Gatsby opening and the mixed app
//                       text in the Mac's usual text faces; Chinese, Japanese, Korean, Arabic and Hebrew corpus sentences
//                       in their corpus faces. At 48 px and DPR 2 most words are wider than Blink's 256 zoomed px shaping
//                       limit, so words go through the cut search and the predictor.
//   wordspacing.ndjson  Latin UI text and corpus sentences at 16 to 20 px with word-spacing -1, 1, 2 and 4 px
//   shy.ndjson          German and Finnish UI text with soft hyphens in its long words (before a consonant that
//                       follows a vowel, at least four letters from either end), as sites that hyphenate by hand
//                       send it, at 16 and 20 px and 120 to 300 px
//   script.ndjson       English sentences and UI text in the Mac's script, handwriting and display faces that invitations,
//                       menus and casual sites ask for (Snell Roundhand, Apple Chancery, Zapfino, Savoye LET, Bradley
//                       Hand, Noteworthy, Marker Felt, Chalkboard SE, Papyrus, Luminari, SignPainter, ...) at 18 to 48 px
//   nastaliq.ndjson     the Urdu corpus's paragraphs in Noto Nastaliq Urdu at 16 to 32 px, every 16 px from 160 to
//                       800 px, and Arabic corpus paragraphs and UI text in the Mac's Arabic faces (Farisi, Mishafi, Diwan
//                       Thuluth, Waseem, DecoType Naskh, Geeza Pro, Baghdad, ...) at 20 to 40 px: the faces where a window
//                       can measure wider than a string around it, which the cut predictor assumes it never does
//   body.ndjson         French, German, Polish and Vietnamese UI text (French keeps its no-break spaces before
//                       punctuation) at 15 to 18 px in the Mac's text faces, 180 to 420 px
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_STYLE } from '../bench/cases.ts'
import { font, paragraph, text } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { canonicalFontFamily } from '../lab/cases/font.ts'
import { createRng } from '../lab/cases/prng.ts'
import type { Case } from '../lab/types.ts'

const HOME = process.env['HOME']!
const MAIN = join(HOME, 'github/pretext')
const CHROMIUM = join(HOME, 'github/browser-engines/chromium-152/src')
const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? ''] as const }))
const out = args.get('out')
const emojiUrl = args.get('emoji-url')
if (out === undefined || emojiUrl === undefined) throw new Error('--out=<dir> --emoji-url=<emoji-url.ndjson>')
const seed = args.get('seed') ?? 'bwfa'
mkdirSync(out, { recursive: true })

function write(name: string, cases: Case[]): void {
  const seen = new Set<string>()
  const rows: string[] = []
  for (let i = 0; i < cases.length; i++) {
    if (seen.has(cases[i]!.id)) continue
    seen.add(cases[i]!.id)
    rows.push(JSON.stringify(cases[i]!))
  }
  writeFileSync(join(out!, name), rows.join('\n') + '\n')
  console.log(`${name}: ${rows.length}`)
}

// ---- Texts ----
const messages: string[] = []
{
  const seen = new Set<string>()
  const lines = readFileSync(emojiUrl, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue
    const c = JSON.parse(lines[i]!) as Case
    if (c.paragraph.runs.length !== 1) continue
    const t = c.paragraph.runs[0]!.text
    if (seen.has(t)) continue
    seen.add(t)
    messages.push(t)
  }
}
const corpus = (id: string): string => readFileSync(join(MAIN, 'corpora', `${id}.txt`), 'utf8')
function sentences(source: string, min: number, max: number, cjk: boolean): string[] {
  const parts = source.split(cjk ? /(?<=[。！？])/ : /(?<=[.!?])\s+/)
  const outList: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i]!.replace(/[ \t\n\r]+/g, ' ').replace(/^ | $/g, '')
    if (s.length >= min && s.length <= max && !/^[-{=|]/.test(s)) outList.push(s)
  }
  return outList
}
function xtb(lang: string, min: number, max: number): string[] {
  const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&')
  const dir = join(CHROMIUM, 'chrome/app/resources')
  const files = readdirSync(dir).filter(f => f.endsWith(`_${lang}.xtb`)).sort()
  const texts: string[] = []
  const seen = new Set<string>()
  for (let f = 0; f < files.length; f++) {
    const xml = readFileSync(join(dir, files[f]!), 'utf8')
    const re = /<translation id="(\d+)">([\s\S]*?)<\/translation>/g
    for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
      if (m[2]!.includes('<')) continue
      // Collapse only ASCII white space: the translations' no-break spaces stay (JS \s would take U+00A0 too).
      const t = decode(m[2]!).replace(/[ \t\n\r]+/g, ' ').replace(/^ | $/g, '')
      if (t.length < min || t.length > max || seen.has(t)) continue
      seen.add(t)
      texts.push(t)
    }
  }
  return texts
}

// ---- pre-wrap chat ----
{
  const rng = createRng(`${seed}-prewrap`)
  const CODE = ['const lines = layout(prepared, 320, 20)', 'if (width < 0) {', '  return null', '}', 'for (let i = 0; i < n; i++) sum += w[i]', 'SELECT id, name FROM users;', '$ bun run test', 'git commit -m "fix: wrap"']
  const style = { ...CHAT_STYLE.font, family: canonicalFontFamily(CHAT_STYLE.font.family) }
  const cases: Case[] = []
  for (let n = 0; n < 1200; n++) {
    const count = 1 + rng.int(4)
    let body = ''
    for (let k = 0; k < count; k++) {
      let m = rng.pick(messages)
      if (rng.chance(0.3)) m = m.replace(/([.!?]) (\S)/g, '$1  $2')
      if (k > 0) body += rng.chance(0.3) ? '\n\n' : '\n'
      const r = rng.next()
      if (r < 0.12) body += `- ${m}\n- ${rng.pick(messages)}`
      else if (r < 0.2) body += `1. ${m}\n2. ${rng.pick(messages)}`
      else if (r < 0.3) {
        const lines = 1 + rng.int(3)
        const code: string[] = []
        for (let j = 0; j < lines; j++) code.push(`${rng.chance(0.3) ? '\t' : rng.pick(['', '  ', '    '])}${rng.pick(CODE)}`)
        body += `${m}\n${code.join('\n')}`
      } else body += m
      if (rng.chance(0.15)) body += rng.pick([' ', '  ', '\t'])
    }
    if (rng.chance(0.1)) body = `  ${body}`
    if (rng.chance(0.05)) body += '\n'
    const p0 = paragraph({ font: style, lang: CHAT_STYLE.lang, lineHeight: CHAT_STYLE.lineHeight, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', direction: /^[֐-ࣿ]/.test(body) ? 'rtl' : 'ltr' }, [text(body)])
    for (let w = 200; w <= 440; w += 60) {
      cases.push(makeCase({ family: 'bwfa-prewrap/chat', origin: `bwfa prewrap index=${n} width=${w}`, pageLang: CHAT_STYLE.lang, paragraph: { ...p0, width: w } }))
    }
  }
  write('prewrap.ndjson', cases)
}

// ---- headings ----
{
  const rng = createRng(`${seed}-headings`)
  const LATIN = ['Helvetica Neue', 'Georgia', 'Avenir Next', 'Futura', 'Palatino', 'Hoefler Text', 'Didot', 'Gill Sans', 'Baskerville', 'Times New Roman', 'Arial', 'Verdana', 'Optima', 'American Typewriter']
  const CYRILLIC = ['Helvetica Neue', 'Georgia', 'Times New Roman', 'Arial', 'PT Serif', 'Verdana']
  const VIET = ['Helvetica Neue', 'Arial', 'Times New Roman', 'Avenir Next']
  type Source = { lang: string; texts: string[]; faces: string[]; direction: 'ltr' | 'rtl'; n: number }
  const gatsby = sentences(corpus('en-gatsby-opening'), 20, 100, false)
  const mixed = sentences(corpus('mixed-app-text'), 20, 100, false)
  const sources: Source[] = [
    { lang: 'en', texts: gatsby.concat(mixed), faces: LATIN, direction: 'ltr', n: 700 },
    { lang: 'en', texts: xtb('en-GB', 20, 90), faces: LATIN, direction: 'ltr', n: 400 },
    { lang: 'de', texts: xtb('de', 20, 90), faces: LATIN, direction: 'ltr', n: 400 },
    { lang: 'fr', texts: xtb('fr', 20, 90), faces: LATIN, direction: 'ltr', n: 250 },
    { lang: 'es', texts: xtb('es', 20, 90), faces: LATIN, direction: 'ltr', n: 200 },
    { lang: 'it', texts: xtb('it', 20, 90), faces: LATIN, direction: 'ltr', n: 150 },
    { lang: 'pt-BR', texts: xtb('pt-BR', 20, 90), faces: LATIN, direction: 'ltr', n: 150 },
    { lang: 'pl', texts: xtb('pl', 20, 90), faces: LATIN, direction: 'ltr', n: 150 },
    { lang: 'tr', texts: xtb('tr', 20, 90), faces: LATIN, direction: 'ltr', n: 150 },
    { lang: 'ru', texts: xtb('ru', 20, 90), faces: CYRILLIC, direction: 'ltr', n: 250 },
    { lang: 'vi', texts: xtb('vi', 20, 90), faces: VIET, direction: 'ltr', n: 150 },
    { lang: 'zh', texts: sentences(corpus('zh-zhufu') + corpus('zh-guxiang'), 8, 40, true), faces: ['PingFang SC', 'Songti SC', 'Hiragino Sans GB'], direction: 'ltr', n: 250 },
    { lang: 'ja', texts: sentences(corpus('ja-rashomon') + corpus('ja-kumo-no-ito'), 8, 40, true), faces: ['Hiragino Sans', 'Hiragino Mincho ProN'], direction: 'ltr', n: 200 },
    { lang: 'ko', texts: sentences(corpus('ko-sonagi') + corpus('ko-unsu-joh-eun-nal'), 10, 60, false), faces: ['Apple SD Gothic Neo'], direction: 'ltr', n: 200 },
    { lang: 'ar', texts: sentences(corpus('ar-al-bukhala') + corpus('ar-risalat-al-ghufran-part-1'), 15, 90, false), faces: ['Geeza Pro', 'Baghdad', 'Damascus', 'Al Nile'], direction: 'rtl', n: 250 },
    { lang: 'he', texts: sentences(corpus('he-masaot-binyamin-metudela'), 15, 90, false), faces: ['Arial Hebrew', 'Times New Roman', 'Arial'], direction: 'rtl', n: 150 },
  ]
  const SIZES = [24, 32, 40, 48, 64]
  const WIDTHS = [240, 320, 400, 560, 720, 960]
  const cases: Case[] = []
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s]!
    if (source.texts.length === 0) throw new Error(`no texts for ${source.lang}`)
    for (let n = 0; n < source.n; n++) {
      const t = source.texts[Math.floor(rng.next() * source.texts.length)]!
      const face = rng.pick(source.faces)
      const size = rng.pick(SIZES)
      const weight = rng.chance(0.4) ? 700 : 400
      const r = rng.next()
      const em = r < 0.5 ? 0 : r < 0.7 ? -0.02 : r < 0.8 ? -0.01 : r < 0.92 ? 0.05 : 0.1
      const letterSpacing = Math.round(size * em * 100) / 100
      const f = font(canonicalFontFamily(`"${face}"`), size, weight)
      const p0 = paragraph({ font: f, lang: source.lang, lineHeight: Math.round(size * 1.25), letterSpacing, overflowWrap: 'break-word', direction: source.direction }, [text(t)])
      const picked = new Set<number>()
      while (picked.size < 3) picked.add(rng.pick(WIDTHS))
      for (const w of [...picked].sort((a, b) => a - b)) {
        cases.push(makeCase({ family: `bwfa-headings/${source.lang}`, origin: `bwfa headings ${source.lang} ${face} ${size}px w${weight} ls${letterSpacing} width=${w}`, pageLang: source.lang, paragraph: { ...p0, width: w } }))
      }
    }
  }
  write('headings.ndjson', cases)
}

// ---- word spacing ----
{
  const rng = createRng(`${seed}-wordspacing`)
  const texts = sentences(corpus('en-gatsby-opening'), 40, 300, false).concat(sentences(corpus('mixed-app-text'), 40, 300, false), xtb('en-GB', 60, 300), xtb('de', 60, 300), xtb('fr', 60, 300))
  const FACES = ['Helvetica Neue', 'Georgia', 'Times New Roman', 'Avenir Next', 'Palatino', 'Hoefler Text']
  const cases: Case[] = []
  for (let n = 0; n < 1200; n++) {
    const t = rng.pick(texts)
    const face = rng.pick(FACES)
    const size = rng.pick([16, 18, 20])
    const wordSpacing = rng.pick([-1, 1, 2, 4])
    const f = font(canonicalFontFamily(`"${face}"`), size)
    const p0 = paragraph({ font: f, lang: 'en', lineHeight: Math.round(size * 1.5), wordSpacing, overflowWrap: 'break-word' }, [text(t)])
    for (const w of [240, 400, 560]) {
      cases.push(makeCase({ family: 'bwfa-wordspacing/latin', origin: `bwfa wordspacing ${face} ${size}px ws${wordSpacing} width=${w}`, pageLang: 'en', paragraph: { ...p0, width: w } }))
    }
  }
  write('wordspacing.ndjson', cases)
}

// ---- soft hyphens ----
{
  const rng = createRng(`${seed}-shy`)
  const VOWEL = /[aeiouäöüyAEIOUÄÖÜY]/
  const hyphenate = (word: string): string => {
    if (word.length < 10 || !/^[\p{L}]+$/u.test(word)) return word
    let outWord = ''
    let last = 0
    for (let i = 4; i < word.length - 4; i++) {
      if (VOWEL.test(word[i - 1]!) && !VOWEL.test(word[i]!) && i - last >= 3) {
        outWord += word.slice(last, i) + '\u00ad'
        last = i
      }
    }
    return outWord + word.slice(last)
  }
  const texts = xtb('de', 40, 200).concat(xtb('fi', 40, 200)).filter(t => /\p{L}{14,}/u.test(t))
  const FACES = ['Helvetica Neue', 'Georgia', 'Times New Roman', 'Avenir Next', 'Palatino']
  const cases: Case[] = []
  for (let n = 0; n < 1000; n++) {
    const t = rng.pick(texts).split(' ').map(hyphenate).join(' ')
    const face = rng.pick(FACES)
    const size = rng.pick([16, 20])
    const f = font(canonicalFontFamily(`"${face}"`), size)
    const p0 = paragraph({ font: f, lang: 'de', lineHeight: Math.round(size * 1.4), overflowWrap: 'break-word' }, [text(t)])
    for (const w of [120, 160, 200, 300]) {
      cases.push(makeCase({ family: 'bwfa-shy/de-fi', origin: `bwfa shy ${face} ${size}px width=${w}`, pageLang: 'de', paragraph: { ...p0, width: w } }))
    }
  }
  write('shy.ndjson', cases)
}

// ---- body text in other Latin languages ----
{
  const rng = createRng(`${seed}-body`)
  const LATIN = ['Helvetica Neue', 'Georgia', 'Times New Roman', 'Avenir Next', 'Palatino', 'Hoefler Text', 'Gill Sans', 'Optima', 'Arial', 'Verdana']
  const sources: { lang: string; texts: string[]; n: number }[] = [
    { lang: 'fr', texts: xtb('fr', 60, 400), n: 900 }, { lang: 'de', texts: xtb('de', 60, 400), n: 500 },
    { lang: 'pl', texts: xtb('pl', 60, 400), n: 300 }, { lang: 'vi', texts: xtb('vi', 60, 400), n: 300 },
  ]
  const cases: Case[] = []
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s]!
    for (let n = 0; n < source.n; n++) {
      const t = rng.pick(source.texts)
      const face = source.lang === 'vi' ? rng.pick(['Helvetica Neue', 'Arial', 'Times New Roman', 'Avenir Next']) : rng.pick(LATIN)
      const size = rng.pick([15, 16, 17, 18])
      const f = font(canonicalFontFamily(`"${face}"`), size)
      const p0 = paragraph({ font: f, lang: source.lang, lineHeight: Math.round(size * 1.4), overflowWrap: 'break-word' }, [text(t)])
      for (const w of [180, 260, 340, 420]) {
        cases.push(makeCase({ family: `bwfa-body/${source.lang}`, origin: `bwfa body ${source.lang} ${face} ${size}px width=${w}`, pageLang: source.lang, paragraph: { ...p0, width: w } }))
      }
    }
  }
  write('body.ndjson', cases)
}

// ---- script and display faces ----
{
  const rng = createRng(`${seed}-script`)
  const FACES = ['Snell Roundhand', 'Apple Chancery', 'Zapfino', 'Savoye LET', 'Bradley Hand', 'Noteworthy', 'Marker Felt', 'Chalkboard SE', 'Chalkduster', 'Papyrus', 'Luminari', 'SignPainter', 'Trattatello', 'Herculanum', 'Copperplate', 'Party LET', 'Brush Script MT', 'Comic Sans MS', 'Skia', 'Phosphate']
  const texts = sentences(corpus('en-gatsby-opening'), 15, 160, false).concat(xtb('en-GB', 15, 160))
  const cases: Case[] = []
  for (let n = 0; n < 1500; n++) {
    const t = rng.pick(texts)
    const face = rng.pick(FACES)
    const size = rng.pick([18, 24, 32, 48])
    const f = font(canonicalFontFamily(`"${face}"`), size)
    const p0 = paragraph({ font: f, lang: 'en', lineHeight: Math.round(size * 1.6), overflowWrap: 'break-word' }, [text(t)])
    for (const w of [rng.pick([200, 280]), rng.pick([360, 480]), rng.pick([640, 900])]) {
      cases.push(makeCase({ family: `bwfa-script/${face}`, origin: `bwfa script ${face} ${size}px width=${w}`, pageLang: 'en', paragraph: { ...p0, width: w } }))
    }
  }
  write('script.ndjson', cases)
}

// ---- Nastaliq and the Mac's Arabic faces ----
{
  const rng = createRng(`${seed}-nastaliq`)
  const cases: Case[] = []
  const urdu = corpus('ur-chughd').split('\n').map(l => l.replace(/[ \t\r]+/g, ' ').replace(/^ | $/g, '')).filter(l => l.length > 0)
  const nastaliq = font(canonicalFontFamily('"Noto Nastaliq Urdu"'), 16)
  for (let l = 0; l < urdu.length; l++) {
    for (const size of [16, 20, 24, 32]) {
      const p0 = paragraph({ font: { ...nastaliq, size }, lang: 'ur', lineHeight: Math.round(size * 2.2), overflowWrap: 'break-word', direction: 'rtl' }, [text(urdu[l]!)])
      for (let w = 160; w <= 800; w += 16) cases.push(makeCase({ family: 'bwfa-nastaliq/ur', origin: `bwfa nastaliq ur-chughd:${l + 1} ${size}px width=${w}`, pageLang: 'ur', paragraph: { ...p0, width: w } }))
    }
  }
  const FACES = ['Farisi', 'Mishafi', 'Diwan Thuluth', 'Waseem', 'DecoType Naskh', 'Noto Nastaliq Urdu', 'Geeza Pro', 'Baghdad', 'Al Nile', 'Damascus', 'Al Bayan', 'Nadeem', 'Muna', 'Sana', 'Diwan Kufi', 'KufiStandardGK', 'Al Tarikh', 'Beirut']
  const arabic = sentences(corpus('ar-al-bukhala') + corpus('ar-risalat-al-ghufran-part-1'), 30, 400, false).concat(xtb('ar', 30, 300))
  for (let n = 0; n < 1500; n++) {
    const t = rng.pick(arabic)
    const face = rng.pick(FACES)
    const size = rng.pick([20, 28, 40])
    const f = font(canonicalFontFamily(`"${face}"`), size)
    const p0 = paragraph({ font: f, lang: 'ar', lineHeight: Math.round(size * 2.2), overflowWrap: 'break-word', direction: 'rtl' }, [text(t)])
    for (const w of [rng.pick([180, 240, 300]), rng.pick([360, 440, 520]), rng.pick([600, 720, 900])]) {
      cases.push(makeCase({ family: `bwfa-arabic/${face}`, origin: `bwfa arabic ${face} ${size}px width=${w}`, pageLang: 'ar', paragraph: { ...p0, width: w } }))
    }
  }
  write('nastaliq.ndjson', cases)
}
