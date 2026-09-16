import arabicCorpus from '../../corpora/ar-risalat-al-ghufran-part-1.txt' with { type: 'text' }
import englishCorpus from '../../corpora/en-gatsby-opening.txt' with { type: 'text' }
import hindiCorpus from '../../corpora/hi-eidgah.txt' with { type: 'text' }
import chineseCorpus from '../../corpora/zh-guxiang.txt' with { type: 'text' }

export type MarkdownChatSeed = {
  role: 'assistant' | 'user'
  markdown: string
}

function message(role: 'assistant' | 'user', ...lines: string[]): MarkdownChatSeed {
  return {
    role,
    markdown: lines.join('\n'),
  }
}

const BASE_MESSAGE_SPECS: MarkdownChatSeed[] = [
  message(
    'user',
    'Can we treat the rich-text inline flow helper (`rich-inline`) as a real primitive, or is it only good for one tiny demo?',
    '',
    'I mostly care about:',
    '- exact bubble heights',
    '- virtualization without DOM reads',
    '- markdown-ish inline styling',
  ),
  message(
    'assistant',
    'Short answer: **yes, inside a bounded corridor**.',
    '',
    'It already handles rich-text inline flow, `code`, and links like [Pretext](https://github.com/chenglou/pretext), while keeping pills and badges atomic. The real pressure starts once a chat bubble stops being one paragraph.',
  ),
  message(
    'user',
    'Right. My side is usually short, but your side has the weird stuff: Beijing 北京, Arabic مرحبا, emoji 👩‍🚀, and long URLs like https://example.com/reports/q3?lang=ar&mode=full',
  ),
  message(
    'assistant',
    '### What a chat renderer actually needs',
    '',
    '1. Parse markdown somewhere else.',
    '2. Normalize it into blocks and inline runs.',
    '3. Use the rich-text inline flow helper (`rich-inline`) for paragraph-ish content.',
    '4. Use the `pre-wrap` path for fenced code.',
  ),
  message(
    'user',
    'Then let’s stress it with **real markdown**: ***nested emphasis***, ~~deletions~~, `inline code`, [links](https://openai.com/), and a couple messages that are obviously richer on the AI side than on mine.',
  ),
  message(
    'assistant',
    '> If we know the exact height in advance, then virtualization is no longer guesswork.',
    '>',
    '> It becomes geometry.',
    '',
    'That is the whole reason to keep the primitive low-level and composable.',
  ),
  message(
    'user',
    'Okay, but the design matters too. The left side should feel lighter and more editorial, while my side can stay bubble-y.',
  ),
  message(
    'assistant',
    '```ts',
    'const conversation = layoutConversation(preparedMessages, width)',
    'const visible = findVisibleRange(conversation, scrollTop, viewportHeight, bannerHeight)',
    'for (let index = visible.start; index < visible.end; index++) {',
    '  const message = layoutMessage(preparedMessages[index], width)',
    '  renderMessage(message, bannerHeight + conversation.tops[index], conversation.heights[index])',
    '}',
    '```',
  ),
  message(
    'user',
    'I also want code fences, quotes, and lists to show up often enough that the 10k-thread run actually teaches us something.',
  ),
  message(
    'assistant',
    'That part is important.',
    '',
    '- paragraph layout is one leaf',
    '- code fences are another leaf',
    '- the chat message is the block-level container above both',
    '',
    'The assistant side is the real stress test because it keeps hitting headings, bullets, quotes, code fences, and occasional long explanations.',
  ),
  message(
    'user',
    'Try a checklist too. A product chat is full of little status updates.',
  ),
  message(
    'assistant',
    'Current polish pass:',
    '',
    '- lighter body copy is in',
    '- the assistant lane is bubble-less',
    '- exact height prediction is wired up',
    '- mobile screenshot smoke tests still remain',
  ),
  message(
    'user',
    'Can we keep top-level bullets flush? I do not want them shoved way in from the left like an old email client.',
  ),
  message(
    'assistant',
    'Yes. The top-level list should read almost like paragraph rhythm with markers, not like a nested document outline.',
    '',
    'Nested lists can still step in when they actually nest.',
  ),
  message(
    'user',
    'I want a structured status block too. It does not need table syntax if we are not really rendering tables here.',
  ),
  message(
    'assistant',
    '```yaml',
    'paragraph_leaf: rich-text-inline-flow',
    'code_leaf: pre-wrap',
    'quote_wrapper: block shell',
    'virtualization: exact-height-first',
    '```',
  ),
  message(
    'user',
    'What about images or chips? Even if they are fake, I want to know the primitive can hold an atomic thing.',
  ),
  message(
    'assistant',
    'It can. Something like ![diagram](https://example.com/mock-wireframe.png) behaves more like an inline chip than a splittable word, which is exactly the right stress case.',
  ),
  message(
    'user',
    'Throw in a messy status message too: deploys, timestamps, a ticket number, and maybe one escaped quote like \\"ship it\\".',
  ),
  message(
    'assistant',
    'Status snapshot:',
    '',
    '- deploy window 7:00-9:00',
    '- owner `RICH-431`',
    '- locale mix `24×7` and `२४×७`',
    '- comment: \\"ship it\\" after the Safari check',
  ),
  message(
    'user',
    'I still think the width negotiation matters more than the parser. If widths are wrong, everything feels fake.',
  ),
  message(
    'assistant',
    'Agreed. The parser is just an upstream producer.',
    '',
    'The hard contract is: once width and fonts are known, the layout layer should answer height exactly enough that virtualization never has to ask the DOM for help.',
  ),
  message(
    'user',
    'Give me one answer that feels more structured, almost like a mini design review.',
  ),
  message(
    'assistant',
    '## Design review',
    '',
    'The strongest signal so far is that **assistant messages want a different presentation contract from user messages**. The human side reads well as compact bubbles. The assistant side reads better as content on a surface with room to breathe.',
    '',
    'That split also maps nicely to the measurement model because user messages are usually short and AI responses are much more likely to hit rich block transitions.',
  ),
  message(
    'user',
    'And one answer that feels operational, like we are handing this to another engineer.',
  ),
  message(
    'assistant',
    '```json',
    '{',
    '  "parser": "marked",',
    '  "paragraphLeaf": "rich-text-inline-flow",',
    '  "codeLeaf": "pre-wrap",',
    '  "virtualization": "exact-height-first",',
    '  "openRisk": "long-scroll-device-smoke"', 
    '}',
    '```',
  ),
  message(
    'user',
    'We should probably include a short answer too, otherwise every assistant message looks essay-shaped.',
  ),
  message(
    'assistant',
    'Yep. Short answers are a useful canary because they should not inherit giant block spacing or overbuilt chrome.',
  ),
  message(
    'user',
    'Try a message with HTML-ish content too. Not because we love it, just because users paste odd things.',
  ),
  message(
    'assistant',
    '<aside>Escaped HTML still needs a stable fallback path.</aside>',
    '',
    'If it comes through as a block token, we can still route it through a plain-text or code-like presentation instead of pretending we have a full browser renderer.',
  ),
  message(
    'user',
    'I also want more than one quote style in the loop. Otherwise we are tuning for a single canned example.',
  ),
  message(
    'assistant',
    '> The nice version of exact measurement is smooth scrolling.',
    '>',
    '> The brutal version is that every wrong guess accumulates.',
    '',
    '> In a 10k thread, accumulation is the enemy.',
  ),
  message(
    'user',
    'Can you make one answer about search or citations? AI chats have that vibe a lot now.',
  ),
  message(
    'assistant',
    'Sure. A citation-heavy answer is mostly the same inline problem with a little more link density:',
    '',
    '- [spec note](https://example.com/spec)',
    '- [issue thread](https://example.com/issues/431)',
    '- [benchmark doc](https://example.com/benchmarks)',
  ),
  message(
    'user',
    'Maybe a message that mixes scripts more aggressively: English, 日本語, العربية, and a little emoji.',
  ),
  message(
    'assistant',
    'Mixed-script sample: English for the framing, 日本語 for compact line breaks, العربية for punctuation clusters, and emoji like 🧪📐 to keep the grapheme path honest.',
  ),
  message(
    'user',
    'I want at least one answer that uses nested bullets so we can see whether the second level still reads okay.',
  ),
  message(
    'assistant',
    'Things to watch:',
    '',
    '- top-level bullets should feel close to body text',
    '- nested bullets can indent, but only when they truly nest',
    '  - this second level should not explode the width math',
    '  - the marker still needs a clean left gutter',
    '- quotes and code fences should tuck closer to the lead-in paragraph',
  ),
  message(
    'user',
    'Can we include a very plain human message too? Real threads have those.',
  ),
  message(
    'assistant',
    'Absolutely.',
  ),
  message(
    'user',
    'cool. also make sure the scroll still feels stable when widths change',
  ),
  message(
    'assistant',
    'That is one of the better parts of the demo right now: width changes recompute every height and re-render only the visible window.',
  ),
  message(
    'user',
    'One last thing: mention the hypothesis space. I still care a lot about not painting ourselves into a corner.',
  ),
  message(
    'assistant',
    'The good version of this alpha API is not “we solved rich text.” It is “we found a low-level paragraph leaf that keeps the hypothesis space open for a richer block model above it.”',
  ),
]

// An Arabic answer, with an English name and a number inside its paragraph, a
// list and a quote. The chat paints each from the right.
const RIGHT_TO_LEFT_MESSAGE = message(
  'assistant',
  'ملخص سريع للفريق: تضم هذه المحادثة 10,000 رسالة، ويحسب Pretext ارتفاع كل رسالة منها قبل أن تظهر على الشاشة، فلا يحتاج التمرير إلى قياس أي شيء من الصفحة.',
  '',
  '- تُقاس النصوص مرة واحدة عند تحضير الرسائل.',
  '- يُعاد حساب الارتفاعات كلما تغيّر العرض.',
  '- لا تُرسم إلا الرسائل الظاهرة على الشاشة.',
  '',
  '> إذا عرفنا الارتفاع الدقيق مسبقًا، لم يعد التمرير الافتراضي تخمينًا، بل صار هندسة.',
)

// The thread opens with the hand-written seeds above, and the right-to-left
// message sits near its end. Every other message is generated: it takes the
// shape and markdown features of one of the seeds, with the seeds' frequencies,
// and fills it with corpus text. Real chats don't reuse the same 44 messages, so
// preparation meets new words as they do.
const GENERATOR_SEED = 20260404
// There are 22 seeds of each role, and each seed is one weight.
const SHAPES_PER_ROLE = 22

type Random = () => number

const SENTENCE_BREAK = /(?<=[.!?][”’"]?)\s+/
const MARKDOWN_SYNTAX = /[*_`<>#[\]|\\~=]|https?:|www\.|^(?:\d+[.)]|[-+])\s/
const ENGLISH_START = /^[A-Z“"]/
// Other scripts come only from the mixed-script shapes, as in the seeds.
const OTHER_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u
const EMOJI = ['👩‍🚀', '🧪📐', '👩‍💻', '👨🏽‍🔬', '👨‍👩‍👧‍👦', '✅', '🚀']

const ENGLISH_SENTENCES = collectEnglishSentences(englishCorpus)
const SEED_SENTENCES = collectEnglishSentences(BASE_MESSAGE_SPECS.map(spec => spec.markdown).join('\n'))
const CHINESE_RUNS = collectScriptRuns(chineseCorpus, /[^\p{Script=Han}]+/u)
const ARABIC_RUNS = collectScriptRuns(arabicCorpus, /[^\p{Script=Arabic}\p{M} ]+/u)
const HINDI_RUNS = collectScriptRuns(hindiCorpus, /[^\p{Script=Devanagari}\p{M} ]+/u)

export function createMarkdownChatSpecs(count: number): MarkdownChatSeed[] {
  const random = createRandom(GENERATOR_SEED)
  const specs: MarkdownChatSeed[] = []
  const seen = new Set<string>()

  for (let index = 0; index < Math.min(count, BASE_MESSAGE_SPECS.length); index++) {
    const spec = BASE_MESSAGE_SPECS[index]!
    specs.push(spec)
    seen.add(spec.markdown)
  }

  while (specs.length < count) {
    const role = specs.length % 2 === 0 ? 'user' : 'assistant'
    // Pick the shape once, so retrying a duplicate keeps the seed weights.
    const shape = Math.floor(random() * SHAPES_PER_ROLE)
    let markdown: string
    do {
      markdown = role === 'user' ? createUserMarkdown(random, shape) : createAssistantMarkdown(random, shape)
    } while (seen.has(markdown))
    seen.add(markdown)
    specs.push({ role, markdown })
  }
  // It takes the place of the third message from the end, an assistant message,
  // so the chat shows it soon after opening on the latest message. The others
  // stay as generated.
  specs[count - 3] = RIGHT_TO_LEFT_MESSAGE

  return specs
}

// Weights follow the 22 user seeds: 17 plain paragraphs, then one each of a
// list, a URL with mixed scripts, rich marks, escaped quotes and mixed scripts.
function createUserMarkdown(random: Random, shape: number): string {
  switch (shape) {
    case 0:
      return lines(
        insertWords(random, sentence(random), `(\`${identifier(random)}\`)`),
        '',
        `${capitalize(phrase(random, 2, 4))}:`,
        `- ${phrase(random, 2, 5)}`,
        `- ${phrase(random, 2, 5)}`,
        `- ${phrase(random, 2, 5)}`,
      )
    case 1:
      return `${sentence(random)} ${capitalize(phrase(random, 1, 2))} ${chinesePhrase(random)}, ${phrase(random, 1, 2)} ${scriptPhrase(random, ARABIC_RUNS, 2)}, ${pick(random, EMOJI)}, and ${phrase(random, 2, 3)} https://example.com/${slug(random)}?lang=ar&mode=full`
    case 2:
      return insertWords(
        random,
        sentence(random),
        `**${phrase(random, 1, 2)}**, ***${phrase(random, 1, 2)}***, ~~${phrase(random, 1, 2)}~~, \`${identifier(random)}\`, [${phrase(random, 1, 2)}](https://example.com/${slug(random)})`,
      )
    case 3:
      return insertWords(random, sentence(random), `\\"${phrase(random, 2, 3)}\\"`)
    case 4:
      return insertWords(random, sentence(random), `${phrase(random, 1, 2)}, ${chinesePhrase(random)}, ${scriptPhrase(random, ARABIC_RUNS, 2)},`)
    default:
      return paragraph(random, between(random, 1, 2))
  }
}

// Weights follow the 22 assistant seeds: 4 short answers, then the richer
// shapes in the proportions the seeds use them.
function createAssistantMarkdown(random: Random, shape: number): string {
  switch (shape) {
    case 0: {
      const text = insertWords(random, paragraph(random, between(random, 1, 2)), `${chinesePhrase(random)}, ${scriptPhrase(random, ARABIC_RUNS, 3)}`)
      return insertWords(random, text, pick(random, EMOJI))
    }
    case 1:
    case 2:
      return lines(paragraph(random, 2), '', paragraph(random, 2))
    case 3:
      return lines(
        insertWords(random, paragraph(random, 1), `**${phrase(random, 2, 5)}**`),
        '',
        insertWords(random, insertWords(random, paragraph(random, 2), `\`${identifier(random)}\``), `[${phrase(random, 1, 2)}](https://example.com/${slug(random)})`),
      )
    case 4:
      return lines(
        `### ${capitalize(phrase(random, 3, 6))}`,
        '',
        `1. ${capitalize(phrase(random, 3, 7))}.`,
        `2. ${capitalize(phrase(random, 3, 7))} \`${identifier(random)}\`.`,
        `3. ${capitalize(phrase(random, 3, 7))}.`,
        `4. ${capitalize(phrase(random, 2, 5))} \`${identifier(random)}\`.`,
      )
    case 5:
      return lines(`> ${sentence(random)}`, '>', `> ${sentence(random)}`, '', paragraph(random, 1))
    case 6:
      return lines(`> ${sentence(random)}`, '>', `> ${sentence(random)}`, '', `> ${sentence(random)}`)
    case 7: {
      const code: string[] = []
      for (let index = between(random, 2, 4); index > 0; index--) {
        code.push(`const ${identifier(random)} = ${identifier(random)}(${identifier(random)}, ${identifier(random)})`)
      }
      return lines('```ts', ...code, '```')
    }
    case 8: {
      const code: string[] = []
      for (let index = between(random, 3, 5); index > 0; index--) {
        code.push(`${englishWords(random, 2).join('_')}: ${phrase(random, 1, 4)}`)
      }
      return lines('```yaml', ...code, '```')
    }
    case 9: {
      const code: string[] = ['{']
      const fieldCount = between(random, 3, 5)
      for (let index = 0; index < fieldCount; index++) {
        code.push(`  "${identifier(random)}": "${phrase(random, 1, 4)}"${index === fieldCount - 1 ? '' : ','}`)
      }
      code.push('}')
      return lines('```json', ...code, '```')
    }
    case 10:
      return lines(paragraph(random, 1), '', ...bulletItems(random, 3), '', paragraph(random, 1))
    case 11:
      return lines(paragraph(random, 1), '', ...bulletItems(random, 4))
    case 12: {
      const hour = between(random, 6, 10)
      const days = between(random, 2, 7)
      return lines(
        `${capitalize(phrase(random, 1, 3))}:`,
        '',
        `- ${phrase(random, 2, 3)} ${hour}:00-${hour + 2}:00`,
        `- ${phrase(random, 1, 2)} \`RICH-${between(random, 100, 999)}\``,
        `- ${phrase(random, 2, 3)} \`${24}×${days}\` and \`${toDevanagariDigits(24)}×${toDevanagariDigits(days)}\``,
        `- ${phrase(random, 1, 2)}: \\"${phrase(random, 2, 3)}\\" ${scriptPhrase(random, HINDI_RUNS, 3)}`,
      )
    }
    case 13:
      return lines(
        paragraph(random, 1),
        '',
        `- [${phrase(random, 2, 3)}](https://example.com/${slug(random)})`,
        `- [${phrase(random, 2, 3)}](https://example.com/${slug(random)})`,
        `- [${phrase(random, 2, 3)}](https://example.com/${slug(random)})`,
      )
    case 14:
      return insertWords(random, paragraph(random, between(random, 1, 2)), `![${phrase(random, 1, 2)}](https://example.com/${slug(random)}.png)`)
    case 15:
      return lines(
        `## ${capitalize(phrase(random, 2, 4))}`,
        '',
        insertWords(random, paragraph(random, 2), `**${phrase(random, 3, 8)}**`),
        '',
        paragraph(random, 2),
      )
    case 16:
      return lines(`<aside>${sentence(random)}</aside>`, '', paragraph(random, between(random, 1, 2)))
    case 17:
      return lines(
        `${capitalize(phrase(random, 2, 4))}:`,
        '',
        `- ${phrase(random, 4, 9)}`,
        `- ${phrase(random, 4, 9)}`,
        `  - ${phrase(random, 4, 9)}`,
        `  - ${phrase(random, 4, 9)}`,
        `- ${phrase(random, 4, 9)}`,
      )
    default:
      return paragraph(random, between(random, 1, 2))
  }
}

function bulletItems(random: Random, count: number): string[] {
  const items: string[] = []
  for (let index = 0; index < count; index++) items.push(`- ${phrase(random, 3, 9)}`)
  return items
}

function lines(...parts: string[]): string {
  return parts.join('\n')
}

function paragraph(random: Random, sentenceCount: number): string {
  const sentences: string[] = []
  for (let index = 0; index < sentenceCount; index++) sentences.push(sentence(random))
  return sentences.join(' ')
}

// Mostly novel prose, with some of the seeds' own chat sentences.
function sentence(random: Random): string {
  return pick(random, random() < 0.35 ? SEED_SENTENCES : ENGLISH_SENTENCES)
}

function phrase(random: Random, minWords: number, maxWords: number): string {
  return englishWords(random, between(random, minWords, maxWords)).join(' ')
}

function identifier(random: Random): string {
  const [first, second] = englishWords(random, 2)
  return first! + capitalize(second!)
}

function slug(random: Random): string {
  return englishWords(random, between(random, 1, 3)).join('-')
}

function englishWords(random: Random, count: number): string[] {
  const words: string[] = []
  while (words.length < count) {
    const parts = pick(random, ENGLISH_SENTENCES).split(' ')
    for (let index = Math.floor(random() * parts.length); index < parts.length && words.length < count; index++) {
      const word = parts[index]!.toLowerCase().replace(/[^a-z]/g, '')
      if (word.length >= 3) words.push(word)
    }
  }
  return words
}

function chinesePhrase(random: Random): string {
  const characters = Array.from(pick(random, CHINESE_RUNS))
  const length = between(random, 2, Math.min(4, characters.length))
  const start = Math.floor(random() * (characters.length - length + 1))
  return characters.slice(start, start + length).join('')
}

function scriptPhrase(random: Random, runs: readonly string[], maxWords: number): string {
  const words = pick(random, runs).split(' ')
  const count = between(random, 1, Math.min(maxWords, words.length))
  const start = Math.floor(random() * (words.length - count + 1))
  return words.slice(start, start + count).join(' ')
}

function insertWords(random: Random, text: string, insertion: string): string {
  const words = text.split(' ')
  words.splice(between(random, 1, words.length), 0, insertion)
  return words.join(' ')
}

function toDevanagariDigits(value: number): string {
  return String(value).replace(/\d/g, digit => String.fromCharCode(0x0966 + Number(digit)))
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!
}

function between(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

// mulberry32
function createRandom(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Plain sentences that cannot turn into markdown syntax.
function collectEnglishSentences(text: string): string[] {
  const sentences: string[] = []
  const paragraphs = text.split('\n')
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const parts = paragraphs[paragraphIndex]!.split(SENTENCE_BREAK)
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!.trim()
      if (part.length < 24 || part.length > 200) continue
      if (!ENGLISH_START.test(part) || MARKDOWN_SYNTAX.test(part) || OTHER_SCRIPT.test(part)) continue
      sentences.push(part)
    }
  }
  return sentences
}

// Runs of one script between other characters, with spaces collapsed.
function collectScriptRuns(text: string, separator: RegExp): string[] {
  const runs: string[] = []
  const parts = text.split(separator)
  for (let index = 0; index < parts.length; index++) {
    const run = parts[index]!.trim().replace(/ +/g, ' ')
    if (run.length >= 2) runs.push(run)
  }
  return runs
}
