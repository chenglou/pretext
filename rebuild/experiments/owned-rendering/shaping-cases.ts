// Painting cases for a shared owned-rendering algorithm, not browser-paragraph parity.
// All named primary fonts are recorded installed in rebuild/lab/font-facts.json.
// Same-font item boundaries stand for color/link/decorative changes. A browser driver
// may give them alternating colors; those colors must not change measurement inputs.
export type ShapingTextItem = {
  kind: 'text'
  text: string
  font: string
  letterSpacing?: number
}
export type ShapingAtomicItem = {
  kind: 'atomic'
  width: number
  height: number
  label: string
}
export type ShapingItem = ShapingTextItem | ShapingAtomicItem
export type ShapingCase = {
  id: string
  direction: 'ltr' | 'rtl'
  lang: string
  widths: number[]
  items: ShapingItem[]
  expectation: 'independent' | 'group' | 'reject-grapheme'
  // Item indices which must shape together, or need a documented limitation.
  // This is expected behavior for the test, not a new public input requirement.
  groups?: number[][]
  note: string
}

const latin = '20px "Times New Roman"'
const arabic = '24px "Geeza Pro"'
const devanagari = '24px "Kohinoor Devanagari"'
const bangla = '24px "Kohinoor Bangla"'
const khmer = '24px "Khmer Sangam MN"'
const myanmar = '24px "Myanmar MN"'
const thai = '24px "Thonburi"'
const emoji = '24px "Apple Color Emoji"'
const text = (value: string, font: string = latin, letterSpacing?: number): ShapingTextItem =>
  letterSpacing === undefined ? { kind: 'text', text: value, font } : { kind: 'text', text: value, font, letterSpacing }

export const shapingCases: ShapingCase[] = [
  {
    id: 'latin-av-item-boundary', direction: 'ltr', lang: 'en', widths: [28, 96, 220],
    items: [text('A'), text('V'), text(' AVATAR')], expectation: 'independent',
    note: 'Losing AV kerning between items is allowed. The AV inside the third item must keep native shaping; item positions use separately measured widths.',
  },
  {
    id: 'latin-fi-item-boundary', direction: 'ltr', lang: 'en', widths: [32, 105, 240],
    items: [text('f'), text('i'), text(' office affinity ffi')], expectation: 'independent',
    note: 'Losing fi/ffi ligatures across items is allowed. Ligatures inside each painted fragment remain the browser’s; do not sum isolated grapheme widths inside a word.',
  },
  {
    id: 'arabic-complete-words', direction: 'rtl', lang: 'ar', widths: [38, 140, 280],
    items: [text('السلام', arabic), text(' عليكم ', arabic), text('مرحبا', arabic)], expectation: 'independent',
    note: 'Complete Arabic words keep joining and marks inside each independently painted word. A word wider than the line may overflow rather than split its joining chain.',
  },
  {
    id: 'arabic-color-only-joined-items', direction: 'rtl', lang: 'ar', widths: [40, 110, 220],
    items: [text('س', arabic), text('لا', arabic), text('م', arabic)], expectation: 'group', groups: [[0, 1, 2]],
    note: 'Each item boundary is a valid grapheme boundary, but independent spans lose required joining. Same-font color-only items should form one shaping group, or this input must be rejected explicitly.',
  },
  {
    id: 'arabic-lam-alef-between-items', direction: 'rtl', lang: 'ar', widths: [20, 80, 160],
    items: [text('ل', arabic), text('ا', arabic), text(' لا', arabic)], expectation: 'group', groups: [[0, 1]],
    note: 'Lam-alef crosses a grapheme boundary. A joiner on each isolated letter does not guarantee the same required ligature; grouping is simpler than inferring its two shares.',
  },
  {
    id: 'arabic-marks-transparent-at-boundary', direction: 'rtl', lang: 'ar', widths: [35, 105, 230],
    items: [text('بَ', arabic), text('تُ', arabic), text(' بَتُ', arabic)], expectation: 'group', groups: [[0, 1]],
    note: 'Combining marks belong to their bases, so item boundaries are grapheme-safe. Joining nevertheless continues across the transparent marks; reuse joinsAcross rather than checking adjacent code units.',
  },
  {
    id: 'arabic-explicit-non-joiner', direction: 'rtl', lang: 'fa', widths: [40, 140, 270],
    items: [text('می‌', arabic), text('روم', arabic)], expectation: 'independent',
    note: 'The supplied ZWNJ deliberately ends joining. Keep it in measurement and logical DOM text; do not add joining merely because both sides use Arabic-script letters.',
  },
  {
    id: 'arabic-font-change-inside-joining-chain', direction: 'rtl', lang: 'ar', widths: [30, 115, 225],
    items: [text('س', arabic), text('لا', '24px "Noto Nastaliq Urdu"'), text('م', arabic)], expectation: 'group', groups: [[0, 1, 2]],
    note: 'A common-font group cannot solve this font change. Prototype-safe policy requires the caller to style the full joining word consistently; contextual joiners across fonts need a separate validated extension.',
  },
  {
    id: 'urdu-complete-word-context', direction: 'rtl', lang: 'ur', widths: [40, 160, 320],
    items: [text('خوش آمدید', '28px "Noto Nastaliq Urdu"'), text(' 123', latin)], expectation: 'independent',
    note: 'Nastaliq can depend on more than a neighboring pair and can overhang its advance. Preserve complete words, allow ink overhang, and compare actual painted fragment shaping, not a native wrapped paragraph.',
  },
  {
    id: 'devanagari-complete-conjuncts', direction: 'ltr', lang: 'hi', widths: [34, 125, 260],
    items: [text('क्षि श्री क्षेत्रफल', devanagari), text(' भारत', devanagari)], expectation: 'independent',
    note: 'Conjuncts and pre-base vowels must remain inside a shaped fragment. Existing Unicode-17 graphemes include क्षि and श्री; complete words conservatively preserve syllables too.',
  },
  {
    id: 'devanagari-split-conjunct-is-invalid', direction: 'ltr', lang: 'hi', widths: [35, 110, 210],
    items: [text('क्', devanagari), text('षि', devanagari)], expectation: 'reject-grapheme',
    note: 'The boundary inside क्षि is not an extended-grapheme boundary in any current redo engine. Reject at preparation instead of painting two broken syllables.',
  },
  {
    id: 'bangla-complete-syllables', direction: 'ltr', lang: 'bn', widths: [36, 135, 260],
    items: [text('ক্ষি বাংলা', bangla), text(' শ্রদ্ধা', bangla)], expectation: 'independent',
    note: 'Keep dependent vowels, reordering and conjuncts together. Named installed Bangla font avoids treating a fallback glyph or equal widths as evidence that syllable splitting is safe.',
  },
  {
    id: 'myanmar-syllable-exceeds-grapheme', direction: 'ltr', lang: 'my', widths: [34, 100, 220],
    items: [text('ကျေ', myanmar), text('ာ်', myanmar), text(' ကျော်', myanmar)], expectation: 'group', groups: [[0, 1]],
    note: 'ကျော် is U+1000 U+103B U+1031 U+102C U+103A. All existing detectors return [0,3,5]; the valid grapheme boundary at 3 is inside one shaping syllable. Do not position the post-base vowel/asat fragment independently.',
  },
  {
    id: 'myanmar-complete-word-and-kinzi', direction: 'ltr', lang: 'my', widths: [40, 155, 310],
    items: [text('ကျော် မြန်မာ', myanmar), text(' င်္က', myanmar)], expectation: 'independent',
    note: 'Full words keep medials, pre-base vowels, asat and kinzi together. Conservative word overflow is preferable to introducing dotted circles or moving required marks.',
  },
  {
    id: 'khmer-multiconsonant-syllables', direction: 'ltr', lang: 'km', widths: [35, 150, 300],
    items: [text('ស្រ្តី ម្សៅ', khmer), text(' ក្រ', khmer)], expectation: 'independent',
    note: 'Use whole syllables/words containing coeng stacks and dependent vowels. Current graphemes retain these sample stacks, but that is not permission to split arbitrary Khmer words for numeric widths.',
  },
  {
    id: 'khmer-split-coeng-is-invalid', direction: 'ltr', lang: 'km', widths: [35, 105, 210],
    items: [text('ក្', khmer), text('រ', khmer)], expectation: 'reject-grapheme',
    note: 'The boundary within ក្រ fails current extended-grapheme validation. A check for combining marks alone would miss this consonant after a linker.',
  },
  {
    id: 'thai-prebase-vowel-word', direction: 'ltr', lang: 'th', widths: [38, 145, 285],
    items: [text('เริ่ม น้ำ กำ', thai)], expectation: 'independent',
    note: 'Thai words need language-aware break opportunities. Preserve the pre-base vowel with the word rather than treating each valid grapheme boundary as a line break.',
  },
  {
    id: 'thai-prebase-vowel-between-items', direction: 'ltr', lang: 'th', widths: [35, 115, 220],
    items: [text('เ', thai), text('ริ่ม', thai)], expectation: 'group', groups: [[0, 1]],
    note: 'เริ่ม has grapheme boundaries [0,1,4,5]. The pre-base vowel and following consonant must not be wrapped onto separate lines solely because the item boundary is grapheme-safe. Retain a whole word until narrower boundaries are validated.',
  },
  {
    id: 'emoji-sequences-intact', direction: 'ltr', lang: 'en', widths: [32, 135, 270],
    items: [text('Hi ', latin), text('👩🏽‍💻 🇮🇳 👨‍👩‍👧‍👦', emoji), text(' done', latin)], expectation: 'independent',
    note: 'Keep modifier, ZWJ-family and paired regional-indicator sequences intact. If fitting splits the emoji item, additional painter cuts must use the same grapheme rules.',
  },
  {
    id: 'emoji-split-zwj-is-invalid', direction: 'ltr', lang: 'en', widths: [35, 100, 200],
    items: [text('👩🏽‍', emoji), text('💻', emoji)], expectation: 'reject-grapheme',
    note: 'Reject the item boundary inside one emoji ZWJ grapheme. This input is outside the user-approved API, and validation should enforce it.',
  },
  {
    id: 'emoji-split-flag-is-invalid', direction: 'ltr', lang: 'en', widths: [35, 100, 200],
    items: [text('🇮', emoji), text('🇳', emoji)], expectation: 'reject-grapheme',
    note: 'Validate regional indicators using paragraph context, not each item separately; independently segmenting each item would incorrectly accept this split flag.',
  },
  {
    id: 'combining-accent-item-boundary-is-invalid', direction: 'ltr', lang: 'en', widths: [35, 100, 200],
    items: [text('e'), text('́')], expectation: 'reject-grapheme',
    note: 'Reject at preparation using boundaries of the combined logical text. An isolated item’s own [0,length] boundaries cannot establish that its supplied start is valid.',
  },
  {
    id: 'mixed-bidi-single-item', direction: 'ltr', lang: 'en', widths: [75, 190, 360],
    items: [text('Start אבג (123) مرحبا 45 end', '22px "Arial"')], expectation: 'independent',
    note: 'A single supplied item can become several directional paint fragments. Resolve paragraph levels before wrapping; adjust trailing line whitespace and ordering per line. Parentheses mirror according to the resolved direction.',
  },
  {
    id: 'mixed-bidi-styled-item-boundaries', direction: 'rtl', lang: 'ar', widths: [85, 195, 380],
    items: [text('مرحبا ', arabic), text('(release 2.0)', latin), text(' אבג ', '22px "Arial"'), text('123، النهاية', arabic)], expectation: 'independent',
    note: 'Latin numbers, punctuation and Hebrew must keep paragraph bidi context across rich-item boundaries. Child fragments should not each guess auto direction from their isolated contents.',
  },
  {
    id: 'bidi-controls-across-items', direction: 'ltr', lang: 'en', widths: [65, 170, 320],
    items: [text('before ⁧', '22px "Arial"'), text('אבג 12', '22px "Arial"'), text('⁩ after ‪abc‬', '22px "Arial"')], expectation: 'independent',
    note: 'RLI/PDI and LRE/PDF controls deliberately cross item boundaries. They affect whole-paragraph bidi; independently positioned fragments must not apply the same embedding again. Keep original logical text for copying.',
  },
  {
    id: 'bidi-arabic-letter-mark-numbers', direction: 'rtl', lang: 'ar', widths: [70, 180, 340],
    items: [text('؜123 ', '22px "Arial"'), text('ABC ٤٥٦ (٧)', '22px "Arial"')], expectation: 'independent',
    note: 'ALM changes number resolution without ink. Test its levels and punctuation after line breaks, and do not insert new ALM merely to force script context.',
  },
  {
    id: 'atomic-in-mixed-bidi', direction: 'rtl', lang: 'ar', widths: [70, 180, 350],
    items: [text('قبل ', arabic), { kind: 'atomic', width: 57.375, height: 31, label: 'chip 12' }, text(' بعد ABC', arabic)], expectation: 'independent',
    note: 'Treat the atomic item as U+FFFC for paragraph bidi. Its fixed measured width remains exact; preserve logical DOM order even when positioned at a different visual x.',
  },
  {
    id: 'negative-spacing-and-ligatures', direction: 'ltr', lang: 'en', widths: [40, 130, 270],
    items: [text('AV office ffi', latin, -1.25), text(' XY', latin, -0.75)], expectation: 'independent',
    note: 'Measure and paint the same letter spacing. Safari Canvas optional-ligature behavior may still disagree with DOM even inside an isolated fragment; owning x positions does not erase that gap.',
  },
  {
    id: 'negative-spacing-cursive-word', direction: 'rtl', lang: 'ar', widths: [35, 125, 265],
    items: [text('السلام عليكم', arabic, -1.25)], expectation: 'independent',
    note: 'Browsers can suppress tracking in cursive scripts while Canvas applies different rules. Confirm whole-fragment agreement, including trailing spacing; preserve joining words.',
  },
  {
    id: 'font-fallback-inside-isolated-fragment', direction: 'ltr', lang: 'en', widths: [65, 180, 360],
    items: [text('ABC 漢字 مرحبا 👩🏽‍💻', '22px "Times New Roman"')], expectation: 'independent',
    note: 'Named primary font intentionally falls back for other scripts and emoji. Measurement and painting must share font list, language, direction and text; fallback is not solved merely by isolating the fragment.',
  },
  {
    id: 'mixed-font-baselines-and-overhang', direction: 'ltr', lang: 'en', widths: [85, 190, 380],
    items: [text('italic f ', 'italic 30px "Times New Roman"'), text('small ', '14px "Arial"'), text('漢字', '26px "Helvetica Neue"'), { kind: 'atomic', width: 29.125, height: 40, label: 'box' }], expectation: 'independent',
    note: 'Place fragments on a shared baseline using measured ascent/descent. Do not clip italic or fallback ink to the advance width. Atomic items need an explicit baseline choice.',
  },
  {
    id: 'fractional-items-and-spaces', direction: 'ltr', lang: 'en', widths: [71.375, 151.625, 291.875],
    items: [text('A ', '17.3px "Arial"'), { kind: 'atomic', width: 31.1375, height: 18.2, label: 'x' }, text(' V  fi ', '17.3px "Arial"', 0.15), text('done', '17.3px "Arial"')], expectation: 'independent',
    note: 'Sum unrounded advances and assign each final x once. Preserve deliberate double spaces according to the owned whitespace policy; test transforms at different zoom/DPR without rounding every predecessor.',
  },
]
