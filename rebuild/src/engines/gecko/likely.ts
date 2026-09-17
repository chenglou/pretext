// Whether nsLineBreaker treats a word's language as Chinese or Japanese (Firefox 156.0, nsLineBreaker.cpp:659-690).
// Gecko parses the language atom with mozilla::intl::LocaleParser::TryParse (intl/components/src/Locale.cpp:1081-1305,
// Locale.h:620-712). Without a script subtag it calls Locale::AddLikelySubtags, which hands "language[_Script][_REGION]"
// to the bundled ICU 78.3's uloc_addLikelySubtags (Locale.cpp:765-935; loclikely.cpp:134-190, 289-308;
// loclikelysubtags.cpp:521-756, 873-905) over Firefox's langInfo data (generated/likely-subtags.ts). The word is Chinese
// or Japanese when the script subtag is exactly Hans, Hant, Jpan or Hrkt (LanguageTagSubtag::EqualTo compares bytes,
// Locale.h:183-188).
import { decodeBase64 } from '../../breaks/icu4x.js'
import {
  likelyCountryCodes3, likelyLanguageAliases, likelyLanguageCodes3, likelyLsrs, likelyRegionAliases, likelyTrieBase64,
} from './generated/likely-subtags.js'

export type Lsr = { language: string; script: string; region: string }

// ---- LocaleParser (Locale.cpp:1081-1305) ----

const TOKEN_NONE = 0
const TOKEN_ALPHA = 1
const TOKEN_DIGIT = 2
const TOKEN_ERROR = 4
type Token = { kind: number; index: number; length: number }

const isAsciiAlpha = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
const isAsciiDigit = (c: number) => c >= 0x30 && c <= 0x39

type Parser = { text: string; index: number }

// LocaleParser::NextToken (Locale.cpp:1081-1104).
function nextToken(ts: Parser): Token {
  let kind = TOKEN_NONE
  let length = 0
  for (let i = ts.index; i < ts.text.length; i++) {
    const c = ts.text.charCodeAt(i)
    if (isAsciiAlpha(c)) kind |= TOKEN_ALPHA
    else if (isAsciiDigit(c)) kind |= TOKEN_DIGIT
    else if (c === 0x2d && i > ts.index && i + 1 < ts.text.length) break
    else return { kind: TOKEN_ERROR, index: 0, length: 0 }
    length++
  }
  const token = { kind, index: ts.index, length }
  ts.index += length + 1
  return token
}

// Locale.h:620-712.
const isLanguage = (t: Token) => t.kind === TOKEN_ALPHA && ((t.length >= 2 && t.length <= 3) || (t.length >= 5 && t.length <= 8))
const isScript = (t: Token) => t.kind === TOKEN_ALPHA && t.length === 4
const isRegion = (t: Token) => (t.kind === TOKEN_ALPHA && t.length === 2) || (t.kind === TOKEN_DIGIT && t.length === 3)
const isVariant = (ts: Parser, t: Token) => (t.length >= 5 && t.length <= 8) || (t.length === 4 && isAsciiDigit(ts.text.charCodeAt(t.index)))
const singletonKey = (ts: Parser, t: Token) => ts.text[t.index]!.toLowerCase()
const isExtensionStart = (ts: Parser, t: Token) => t.length === 1 && singletonKey(ts, t) !== 'x'
const isOtherExtensionPart = (t: Token) => t.length >= 2 && t.length <= 8
const isUnicodeExtensionPart = (ts: Parser, t: Token) =>
  (t.length === 2 && (isAsciiAlpha(ts.text.charCodeAt(t.index)) || isAsciiDigit(ts.text.charCodeAt(t.index))) && isAsciiAlpha(ts.text.charCodeAt(t.index + 1))) ||
  (t.length >= 3 && t.length <= 8)
const isTransformExtensionKey = (ts: Parser, t: Token) => t.length === 2 && isAsciiAlpha(ts.text.charCodeAt(t.index)) && isAsciiDigit(ts.text.charCodeAt(t.index + 1))
const isTransformExtensionPart = (t: Token) => t.length >= 3 && t.length <= 8
const isPrivateUseStart = (ts: Parser, t: Token) => t.length === 1 && singletonKey(ts, t) === 'x'
const isPrivateUsePart = (t: Token) => t.length >= 1 && t.length <= 8

// LocaleParser::TryParse (Locale.cpp:1177-1305): the language, script and region subtags as written, or null when the tag
// isn't parseable.
export function tryParseLocale(tag: string): Lsr | null {
  const ts: Parser = { text: tag, index: 0 }
  const slice = (t: Token) => tag.slice(t.index, t.index + t.length)
  let tok = nextToken(ts)
  if (!isLanguage(tok)) return null
  const out: Lsr = { language: slice(tok), script: '', region: '' }
  tok = nextToken(ts)
  if (isScript(tok)) {
    out.script = slice(tok)
    tok = nextToken(ts)
  }
  if (isRegion(tok)) {
    out.region = slice(tok)
    tok = nextToken(ts)
  }
  while (isVariant(ts, tok)) tok = nextToken(ts)
  const seenSingletons = new Set<string>()
  while (isExtensionStart(ts, tok)) {
    const singleton = singletonKey(ts, tok)
    if (seenSingletons.has(singleton)) return null
    seenSingletons.add(singleton)
    tok = nextToken(ts)
    const startValue = tok.index
    switch (singleton) {
      case 'u':
        while (isUnicodeExtensionPart(ts, tok)) tok = nextToken(ts)
        break
      case 't':
        if (isLanguage(tok)) {
          tok = nextToken(ts)
          if (isScript(tok)) tok = nextToken(ts)
          if (isRegion(tok)) tok = nextToken(ts)
          while (isVariant(ts, tok)) tok = nextToken(ts)
        }
        while (isTransformExtensionKey(ts, tok)) {
          tok = nextToken(ts)
          const startTValue = tok.index
          while (isTransformExtensionPart(tok)) tok = nextToken(ts)
          if (tok.index <= startTValue) return null
        }
        break
      default:
        while (isOtherExtensionPart(tok)) tok = nextToken(ts)
    }
    if (tok.index <= startValue) return null
  }
  if (isPrivateUseStart(ts, tok)) {
    tok = nextToken(ts)
    const startValue = tok.index
    while (isPrivateUsePart(tok)) tok = nextToken(ts)
    if (tok.index <= startValue) return null
  }
  return tok.kind === TOKEN_NONE ? out : null
}

// ---- ICU BytesTrie, next(byte) and getValue (bytestrie.cpp:25-190, bytestrie.h:95-135, 236-260, 395-547) ----

const NO_MATCH = 0
const NO_VALUE = 1
const FINAL_VALUE = 2
const INTERMEDIATE_VALUE = 3
const hasNext = (result: number) => (result & 1) !== 0

const MAX_BRANCH_LINEAR_SUB_NODE_LENGTH = 5
const MIN_LINEAR_MATCH = 0x10
const MIN_VALUE_LEAD = 0x20
const MIN_ONE_BYTE_VALUE_LEAD = 0x10
const MIN_TWO_BYTE_VALUE_LEAD = 0x51
const MIN_THREE_BYTE_VALUE_LEAD = 0x6c
const FOUR_BYTE_VALUE_LEAD = 0x7e
const MIN_TWO_BYTE_DELTA_LEAD = 0xc0
const MIN_THREE_BYTE_DELTA_LEAD = 0xf0
const FOUR_BYTE_DELTA_LEAD = 0xfe

const trie = decodeBase64(likelyTrieBase64)

// pos -1 is a stopped trie (pos_ == nullptr).
type TrieState = { pos: number; remaining: number }

function readValue(pos: number, leadByte: number): number {
  if (leadByte < MIN_TWO_BYTE_VALUE_LEAD) return leadByte - MIN_ONE_BYTE_VALUE_LEAD
  if (leadByte < MIN_THREE_BYTE_VALUE_LEAD) return ((leadByte - MIN_TWO_BYTE_VALUE_LEAD) << 8) | trie[pos]!
  if (leadByte < FOUR_BYTE_VALUE_LEAD) return ((leadByte - MIN_THREE_BYTE_VALUE_LEAD) << 16) | (trie[pos]! << 8) | trie[pos + 1]!
  if (leadByte === FOUR_BYTE_VALUE_LEAD) return (trie[pos]! << 16) | (trie[pos + 1]! << 8) | trie[pos + 2]!
  return (trie[pos]! << 24) | (trie[pos + 1]! << 16) | (trie[pos + 2]! << 8) | trie[pos + 3]!
}

function jumpByDelta(pos: number): number {
  let delta = trie[pos++]!
  if (delta < MIN_TWO_BYTE_DELTA_LEAD) {
    // one byte
  } else if (delta < MIN_THREE_BYTE_DELTA_LEAD) {
    delta = ((delta - MIN_TWO_BYTE_DELTA_LEAD) << 8) | trie[pos++]!
  } else if (delta < FOUR_BYTE_DELTA_LEAD) {
    delta = ((delta - MIN_THREE_BYTE_DELTA_LEAD) << 16) | (trie[pos]! << 8) | trie[pos + 1]!
    pos += 2
  } else if (delta === FOUR_BYTE_DELTA_LEAD) {
    delta = (trie[pos]! << 16) | (trie[pos + 1]! << 8) | trie[pos + 2]!
    pos += 3
  } else {
    delta = (trie[pos]! << 24) | (trie[pos + 1]! << 16) | (trie[pos + 2]! << 8) | trie[pos + 3]!
    pos += 4
  }
  return pos + delta
}

function skipDelta(pos: number): number {
  const delta = trie[pos++]!
  if (delta >= MIN_TWO_BYTE_DELTA_LEAD) {
    if (delta < MIN_THREE_BYTE_DELTA_LEAD) pos++
    else if (delta < FOUR_BYTE_DELTA_LEAD) pos += 2
    else pos += 3 + (delta & 1)
  }
  return pos
}

function skipValueAfterLead(pos: number, leadByte: number): number {
  if (leadByte >= MIN_TWO_BYTE_VALUE_LEAD << 1) {
    if (leadByte < MIN_THREE_BYTE_VALUE_LEAD << 1) pos++
    else if (leadByte < FOUR_BYTE_VALUE_LEAD << 1) pos += 2
    else pos += 3 + ((leadByte >> 1) & 1)
  }
  return pos
}

const skipValue = (pos: number) => skipValueAfterLead(pos + 1, trie[pos]!)
const valueResult = (node: number) => INTERMEDIATE_VALUE - (node & 1)

function stop(s: TrieState): number {
  s.pos = -1
  return NO_MATCH
}

function branchNext(s: TrieState, pos: number, length: number, inByte: number): number {
  if (length === 0) length = trie[pos++]!
  length++
  while (length > MAX_BRANCH_LINEAR_SUB_NODE_LENGTH) {
    if (inByte < trie[pos++]!) {
      length >>= 1
      pos = jumpByDelta(pos)
    } else {
      length = length - (length >> 1)
      pos = skipDelta(pos)
    }
  }
  do {
    if (inByte === trie[pos++]!) {
      let node = trie[pos]!
      let result: number
      if ((node & 1) !== 0) {
        result = FINAL_VALUE
      } else {
        pos++
        node >>= 1
        let delta: number
        if (node < MIN_TWO_BYTE_VALUE_LEAD) {
          delta = node - MIN_ONE_BYTE_VALUE_LEAD
        } else if (node < MIN_THREE_BYTE_VALUE_LEAD) {
          delta = ((node - MIN_TWO_BYTE_VALUE_LEAD) << 8) | trie[pos++]!
        } else if (node < FOUR_BYTE_VALUE_LEAD) {
          delta = ((node - MIN_THREE_BYTE_VALUE_LEAD) << 16) | (trie[pos]! << 8) | trie[pos + 1]!
          pos += 2
        } else if (node === FOUR_BYTE_VALUE_LEAD) {
          delta = (trie[pos]! << 16) | (trie[pos + 1]! << 8) | trie[pos + 2]!
          pos += 3
        } else {
          delta = (trie[pos]! << 24) | (trie[pos + 1]! << 16) | (trie[pos + 2]! << 8) | trie[pos + 3]!
          pos += 4
        }
        pos += delta
        node = trie[pos]!
        result = node >= MIN_VALUE_LEAD ? valueResult(node) : NO_VALUE
      }
      s.pos = pos
      return result
    }
    length--
    pos = skipValue(pos)
  } while (length > 1)
  if (inByte === trie[pos++]!) {
    s.pos = pos
    const node = trie[pos]!
    return node >= MIN_VALUE_LEAD ? valueResult(node) : NO_VALUE
  }
  return stop(s)
}

function nextImpl(s: TrieState, pos: number, inByte: number): number {
  for (;;) {
    const node = trie[pos++]!
    if (node < MIN_LINEAR_MATCH) return branchNext(s, pos, node, inByte)
    if (node < MIN_VALUE_LEAD) {
      let length = node - MIN_LINEAR_MATCH
      if (inByte !== trie[pos++]!) break
      s.remaining = --length
      s.pos = pos
      return length < 0 && trie[pos]! >= MIN_VALUE_LEAD ? valueResult(trie[pos]!) : NO_VALUE
    }
    if ((node & 1) !== 0) break
    pos = skipValueAfterLead(pos, node)
  }
  return stop(s)
}

function trieNextByte(s: TrieState, inByte: number): number {
  const pos = s.pos
  if (pos < 0) return NO_MATCH
  let length = s.remaining
  if (length >= 0) {
    if (inByte !== trie[pos]!) return stop(s)
    s.remaining = --length
    s.pos = pos + 1
    return length < 0 && trie[pos + 1]! >= MIN_VALUE_LEAD ? valueResult(trie[pos + 1]!) : NO_VALUE
  }
  return nextImpl(s, pos, inByte)
}

const getValue = (s: TrieState) => readValue(s.pos + 1, trie[s.pos]! >> 1)

// ---- LikelySubtags (loclikelysubtags.cpp) ----

const SKIP_SCRIPT = 1 // loclikelysubtags.h:44

// LikelySubtags::trieNext (loclikelysubtags.cpp:906-938): '*' for an empty subtag, the last character with 0x80 set.
function trieNext(s: TrieState, subtag: string): number {
  let result: number
  if (subtag.length === 0) {
    result = trieNextByte(s, 0x2a)
  } else {
    for (let i = 0; ; i++) {
      const c = subtag.charCodeAt(i)
      if (i + 1 !== subtag.length) {
        if (!hasNext(trieNextByte(s, c))) return -1
      } else {
        result = trieNextByte(s, c | 0x80)
        break
      }
    }
  }
  switch (result) {
    case NO_MATCH: return -1
    case NO_VALUE: return 0
    case INTERMEDIATE_VALUE: return SKIP_SCRIPT
    case FINAL_VALUE: return getValue(s)
    default: return -1
  }
}

const aliases = (pairs: readonly string[]): Map<string, string> => {
  const map = new Map<string, string>()
  for (let i = 0; i < pairs.length; i += 2) map.set(pairs[i]!, pairs[i + 1]!)
  return map
}
const languageAliases = aliases(likelyLanguageAliases)
const languageCodes3 = aliases(likelyLanguageCodes3)
const countryCodes3 = aliases(likelyCountryCodes3)
const regionAliases = aliases(likelyRegionAliases)
const lsrs: Lsr[] = likelyLsrs.split(';').map(entry => {
  const [language, script, region] = entry.split(' ') as [string, string, string]
  return { language, script, region }
})

// MACROREGION_HARDCODE and processMacroregionRange (loclikelysubtags.cpp:357-402).
const MACROREGION_HARDCODE = ['001~3', '005', '009', '011', '013~5', '017~9', '021', '029', '030', '034~5', '039', '053~4', '057', '061', '142~3', '145', '150~1', '154~5', '202', '419', 'EU', 'EZ', 'QO', 'UN']
const macroregions = new Set<string>()
for (let i = 0; i < MACROREGION_HARDCODE.length; i++) {
  const name = MACROREGION_HARDCODE[i]!
  const marker = name.indexOf('~')
  if (marker < 0) {
    macroregions.add(name)
    continue
  }
  const prefix = name.slice(0, marker - 1)
  for (let c = name.charCodeAt(marker - 1); c <= name.charCodeAt(marker + 1); c++) macroregions.add(prefix + String.fromCharCode(c))
}

// The LikelySubtags constructor's cached states (loclikelysubtags.cpp:494-509).
const undState: TrieState = { pos: 0, remaining: -1 }
trieNextByte(undState, 0x2a)
const undZzzzState: TrieState = { ...undState }
trieNextByte(undZzzzState, 0x2a)
const defaultLsrState: TrieState = { ...undZzzzState }
trieNextByte(defaultLsrState, 0x2a)
const defaultLsrIndex = getValue(defaultLsrState)

// LikelySubtags::maximize with returnInputIfUnmatch (loclikelysubtags.cpp:630-756); null for no match.
function maximize(inLanguage: string, inScript: string, inRegion: string): Lsr | null {
  let language = inLanguage === 'und' ? '' : inLanguage
  let script = inScript === 'Zzzz' ? '' : inScript
  let region = inRegion === 'ZZ' ? '' : inRegion
  if (script !== '' && region !== '' && language !== '') return { language, script, region }
  let retainLanguage: boolean
  let retainScript: boolean
  let retainRegion = false
  const iter: TrieState = { pos: 0, remaining: -1 }
  let state: TrieState | null
  let value = trieNext(iter, language)
  const matchLanguage = value >= 0
  if (value >= 0) {
    retainLanguage = language !== ''
    state = { ...iter }
  } else {
    retainLanguage = true
    Object.assign(iter, undState)
    state = null
  }
  const matchScript = value >= 0 && script !== ''
  if (value > 0) {
    if (value === SKIP_SCRIPT) value = 0
    retainScript = script !== ''
  } else {
    value = trieNext(iter, script)
    if (value >= 0) {
      retainScript = script !== ''
      state = { ...iter }
    } else {
      retainScript = true
      if (state === null) {
        Object.assign(iter, undZzzzState)
      } else {
        Object.assign(iter, state)
        value = trieNext(iter, '')
        state = { ...iter }
      }
    }
  }
  let matchRegion = false
  if (value > 0) {
    retainRegion = region !== ''
  } else {
    value = trieNext(iter, region)
    if (value >= 0) {
      if (region !== '' && !macroregions.has(region)) {
        retainRegion = true
        matchRegion = true
      }
    } else {
      retainRegion = true
      if (state === null) {
        value = defaultLsrIndex
      } else {
        Object.assign(iter, state)
        value = trieNext(iter, '')
        if (value < 0) {
          // und_Latn: fall back to und_$region, then und.
          retainLanguage = language !== ''
          retainScript = script !== ''
          retainRegion = region !== ''
          Object.assign(iter, undState)
          value = trieNext(iter, '')
          const undEmptyState = { ...iter }
          value = trieNext(iter, region)
          if (value < 0) {
            Object.assign(iter, undEmptyState)
            value = trieNext(iter, '')
          }
        }
      }
    }
  }
  if (!(matchLanguage || matchScript || (matchRegion && language === ''))) return null
  if (language === '') language = 'und'
  const matched = lsrs[value]!
  if (!(retainLanguage || retainScript || retainRegion)) return matched
  if (!retainLanguage) language = matched.language
  if (!retainScript) script = matched.script
  if (!retainRegion) region = matched.region
  return { language, script, region }
}

// uloc_addLikelySubtags over an ICU locale ID of these subtags (loclikely.cpp:134-190, 289-308). ulocimp_getSubtags
// lowercases the language, reads "und" as the empty language and turns a 3-letter code with an ISO 639-1 equivalent into
// it; titlecases the script; uppercases the region and turns a 3-letter code into its 2-letter equivalent
// (uloc.cpp:1219-1343). LikelySubtags::makeMaximizedLsr maps aliases (loclikelysubtags.cpp:559-606), and no match returns
// the input (makeMaximizedLsrFrom, :521-550). An empty language comes back as "und" in Firefox (Locale.cpp:846-878).
export function addLikelySubtags(language: string, script: string, region: string): Lsr {
  let l = language.toLowerCase()
  if (l === 'und') l = ''
  if (l.length === 3) l = languageCodes3.get(l) ?? l
  const s = script === '' ? '' : script[0]!.toUpperCase() + script.slice(1).toLowerCase()
  let r = region.toUpperCase()
  if (r.length === 3) r = countryCodes3.get(r) ?? r
  const max = maximize(languageAliases.get(l) ?? l, s, regionAliases.get(r) ?? r)
  if (max === null) return { language: l, script: s, region: r }
  return max
}

// The style language Gecko gives an element's lang attribute: MapLangAttributeInto records the canonical tag when the
// attribute parses and canonicalizes (nsGenericHTMLElement.cpp:1360-1370, Locale::Canonicalize). The port canonicalizes
// case: the language lowercase, the script titlecase, the region uppercase and every later subtag lowercase (UTS 35 §3.2.1,
// Locale::CanonicalizeBaseName). The alias mappings of LocaleGenerated.cpp and the ordering of extensions aren't ported.
export function canonicalLanguageTag(tag: string): string {
  const parsed = tryParseLocale(tag)
  if (parsed === null) return tag
  const parts = tag.split('-')
  let i = 1
  const out = [parsed.language.toLowerCase()]
  if (parsed.script !== '') {
    out.push(parsed.script[0]!.toUpperCase() + parsed.script.slice(1).toLowerCase())
    i++
  }
  if (parsed.region !== '') {
    out.push(parsed.region.toUpperCase())
    i++
  }
  for (; i < parts.length; i++) out.push(parts[i]!.toLowerCase())
  return out.join('-')
}

// nsLineBreaker::UpdateCurrentWordLanguage (nsLineBreaker.cpp:674-686): null when the language doesn't parse.
export function scriptIsChineseOrJapanese(tag: string): boolean | null {
  const parsed = tryParseLocale(tag)
  if (parsed === null) return null
  const script = parsed.script !== '' ? parsed.script : addLikelySubtags(parsed.language, '', parsed.region).script
  return script === 'Hans' || script === 'Hant' || script === 'Jpan' || script === 'Hrkt'
}
