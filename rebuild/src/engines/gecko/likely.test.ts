// The likely-subtags port against ICU 78.3's own uloc_addLikelySubtags, Firefox 156's bundled ICU version: Homebrew
// icu4c@78 is upstream 78.3 (tools/icu-bidi-oracle.ts). The oracle builds the locale ID the way Firefox's
// CreateLocaleForLikelySubtags does (intl/components/src/Locale.cpp:782-808) and prints the maximized subtags.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addLikelySubtags, canonicalLanguageTag, scriptIsChineseOrJapanese, tryParseLocale } from './likely.js'

const ICU4C_78 = '/opt/homebrew/opt/icu4c@78'
const ORACLE_C = `#include <stdio.h>
#include <string.h>
#include <unicode/uloc.h>
#include <unicode/uversion.h>
int main(int argc, char **argv) {
  if (argc > 1) { printf("%s\\n", U_ICU_VERSION); return 0; }
  char line[256];
  while (fgets(line, sizeof line, stdin)) {
    line[strcspn(line, "\\n")] = 0;
    char id[64] = "", out[128], l[32], s[32], r[32];
    char *language = strtok(line, "\\t"), *script = strtok(NULL, "\\t"), *region = strtok(NULL, "\\t");
    strcpy(id, language);
    if (script && strcmp(script, "-") != 0) { strcat(id, "_"); strcat(id, script); }
    if (region && strcmp(region, "-") != 0) { strcat(id, "_"); strcat(id, region); }
    UErrorCode status = U_ZERO_ERROR;
    uloc_addLikelySubtags(id, out, sizeof out, &status);
    uloc_getLanguage(out, l, sizeof l, &status);
    uloc_getScript(out, s, sizeof s, &status);
    uloc_getCountry(out, r, sizeof r, &status);
    printf("%s\\t%s\\t%s\\t%s\\n", U_SUCCESS(status) ? "ok" : u_errorName(status), l, s, r);
  }
  return 0;
}
`

function buildOracle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gecko-likely-oracle-'))
  writeFileSync(join(dir, 'likely.c'), ORACLE_C)
  const binary = join(dir, 'likely')
  const result = Bun.spawnSync(['clang', '-std=c11', '-O2', join(dir, 'likely.c'), `-I${ICU4C_78}/include`, `-L${ICU4C_78}/lib`, '-licuuc', '-licudata', '-o', binary])
  if (result.exitCode !== 0) throw new Error(`building the ICU likely-subtags oracle failed:\n${result.stderr.toString()}`)
  return binary
}

const letters = 'abcdefghijklmnopqrstuvwxyz'
const REGIONS = ['', 'TW', 'HK', 'MO', 'CN', 'SG', 'JP', 'KR', 'US', 'DE', 'RU', 'IN', 'BR', 'ZZ', 'XA', '001', '150', '419', '142', '143', 'AQ', 'QO', 'EU', 'UN', 'EZ', 'YU', 'ZR', 'DD', '172', '200']

describe('likely subtags against ICU 78.3', () => {
  test('every 2- and 3-letter language and und, with regions and scripts', () => {
    const binary = buildOracle()
    expect(Bun.spawnSync([binary, 'version']).stdout.toString().trim()).toBe('78.3')
    const inputs: Array<[string, string, string]> = []
    const languages = ['und']
    for (let a = 0; a < 26; a++) for (let b = 0; b < 26; b++) {
      languages.push(letters[a]! + letters[b]!)
      for (let c = 0; c < 26; c++) languages.push(letters[a]! + letters[b]! + letters[c]!)
    }
    for (let i = 0; i < languages.length; i++) for (let k = 0; k < REGIONS.length; k++) inputs.push([languages[i]!, '', REGIONS[k]!])
    for (let a = 0; a < 26; a++) for (let b = 0; b < 26; b++) inputs.push(['und', '', (letters[a]! + letters[b]!).toUpperCase()])
    for (let n = 0; n < 1000; n++) inputs.push(['und', '', String(n).padStart(3, '0')])
    const scripted = ['und', 'zh', 'ja', 'en', 'sr', 'yue', 'ko', 'xyz', 'ar']
    const scripts = ['Hans', 'Hant', 'Latn', 'Cyrl', 'Jpan', 'Hrkt', 'Zzzz', 'Qaaa', 'Arab']
    for (let i = 0; i < scripted.length; i++) for (let s = 0; s < scripts.length; s++) for (let k = 0; k < REGIONS.length; k++) inputs.push([scripted[i]!, scripts[s]!, REGIONS[k]!])
    const stdin = inputs.map(([l, s, r]) => `${l}\t${s === '' ? '-' : s}\t${r === '' ? '-' : r}`).join('\n') + '\n'
    const lines = Bun.spawnSync([binary], { stdin: Buffer.from(stdin) }).stdout.toString().split('\n')
    let compared = 0
    let cj = 0
    const failures: string[] = []
    for (let i = 0; i < inputs.length; i++) {
      const [status, language, script, region] = lines[i]!.split('\t') as [string, string, string, string]
      expect(status).toBe('ok')
      const port = addLikelySubtags(...inputs[i]!)
      const portLanguage = port.language === 'und' ? '' : port.language
      compared++
      if (script === 'Hans' || script === 'Hant' || script === 'Jpan' || script === 'Hrkt') cj++
      if ((portLanguage !== language || port.script !== script || port.region !== region) && failures.length < 10) {
        failures.push(`${inputs[i]!.join('_')}: icu ${language}_${script}_${region}, port ${portLanguage}_${port.script}_${port.region}`)
      }
    }
    console.log(JSON.stringify({ compared, chineseOrJapanese: cj }))
    expect(failures).toEqual([])
    expect(compared).toBe(inputs.length)
    // Builds the ICU oracle and compares 551,696 inputs: about 3 s alone, more than bun's 5 s default on a loaded machine.
  }, 120_000)
})

describe('nsLineBreaker language test', () => {
  test('tags gecko-oracle-replay §4.1 names', () => {
    for (const tag of ['yue', 'wuu', 'und-TW', 'cmn', 'hak', 'nan', 'gan', 'lzh', 'und-HK', 'und-JP', 'zh', 'ja', 'zh-Hans', 'zh-Hant', 'zh-CN']) {
      expect([tag, scriptIsChineseOrJapanese(tag)]).toEqual([tag, true])
    }
    for (const tag of ['en', 'ko', 'ja-Latn', 'zh-Latn', 'ar', 'he', 'th', 'hi', 'my', 'ur', 'km', 'mul', 'xyz-TW']) {
      expect([tag, scriptIsChineseOrJapanese(tag)]).toEqual([tag, false])
    }
  })
  test('LocaleParser::TryParse (Locale.cpp:1081-1305)', () => {
    expect(tryParseLocale('')).toBeNull()
    expect(tryParseLocale('en_US')).toBeNull()
    expect(tryParseLocale('en-')).toBeNull()
    expect(tryParseLocale('abcd')).toBeNull()
    expect(tryParseLocale('x-private')).toBeNull()
    expect(tryParseLocale('en-a-b')).toBeNull()
    expect(tryParseLocale('en-u-nu-latn-u-ca-gregory')).toBeNull()
    expect(tryParseLocale('zh-Hant-TW-u-nu-hanidec-x-foo')).toEqual({ language: 'zh', script: 'Hant', region: 'TW' })
    expect(tryParseLocale('sl-rozaj-biske-1994')).toEqual({ language: 'sl', script: '', region: '' })
  })
  test('the style language is the tag in canonical case (nsGenericHTMLElement.cpp:1360-1370)', () => {
    expect(canonicalLanguageTag('ZH-hans-tw')).toBe('zh-Hans-TW')
    expect(scriptIsChineseOrJapanese('zh-hans')).toBe(false)
    expect(scriptIsChineseOrJapanese(canonicalLanguageTag('zh-hans'))).toBe(true)
    expect(canonicalLanguageTag('en_US')).toBe('en_US')
  })
})
