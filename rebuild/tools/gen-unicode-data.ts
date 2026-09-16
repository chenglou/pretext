// Generates src/unicode/generated/bidi-data.ts: Bidi_Class and paired brackets for the engines' bidi resolvers.
// usage: bun rebuild/tools/gen-unicode-data.ts
//
// - Unicode 17 Bidi_Class and Bidi_Paired_Bracket from ICU 78.2's ppucd.txt, which Chrome 153's ICU 78.2 carries.
// - macOS 27 libicucore (ICU 78.1, Safari 27) reports the same except for Apple's own classes of private-use characters
//   in U+F7F0..U+F8FF, recorded below (APPLE_PRIVATE_USE_BIDI_CLASSES). Its other property differences from upstream
//   are in data/webkit/icu-macos27-libicucore/unicode-properties-vs-upstream78.3.diff, which doesn't cover Bidi_Class.
//   src/unicode/bidi.test.ts compares both tables with u_charDirection from Homebrew icu4c 78.3 and from the system
//   libicucore for every code point.
// - unicode-bidi 0.3.15's own bracket table (Unicode 15.0.0, src/char_data/tables.rs:519), which Firefox 156's
//   unicode-bidi-ffi uses for rule N0 while it takes Bidi_Class from icu_properties 2.1.2 (Unicode 17) through
//   CodePointMapData (intl/bidi/rust/unicode-bidi-ffi/src/lib.rs:43-45). The copy read here is the groundwork's vendored
//   crate at git rev ca612daf; its tables.rs has the same sha256 as `git show FIREFOX_156_0_RELEASE:third_party/rust/
//   unicode-bidi/src/char_data/tables.rs`.
import { resolve } from 'node:path'
import { BROWSER_ENGINES, REBUILD, readVerified, writeModule } from './gen-shared.ts'
import { PPUCD_PATH, PPUCD_SHA256, forEachPpucdRange } from './ppucd.ts'

const UNICODE_BIDI_TABLES = 'pretext-emulation-20260915/oracle/gecko/validation/vendor/unicode-bidi-ca612daf1c08c53abe07327cb3e6ef6e0a760f0c/src/char_data/tables.rs'
const UNICODE_BIDI_TABLES_SHA256 = '8adf126131f573a3b6d2c35849c1cc13c831c9b55c4d3fcb5a3961d8ed7a0d44'

// ICU4C UCharDirection numbering (unicode/uchar.h), which src/unicode/bidi.ts uses.
const CLASS_NUMBERS: Record<string, number> = {
  L: 0, R: 1, EN: 2, ES: 3, ET: 4, AN: 5, CS: 6, B: 7, S: 8, WS: 9, ON: 10, LRE: 11, LRO: 12, AL: 13, RLE: 14, RLO: 15,
  PDF: 16, NSM: 17, BN: 18, FSI: 19, LRI: 20, RLI: 21, PDI: 22,
}

// u_charDirection of macOS 27.0's /usr/lib/libicucore (ICU 78.1) where it differs from ICU 78.3, dumped with
// `tools/icu-bidi-oracle.c classes`: [first, last, class name]. Upstream gives all of these L (private use).
const APPLE_PRIVATE_USE_BIDI_CLASSES: readonly [number, number, string][] = [
  [0xf7f0, 0xf86f, 'ON'], [0xf870, 0xf87f, 'NSM'], [0xf882, 0xf882, 'AL'], [0xf883, 0xf883, 'R'], [0xf884, 0xf899, 'NSM'],
  [0xf89a, 0xf89e, 'R'], [0xf89f, 0xf89f, 'NSM'], [0xf8a0, 0xf8a0, 'ET'], [0xf8a1, 0xf8a1, 'EN'], [0xf8ad, 0xf8b1, 'ON'],
  [0xf8b4, 0xf8b7, 'ON'], [0xf8b9, 0xf8c0, 'ON'], [0xf8d7, 0xf8ff, 'ON'],
]

const ppucdPath = resolve(BROWSER_ENGINES, PPUCD_PATH)
readVerified(ppucdPath, PPUCD_SHA256)

const classes = new Uint8Array(0x110000)
const brackets: number[] = []
await forEachPpucdRange(ppucdPath, range => {
  const bc = range.props.get('bc')
  if (bc === undefined) throw new Error(`no bc for ${range.first.toString(16)}`)
  const cls = CLASS_NUMBERS[bc]
  if (cls === undefined) throw new Error(`unknown bc=${bc}`)
  classes.fill(cls, range.first, range.last + 1)
  if (range.props.get('bpt') === 'o') {
    const bpb = range.props.get('bpb')
    if (bpb === undefined || range.first !== range.last) throw new Error(`opening bracket range ${range.first.toString(16)}`)
    // BD16 compares canonical equivalents: U+2329 and U+232A match U+3008 and U+3009 (their singleton decompositions).
    const dm = range.props.get('dm')
    const canonical = dm !== undefined && range.props.get('dt') === 'Can' && !dm.includes(' ') ? parseInt(dm, 16) : 0
    brackets.push(range.first, parseInt(bpb, 16), canonical)
  }
})

const appleClasses = classes.slice()
for (let i = 0; i < APPLE_PRIVATE_USE_BIDI_CLASSES.length; i++) {
  const [first, last, name] = APPLE_PRIVATE_USE_BIDI_CLASSES[i]!
  appleClasses.fill(CLASS_NUMBERS[name]!, first, last + 1)
}

// Flat [start - previous end - 1, end - start, class] triples for every run of one class other than L.
function encodeClassRanges(table: Uint8Array): number[] {
  const out: number[] = []
  let previousEnd = -1
  for (let cp = 0; cp < table.length;) {
    const cls = table[cp]!
    let end = cp
    while (end + 1 < table.length && table[end + 1] === cls) end++
    if (cls !== 0) {
      out.push(cp - previousEnd - 1, end - cp, cls)
      previousEnd = end
    }
    cp = end + 1
  }
  return out
}

const tables = new TextDecoder().decode(readVerified(resolve(BROWSER_ENGINES, UNICODE_BIDI_TABLES), UNICODE_BIDI_TABLES_SHA256))
if (!tables.includes('pub const UNICODE_VERSION: (u64, u64, u64) = (15, 0, 0);')) throw new Error('expected unicode-bidi tables for Unicode 15.0.0')
const pairsSource = tables.slice(tables.indexOf('pub const bidi_pairs_table'))
const pairsBody = pairsSource.slice(0, pairsSource.indexOf('];'))
const crateBrackets: number[] = []
// Entries wrap across lines in the source, so separators match any white space.
for (const m of pairsBody.matchAll(/\('\\u\{([0-9a-f]+)\}',\s*'\\u\{([0-9a-f]+)\}',\s*(?:None|Some\('\\u\{([0-9a-f]+)\}'\))\)/g)) {
  crateBrackets.push(parseInt(m[1]!, 16), parseInt(m[2]!, 16), m[3] === undefined ? 0 : parseInt(m[3], 16))
}

writeModule(resolve(REBUILD, 'src/unicode/generated/bidi-data.ts'), `// Generated by rebuild/tools/gen-unicode-data.ts. Do not edit.
// Sources: ICU 78.2 ppucd.txt (Unicode 17.0.0, sha256 ${PPUCD_SHA256}); macOS 27 libicucore's private-use classes;
// unicode-bidi 0.3.15 (git ca612daf) src/char_data/tables.rs (Unicode 15.0.0, sha256 ${UNICODE_BIDI_TABLES_SHA256}).

// Bidi_Class other than L, as flat [start - previous end - 1, end - start, class] triples, ICU4C numbering.
export const unicode17BidiClassRanges: readonly number[] = ${JSON.stringify(encodeClassRanges(classes))}

// The same for macOS 27 libicucore: Unicode 17 with Apple's classes for U+F7F0..U+F8FF.
export const libicucoreBidiClassRanges: readonly number[] = ${JSON.stringify(encodeClassRanges(appleClasses))}

// Bidi_Paired_Bracket_Type=Open code points: [opening, closing, canonical opening or 0], ascending.
export const unicode17BracketPairs: readonly number[] = ${JSON.stringify(brackets)}

// unicode-bidi 0.3.15 bidi_pairs_table: [opening, closing, canonical opening or 0].
export const unicodeBidi15BracketPairs: readonly number[] = ${JSON.stringify(crateBrackets)}
`)
