export const FONT_FAMILY = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'
export const FONT_SIZE = 17
export const LINE_HEIGHT = 28
export const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`
export const PADDING = 16

export const DEMO_TEXT =
  '排字师记录道：「禁则换行先看行首，再看行尾。」' +
  '他翻开《排版指南》第三章，找到〈标点规则〉一节。' +
  '书中写道："行首禁止出现句号。或逗号，以及顿号、' +
  '感叹号！问号？分号；冒号：等标点。"' +
  '全角括号（如这样）与〔龟甲括号〕也有讲究。' +
  '日文引号「单引」与『双引』不可拆开，' +
  '黑括号【注释】和白括号〖标记〗同理。' +
  '花括号〘测试〙与方括号〚数据〛也遵守此规则。' +
  '此外，中点・用于分隔，长音符ー延长发音，' +
  '重复符々々表示叠字，竖排符〻亦然。' +
  '平假名迭代ゝゞ与片假名迭代ヽヾ是日文特有标记。' +
  '全角句点．和全角逗号，在某些风格中也常出现。' +
  '右尖括号〉与右双尖括号》同为行首禁止。' +
  '最后确认：左括号（、左〔、左〈、左《、左「、左『、' +
  '左【、左〖、左〘、左〚均不可出现在行尾……以上就是全部规则。'

// --- i18n ---

export type Lang = 'en' | 'zh'
export type I18n = { en: string; zh: string }

export const UI: Record<Lang, {
  title: string
  intro: string
  rulesTitle: string
  rulesDescription: string
}> = {
  en: {
    title: 'CJK Line Breaking',
    intro: 'CJK kinsoku rules prevent punctuation from appearing at invalid line positions. Adjust the width to watch Pretext enforce these rules at every line break.',
    rulesTitle: 'Kinsoku Rules Reference',
    rulesDescription: 'Characters listed below are enforced by Pretext during line breaking. Click any entry to highlight it in the preview above.',
  },
  zh: {
    title: 'CJK 禁则换行',
    intro: 'CJK 禁则处理（kinsoku）确保标点不会出现在错误的行首或行尾。调整宽度观察 Pretext 如何在每次换行时执行这些规则。',
    rulesTitle: '禁则规则速查',
    rulesDescription: '以下列出的字符由 Pretext 在换行时强制执行。点击任意条目可在上方预览中高亮显示。',
  },
}

// --- Rule definitions ---

export type RuleGroupEntry = {
  char: string
  unicode: string
  name: I18n
}

export type RuleGroup = {
  title: I18n
  description: I18n
  entries: RuleGroupEntry[]
}

export const RULE_GROUPS: RuleGroup[] = [
  {
    title: { en: 'Line-start prohibited', zh: '行首禁则' },
    description: {
      en: 'These characters must not appear at the start of a line. When a break falls just before one, the engine pulls it back to the end of the previous line.',
      zh: '这些字符不能出现在行首。当换行点恰好落在这些字符之前时，引擎会将它们吸附到上一行末尾。',
    },
    entries: [
      { char: '\uFF0C', unicode: 'FF0C', name: { en: 'Fullwidth comma', zh: '全角逗号' } },
      { char: '\uFF0E', unicode: 'FF0E', name: { en: 'Fullwidth full stop', zh: '全角句点' } },
      { char: '\uFF01', unicode: 'FF01', name: { en: 'Fullwidth exclamation', zh: '全角感叹号' } },
      { char: '\uFF1A', unicode: 'FF1A', name: { en: 'Fullwidth colon', zh: '全角冒号' } },
      { char: '\uFF1B', unicode: 'FF1B', name: { en: 'Fullwidth semicolon', zh: '全角分号' } },
      { char: '\uFF1F', unicode: 'FF1F', name: { en: 'Fullwidth question mark', zh: '全角问号' } },
      { char: '\u3001', unicode: '3001', name: { en: 'Ideographic comma', zh: '顿号' } },
      { char: '\u3002', unicode: '3002', name: { en: 'Ideographic full stop', zh: '句号' } },
      { char: '\u30FB', unicode: '30FB', name: { en: 'Katakana middle dot', zh: '中点' } },
      { char: '\uFF09', unicode: 'FF09', name: { en: 'Fullwidth right paren', zh: '全角右括号' } },
      { char: '\u3015', unicode: '3015', name: { en: 'Right tortoise bracket', zh: '右龟甲括号' } },
      { char: '\u3009', unicode: '3009', name: { en: 'Right angle bracket', zh: '右尖括号' } },
      { char: '\u300B', unicode: '300B', name: { en: 'Right double angle bracket', zh: '右书名号' } },
      { char: '\u300D', unicode: '300D', name: { en: 'Right corner bracket', zh: '右单引号' } },
      { char: '\u300F', unicode: '300F', name: { en: 'Right white corner bracket', zh: '右双引号' } },
      { char: '\u3011', unicode: '3011', name: { en: 'Right black lenticular bracket', zh: '右黑括号' } },
      { char: '\u3017', unicode: '3017', name: { en: 'Right white lenticular bracket', zh: '右白括号' } },
      { char: '\u3019', unicode: '3019', name: { en: 'Right white tortoise bracket', zh: '右花括号' } },
      { char: '\u301B', unicode: '301B', name: { en: 'Right white square bracket', zh: '右方括号' } },
      { char: '\u30FC', unicode: '30FC', name: { en: 'Katakana prolonged sound', zh: '长音符' } },
      { char: '\u3005', unicode: '3005', name: { en: 'Ideographic iteration mark', zh: '汉字重复符' } },
      { char: '\u303B', unicode: '303B', name: { en: 'Vertical ideographic iteration', zh: '竖排重复符' } },
      { char: '\u309D', unicode: '309D', name: { en: 'Hiragana iteration mark', zh: '平假名迭代符' } },
      { char: '\u309E', unicode: '309E', name: { en: 'Hiragana voiced iteration', zh: '平假名浊迭代符' } },
      { char: '\u30FD', unicode: '30FD', name: { en: 'Katakana iteration mark', zh: '片假名迭代符' } },
      { char: '\u30FE', unicode: '30FE', name: { en: 'Katakana voiced iteration', zh: '片假名浊迭代符' } },
    ],
  },
  {
    title: { en: 'Line-end prohibited', zh: '行尾禁则' },
    description: {
      en: 'These characters must not appear at the end of a line. When a break falls just after one, the engine pushes it to the start of the next line.',
      zh: '这些字符不能出现在行尾。当换行点恰好落在这些字符之后时，引擎会将它们推到下一行开头。',
    },
    entries: [
      { char: '\uFF08', unicode: 'FF08', name: { en: 'Fullwidth left paren', zh: '全角左括号' } },
      { char: '\u3014', unicode: '3014', name: { en: 'Left tortoise bracket', zh: '左龟甲括号' } },
      { char: '\u3008', unicode: '3008', name: { en: 'Left angle bracket', zh: '左尖括号' } },
      { char: '\u300A', unicode: '300A', name: { en: 'Left double angle bracket', zh: '左书名号' } },
      { char: '\u300C', unicode: '300C', name: { en: 'Left corner bracket', zh: '左单引号' } },
      { char: '\u300E', unicode: '300E', name: { en: 'Left white corner bracket', zh: '左双引号' } },
      { char: '\u3010', unicode: '3010', name: { en: 'Left black lenticular bracket', zh: '左黑括号' } },
      { char: '\u3016', unicode: '3016', name: { en: 'Left white lenticular bracket', zh: '左白括号' } },
      { char: '\u3018', unicode: '3018', name: { en: 'Left white tortoise bracket', zh: '左花括号' } },
      { char: '\u301A', unicode: '301A', name: { en: 'Left white square bracket', zh: '左方括号' } },
    ],
  },
  {
    title: { en: 'Left-sticky punctuation', zh: '左粘连标点' },
    description: {
      en: 'These marks stick to the preceding character and will not be broken onto the next line alone. Overlaps with line-start rules but applies in broader contexts.',
      zh: '这些标点紧跟前面的文字，不会被单独断到下一行。与行首禁则有部分重叠，但作用于更广泛的上下文。',
    },
    entries: [
      { char: '\u3002', unicode: '3002', name: { en: 'Ideographic full stop', zh: '句号' } },
      { char: '\u3001', unicode: '3001', name: { en: 'Ideographic comma', zh: '顿号' } },
      { char: '\u2026', unicode: '2026', name: { en: 'Horizontal ellipsis', zh: '省略号' } },
    ],
  },
]
