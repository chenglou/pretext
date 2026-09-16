// ScriptRunIterator against Chrome 153's own unit tests over ICU data (platform/fonts/script_run_iterator_test.cc,
// ScriptRunIteratorTest cases that use ICUScriptData; the mock-data cases need a mock table and aren't ported).
import { describe, expect, test } from 'bun:test'
import { scriptRuns } from './script.js'

const COMMON = 0, ARABIC = 2, BENGALI = 4, BOPOMOFO = 5, HAN = 17, HANGUL = 18, HIRAGANA = 20, LATIN = 25, MALAYALAM = 26,
  SYRIAC = 34

function check(runs: [string, number][]): void {
  let text = ''
  const expected: number[] = []
  for (let i = 0; i < runs.length; i++) {
    text += runs[i]![0]
    expected.push(text.length, runs[i]![1])
  }
  expect(scriptRuns(text)).toEqual(expected)
}

describe('ScriptRunIterator (script_run_iterator_test.cc)', () => {
  test('Empty', () => expect(scriptRuns('')).toEqual([]))
  test('Whitespace', () => check([[' \t ', COMMON]]))
  test('Common', () => check([[' ... !?', COMMON]]))
  // U_ICU_VERSION_MAJOR_NUM >= 76.
  test('CombiningCircle', () => check([['◌́◌̀◌̈◌̂◌̄◌̊', LATIN]]))
  test('Latin', () => check([['latin', LATIN]]))
  test('Chinese', () => check([['萬國碼', HAN]]))
  test('JapaneseMixedScript', () => {
    const data: [string, number][] = [['あ', HIRAGANA], ['ア', HIRAGANA], ['ー', HIRAGANA], ['〼', HAN], ['〃', BOPOMOFO], ['、', BOPOMOFO]]
    for (let i = 0; i < data.length; i++) {
      const [s, script] = data[i]!
      check([[s, script]])
      check([['か' + s, HIRAGANA]])
      check([[s + 'か', HIRAGANA]])
      check([['カ' + s, HIRAGANA]])
      check([[s + 'カ', HIRAGANA]])
      check([['か' + s + 'カ', HIRAGANA]])
      check([['カ' + s + 'か', HIRAGANA]])
    }
  })
  test('UnbalancedParens1', () => check([['(萬', HAN], ['a]', LATIN], [')', HAN]]))
  test('UnbalancedParens2', () => check([['(萬', HAN], ['a[', LATIN], [')]', HAN]]))
  test('LatinHan', () => check([['Unicode ', LATIN], ['萬國碼', HAN]]))
  test('HanLatin', () => check([['萬國碼 ', HAN], ['Unicode', LATIN]]))
  test('ParenEmptyParen', () => check([['()', COMMON]]))
  test('ParenChineseParen', () => check([['(萬國碼)', HAN]]))
  test('ParenLatinParen', () => check([['(Unicode)', LATIN]]))
  test('LatinParenChineseParen', () => check([['Unicode (', LATIN], ['萬國碼', HAN], [')', LATIN]]))
  test('ParenChineseParenLatin', () => check([['(萬國碼) ', HAN], ['Unicode', LATIN]]))
  test('QuoteParenChineseParenLatinQuote', () => check([['"(萬國碼) ', HAN], ['Unicode"', LATIN]]))
  test('CJKConsecutiveParens1', () => check([['「あ', HIRAGANA], ['国。」', HAN]]))
  test('CJKConsecutiveParens2', () => check([['あ「あ', HIRAGANA], ['国（国）」', HAN]]))
  test('CJKConsecutiveParens3', () => check([['国「国', HAN], ['ア（', HIRAGANA], ['A', LATIN], ['）」', HIRAGANA]]))
  test('CJKConsecutiveParens4', () => check([['A', LATIN], ['「', BOPOMOFO], ['A', LATIN], ['あ（', HIRAGANA], ['国）」', HAN]]))
  test('CJKConsecutiveParens5', () => check([['「あ', HIRAGANA], ['国', HAN], ['A', LATIN], ['」', HIRAGANA]]))
  test('CJKConsecutiveParens6', () => check([['A', LATIN], ['「', BOPOMOFO], ['A', LATIN], ['あ（', HIRAGANA], ['国）', HAN], ['A', LATIN], ['」', BOPOMOFO]]))
  test('CJKConsecutiveParens7', () => check([['「あ', HIRAGANA], ['国1」', HAN]]))
  test('CJKConsecutiveParens8', () => check([['A', LATIN], ['「', BOPOMOFO], ['A', LATIN], ['あ（', HIRAGANA], ['国）1」', HAN]]))
  test('CJKConsecutiveParens9', () => check([['「あ', HIRAGANA], ['国', HAN], ['A1', LATIN], ['」', HIRAGANA]]))
  test('CJKConsecutiveParens10', () => check([['A', LATIN], ['「', BOPOMOFO], ['A', LATIN], ['あ（', HIRAGANA], ['国）', HAN], ['A1', LATIN], ['」', BOPOMOFO]]))
  test('CJKConsecutiveParensLatin1', () => check([['「', BOPOMOFO], ['A', LATIN], ['「', BOPOMOFO], ['A', LATIN], ['」」', BOPOMOFO]]))
  test('CJKConsecutiveParensLatin2', () => check([['「', BOPOMOFO], ['A', LATIN], ['（', BOPOMOFO], ['A', LATIN], ['）」', BOPOMOFO]]))
  test('CJKConsecutiveParensLatin3', () => check([['「', BOPOMOFO], ['A', LATIN], ['（国）」', HAN]]))
  test('EmojiCommon', () => check([['百家姓🌱🌲🌳🌴', HAN]]))
  test('UnmatchedClose', () => check([['Unicode (', LATIN], ['萬國碼] ', HAN], [') Unicode"', LATIN]]))
  test('Match32Brackets', () => check([['[萬國碼 ', HAN], ['Unicode (((((((((((((((((((((((((((((((!)))))))))))))))))))))))))))))))', LATIN], [']', HAN]]))
  test('Match32MostRecentBrackets', () => check([
    ['((([萬國碼 ', HAN], ['Unicode (((((((((((((((((((((((((((((((', LATIN], ['萬國碼!', HAN], [')))))))))))))))))))))))))))))))', LATIN], [']', HAN],
    ['But )))', LATIN],
  ]))
  test('LatinDottedCircleUdatta', () => check([['Latin ◌॑', LATIN]]))
  test('HanDottedCircleUdatta', () => check([['萬國碼 ', HAN], ['◌॑', BENGALI]]))
  test('LatinTatweelFathatan', () => check([['Latin ', LATIN], ['ـً', ARABIC]]))
  test('SyriacTatweelFathatan', () => check([['ܢـً', SYRIAC]]))
  test('HanUdatta', () => check([['萬國碼॑', HAN]]))
  test('HanSpaceUdatta', () => check([['萬國碼', HAN], [' ॑', BENGALI]]))
  test('Hangul', () => check([['키스의 고유조건은', HANGUL]]))
  test('HiraganaMixedPunctuation', () => check([['いろはに.…¡ほへと', HIRAGANA]]))
  test('LeadingInheritedHan', () => check([['॑萬國碼', HAN]]))
  test('LeadingInheritedHan2', () => check([['ً॑萬國碼', HAN]]))
  test('OddLatinString', () => check([['ç̈', LATIN]]))
  test('CommonMalayalam', () => check([['100-ാം', MALAYALAM]]))
  test('IdeographicCommaDoesNotCountAsLatin', () => check([['也：', HAN], ['ABC', LATIN], ['、', BOPOMOFO], ['DEF', LATIN]]))
})
