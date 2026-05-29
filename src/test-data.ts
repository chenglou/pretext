// Shared test data for the browser accuracy pages/checkers and browser
// benchmark page (pages/benchmark.ts).
// Covers Latin, Arabic, Hebrew, CJK, Korean, Thai, emoji, mixed-direction,
// and edge cases (empty, whitespace, newlines, long words). Parameters sweep
// across realistic font sizes and container widths.

export const TEXTS = [
  // Latin
  { label: 'Latin update', text: "Just tried the new update and it's so much better. The performance improvements are really noticeable, especially on older devices." },
  { label: 'Latin compatibility', text: "Does anyone know if this works with the latest version? I've been having some issues since the upgrade." },
  { label: 'Latin short', text: "This is exactly what I was looking for. Simple, clean, and does exactly what it says on the tin." },
  { label: 'Latin caching', text: "The key insight is that you can cache word measurements separately from layout results. This gives you the best of both worlds." },
  { label: 'Latin punctuation', text: "Performance is critical for this kind of library. If you can't measure hundreds of text blocks per frame, it's not useful for real applications." },
  { label: 'Latin hyphenation', text: "One thing I noticed is that the line breaking algorithm doesn't handle hyphenation. Is that on the roadmap?" },

  // Arabic
  { label: 'Arabic', text: "هذا النص باللغة العربية لاختبار دعم الاتجاه من اليمين إلى اليسار في مكتبة تخطيط النص" },
  { label: 'Arabic short', text: "مرحبا بالعالم، هذه تجربة لقياس النص العربي وكسر الأسطر بشكل صحيح" },

  // Hebrew
  { label: 'Hebrew', text: "זהו טקסט בעברית כדי לבדוק תמיכה בכיוון מימין לשמאל בספריית פריסת הטקסט" },
  { label: 'Hebrew short', text: "שלום עולם, זוהי בדיקה למדידת טקסט עברי ושבירת שורות" },

  // Mixed LTR + RTL
  { label: 'Mixed en+ar', text: "The meeting is scheduled for يوم الثلاثاء at the main office. Please bring your مستندات with you." },
  { label: 'Mixed report', text: "According to the report by محمد الأحمد, the results show significant improvement in performance." },
  { label: 'Mixed en+he', text: "The project name is פרויקט חדש and it was started last month by the research team." },
  { label: 'Mixed version', text: "Version 3.2.1 של התוכנה was released on January 15th with many improvements." },

  // CJK
  { label: 'Chinese', text: "这是一段中文文本，用于测试文本布局库对中日韩字符的支持。每个字符之间都可以断行。" },
  { label: 'Chinese short', text: "性能测试显示，新的文本测量方法比传统方法快了将近一千五百倍。" },
  { label: 'Japanese', text: "これはテキストレイアウトライブラリのテストです。日本語のテキストを正しく処理できるか確認します。" },
  { label: 'Japanese short', text: "パフォーマンスは非常に重要です。フレームごとに数百のテキストブロックを測定する必要があります。" },
  { label: 'Korean', text: "이것은 텍스트 레이아웃 라이브러리의 테스트입니다. 한국어 텍스트를 올바르게 처리할 수 있는지 확인합니다." },

  // Thai
  { label: 'Thai', text: "นี่คือข้อความทดสอบสำหรับไลบรารีจัดวางข้อความ ทดสอบการตัดคำภาษาไทย" },

  // Emoji
  { label: 'Emoji mixed', text: "The quick 🦊 jumped over the lazy 🐕 and then went home 🏠 to rest 😴 for the night." },
  { label: 'Emoji dense', text: "Great work! 👏👏👏 This is exactly what we needed 🎯 for the project 🚀" },

  // Mixed everything
  { label: 'Multi-script', text: "Hello مرحبا שלום 你好 こんにちは 안녕하세요 สวัสดี — a greeting in seven scripts!" },
  { label: 'Numbers+RTL', text: "The price is $42.99 (approximately ٤٢٫٩٩ ريال or ₪158.50) including tax." },

  // Edge cases
  { label: 'Empty', text: "" },
  { label: 'Single char', text: "A" },
  { label: 'Whitespace', text: "   " },
  { label: 'Newlines', text: "Hello\nWorld\nMultiple\nLines" },
  { label: 'Long word', text: "Superlongwordwithoutanyspacesthatshouldjustoverflowthelineandkeepgoing" },
  { label: 'Long mixed', text: "In the heart of القاهرة القديمة, you can find ancient mosques alongside modern cafés. The city's history spans millennia. كل شارع يحكي قصة مختلفة about the rich cultural heritage." },
] as const

export const SIZES = [12, 14, 15, 16, 18, 20, 24, 28] as const

export const WIDTHS = [150, 200, 250, 300, 350, 400, 500, 600] as const

export type ProbeOracleCase = {
  label: string
  text: string
  width: number
  font: string
  lineHeight: number
  letterSpacing?: number
  whiteSpace?: 'normal' | 'pre-wrap'
  wordBreak?: 'normal' | 'keep-all'
  dir?: 'ltr' | 'rtl'
  lang?: string
  method?: 'range' | 'span'
  browsers?: readonly ('chrome' | 'safari' | 'firefox')[]
}

export type LetterSpacingOracleCase = ProbeOracleCase & {
  letterSpacing: number
}

export const LETTER_SPACING_ORACLE_CASES: readonly LetterSpacingOracleCase[] = [
  {
    label: 'latin segment gaps',
    text: 'Alpha beta gamma',
    width: 170,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1.5,
  },
  {
    label: 'negative tracking',
    text: 'The quick brown fox jumps',
    width: 150,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: -0.8,
  },
  {
    label: 'overflow grapheme breaks',
    text: 'Supercalifragilistic',
    width: 135,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 2,
  },
  {
    label: 'latin trailing fit gap',
    text: 'abcd',
    width: 120,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1.5,
  },
  {
    label: 'combining graphemes',
    text: 'Cafe\u0301 naive',
    width: 120,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1.5,
    method: 'span',
  },
  {
    label: 'cjk boundaries',
    text: '春天到了中文测试',
    width: 210,
    font: '20px serif',
    lineHeight: 34,
    letterSpacing: 2,
    lang: 'zh',
  },
  {
    label: 'emoji graphemes',
    text: 'A😀🎉B wraps',
    width: 155,
    font: '20px serif',
    lineHeight: 34,
    letterSpacing: 1.5,
  },
  {
    label: 'digits and punctuation',
    text: '24×7, 7:00-9:00?',
    width: 175,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1.25,
  },
  {
    label: 'arabic rtl punctuation',
    text: 'مرحبا، عالم؟',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    letterSpacing: 1,
    dir: 'rtl',
    lang: 'ar',
  },
  {
    label: 'mixed bidi trailing fit gap',
    text: 'abc אבג def',
    width: 110,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1.5,
    lang: 'he',
  },
  {
    label: 'pre-wrap hard breaks',
    text: 'foo\nbar baz',
    width: 170,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 2,
    whiteSpace: 'pre-wrap',
  },
  {
    label: 'pre-wrap preserved spaces',
    text: 'foo    bar',
    width: 150,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1.25,
    whiteSpace: 'pre-wrap',
    method: 'span',
  },
  {
    label: 'soft hyphen',
    text: 'trans\u00ADatlantic transit',
    width: 150,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1.5,
  },
  {
    label: 'keep-all mixed cjk',
    text: '日本語foo-bar',
    width: 170,
    font: '18px serif',
    lineHeight: 32,
    letterSpacing: 1,
    wordBreak: 'keep-all',
    lang: 'ja',
  },
]

export const PRE_WRAP_ORACLE_CASES: readonly ProbeOracleCase[] = [
  {
    label: 'hanging spaces',
    text: 'foo   bar',
    width: 120,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'hard break',
    text: 'a\nb',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'double hard break',
    text: '\n\n',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'trailing final break',
    text: 'a\n',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'leading spaces after break',
    text: 'foo\n  bar',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'whitespace-only middle line',
    text: 'foo\n  \nbar',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'spaces before hard break',
    text: 'foo  \nbar',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'tab before hard break',
    text: 'foo\t\nbar',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'crlf normalization',
    text: 'foo\r\n  bar',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'preserved space run',
    text: 'foo    bar',
    width: 126,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'mixed script indent',
    text: 'AGI 春天到了\n  بدأت الرحلة 🚀',
    width: 260,
    font: '18px "Helvetica Neue", Arial, sans-serif',
    lineHeight: 30,
    dir: 'ltr',
    lang: 'en',
  },
  {
    label: 'rtl indent',
    text: 'مرحبا\n  بالعالم',
    width: 220,
    font: '20px "Geeza Pro", "Arial", serif',
    lineHeight: 34,
    dir: 'rtl',
    lang: 'ar',
  },
  {
    label: 'default tab stops',
    text: 'a\tb',
    width: 120,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'double tabs',
    text: 'a\t\tb',
    width: 130,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'tab after hard break',
    text: 'foo\n\tbar',
    width: 220,
    font: '18px serif',
    lineHeight: 32,
  },
]

export const SYMBOL_ORACLE_CASES: readonly ProbeOracleCase[] = [
  {
    label: 'ascii symbols inside long words',
    text: 'aaaaaaaaaaaaaaaa!bbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb',
    width: 150,
    font: '16px Helvetica',
    lineHeight: 19,
    method: 'span',
    browsers: ['chrome', 'safari'],
  },
  {
    label: 'unicode symbols inside long words',
    text: 'aaaaaaaaaaaaaaaa♂bbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaa╥bbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaa⁄bbbbbbbbbbbbbbbb',
    width: 150,
    font: '16px Helvetica',
    lineHeight: 19,
    method: 'span',
    browsers: ['chrome', 'safari'],
  },
  {
    label: 'browser break symbols stay breakable',
    text: 'aaaaaaaaaaaaaaaa?bbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaa🙂bbbbbbbbbbbbbbbb',
    width: 150,
    font: '16px Helvetica',
    lineHeight: 19,
    method: 'span',
    browsers: ['chrome', 'safari'],
  },
]

export const KEEP_ALL_ORACLE_CASES: readonly ProbeOracleCase[] = [
  {
    label: 'mixed latin plus cjk',
    text: 'A 中文测试',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
    lang: 'zh',
  },
  {
    label: 'cjk punctuation boundary',
    text: '中文，测试。下一句。',
    width: 190,
    font: '18px serif',
    lineHeight: 32,
    lang: 'zh',
  },
  {
    label: 'safari ideographic punctuation keep-all boundary',
    text: 'foo。bar日本語',
    width: 120,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
    method: 'span',
    browsers: ['safari'],
  },
  {
    label: 'korean no-space word',
    text: '한국어테스트 테스트입니다',
    width: 220,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'mixed no-space cjk plus latin narrow',
    text: '日本語foo-bar',
    width: 110,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
  },
  {
    label: 'cjk leading latin hyphen boundary',
    text: '日本語foo-bar',
    width: 180,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
  },
  {
    label: 'mixed no-space latin plus cjk run',
    text: 'abc日本語',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
  },
  {
    label: 'mixed no-space dotted latin plus cjk run',
    text: 'foo.bar日本語',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
    method: 'range',
    browsers: ['chrome'],
  },
  {
    label: 'mixed no-space numeric plus cjk run',
    text: '500円テスト',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
  },
  {
    label: 'mixed no-space hyphen boundary',
    text: 'foo-bar日本語',
    width: 180,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
  },
  {
    label: 'mixed no-space em dash boundary',
    text: 'foo\u2014bar日本語',
    width: 160,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
  },
]
