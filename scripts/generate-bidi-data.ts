import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type GeneratedBidiPayload = {
  unicodeVersion: string
  latin1Types: GeneratedBidiType[]
  nonLatin1Ranges: Array<[number, number, GeneratedBidiType]>
  pairedBrackets: number[]
}

const GENERATED_TYPES = [
  'L',
  'R',
  'AL',
  'AN',
  'EN',
  'ES',
  'ET',
  'CS',
  'ON',
  'BN',
  'B',
  'S',
  'WS',
  'NSM',
] as const

type GeneratedBidiType = (typeof GENERATED_TYPES)[number]

const generatedTypeToCode = new Map<GeneratedBidiType, number>()
for (let i = 0; i < GENERATED_TYPES.length; i++) {
  generatedTypeToCode.set(GENERATED_TYPES[i]!, i)
}

const longBidiNames = new Map<string, GeneratedBidiType>([
  ['Left_To_Right', 'L'],
  ['Right_To_Left', 'R'],
  ['Arabic_Letter', 'AL'],
  ['Arabic_Number', 'AN'],
  ['European_Number', 'EN'],
  ['European_Separator', 'ES'],
  ['European_Terminator', 'ET'],
  ['Common_Separator', 'CS'],
  ['Other_Neutral', 'ON'],
  ['Boundary_Neutral', 'BN'],
  ['Paragraph_Separator', 'B'],
  ['Segment_Separator', 'S'],
  ['White_Space', 'WS'],
  ['Nonspacing_Mark', 'NSM'],
])

const bnProjectedTypes = new Set([
  'LRE',
  'LRO',
  'RLE',
  'RLO',
  'PDF',
  'LRI',
  'RLI',
  'FSI',
  'PDI',
])

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`
}

function parseCodePointRange(raw: string): { start: number, end: number } {
  const [startRaw, endRaw] = raw.split('..')
  const start = Number.parseInt(startRaw!, 16)
  const end = endRaw === undefined ? start : Number.parseInt(endRaw, 16)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new Error(`Invalid code point range: ${raw}`)
  }
  return { start, end }
}

function simplifyBidiType(raw: string): GeneratedBidiType {
  if (generatedTypeToCode.has(raw as GeneratedBidiType)) return raw as GeneratedBidiType
  if (bnProjectedTypes.has(raw)) return 'BN'

  const longName = longBidiNames.get(raw)
  if (longName !== undefined) return longName

  throw new Error(`Unsupported bidi class ${raw}`)
}

function buildPayload(sourceText: string, bracketsText: string): GeneratedBidiPayload {
  const sourceLines = sourceText.split(/\r?\n/)
  const versionLine = sourceLines.find(line => line.startsWith('# DerivedBidiClass-'))
  const versionMatch = versionLine?.match(/^# DerivedBidiClass-(.+)\.txt$/)
  if (versionMatch === null || versionMatch === undefined) {
    throw new Error('Could not determine Unicode version from DerivedBidiClass header')
  }
  const unicodeVersion = versionMatch[1]!

  const bidiCodes = new Uint8Array(0x110000)
  bidiCodes.fill(generatedTypeToCode.get('L')!)

  for (let i = 0; i < sourceLines.length; i++) {
    const rawLine = sourceLines[i]!
    let rangeText: string | null = null
    let typeText: string | null = null

    if (rawLine.startsWith('# @missing:')) {
      const missingMatch = rawLine.match(/^# @missing:\s*([0-9A-Fa-f]+(?:\.\.[0-9A-Fa-f]+)?)\s*;\s*([A-Za-z_]+)/)
      if (missingMatch === null) continue
      rangeText = missingMatch[1]!
      typeText = missingMatch[2]!
    } else {
      const line = rawLine.split('#', 1)[0]!.trim()
      if (line.length === 0) continue
      const entryMatch = line.match(/^([0-9A-Fa-f]+(?:\.\.[0-9A-Fa-f]+)?)\s*;\s*([A-Za-z_]+)/)
      if (entryMatch === null) continue
      rangeText = entryMatch[1]!
      typeText = entryMatch[2]!
    }

    const { start, end } = parseCodePointRange(rangeText)
    const bidiType = simplifyBidiType(typeText)
    const bidiCode = generatedTypeToCode.get(bidiType)!
    for (let cp = start; cp <= end; cp++) {
      bidiCodes[cp] = bidiCode
    }
  }

  const latin1Types: GeneratedBidiType[] = []
  for (let cp = 0; cp <= 0xFF; cp++) {
    latin1Types.push(GENERATED_TYPES[bidiCodes[cp]!]!)
  }

  const nonLatin1Ranges: Array<[number, number, GeneratedBidiType]> = []
  const leftToRightCode = generatedTypeToCode.get('L')!
  let currentStart = -1
  let currentCode = -1
  for (let cp = 0x100; cp < bidiCodes.length; cp++) {
    const code = bidiCodes[cp]!
    if (code === leftToRightCode) {
      if (currentStart >= 0) {
        nonLatin1Ranges.push([currentStart, cp - 1, GENERATED_TYPES[currentCode]!])
        currentStart = -1
        currentCode = -1
      }
      continue
    }

    if (currentStart < 0) {
      currentStart = cp
      currentCode = code
      continue
    }

    if (code !== currentCode) {
      nonLatin1Ranges.push([currentStart, cp - 1, GENERATED_TYPES[currentCode]!])
      currentStart = cp
      currentCode = code
    }
  }
  if (currentStart >= 0) {
    nonLatin1Ranges.push([
      currentStart,
      bidiCodes.length - 1,
      GENERATED_TYPES[currentCode]!,
    ])
  }

  const bracketLines = bracketsText.split(/\r?\n/)
  const bracketVersionLine = bracketLines.find(line => line.startsWith('# BidiBrackets-'))
  const bracketVersionMatch = bracketVersionLine?.match(/^# BidiBrackets-(.+)\.txt$/)
  if (bracketVersionMatch?.[1] !== unicodeVersion) {
    throw new Error('BidiBrackets version does not match DerivedBidiClass')
  }

  const pairedBrackets: number[] = []
  const otherNeutralCode = generatedTypeToCode.get('ON')!
  for (let i = 0; i < bracketLines.length; i++) {
    const line = bracketLines[i]!.split('#', 1)[0]!.trim()
    if (line.length === 0) continue
    const entryMatch = line.match(/^([0-9A-Fa-f]+)\s*;\s*[0-9A-Fa-f]+\s*;\s*([oc])$/)
    if (entryMatch === null) throw new Error(`Unexpected BidiBrackets entry: ${line}`)
    const codePoint = Number.parseInt(entryMatch[1]!, 16)
    // Unicode stability policy: every paired bracket has class ON.
    if (bidiCodes[codePoint] !== otherNeutralCode) {
      throw new Error(`Paired bracket ${formatHex(codePoint)} is not ON`)
    }
    pairedBrackets.push(codePoint)
  }
  pairedBrackets.sort((a, b) => a - b)

  return {
    unicodeVersion,
    latin1Types,
    nonLatin1Ranges,
    pairedBrackets,
  }
}

function buildSource(payload: GeneratedBidiPayload, sourceLabel: string): string {
  const latin1Rows = payload.latin1Types.map(type => `  '${type}'`).join(',\n')
  const rangeRows = payload.nonLatin1Ranges
    .map(([start, end, type]) => `  [${formatHex(start)}, ${formatHex(end)}, '${type}']`)
    .join(',\n')
  const bracketRows = payload.pairedBrackets
    .map(codePoint => `  ${formatHex(codePoint)}`)
    .join(',\n')

  return `// Generated by scripts/generate-bidi-data.ts from ${sourceLabel}.
// Do not edit by hand. Regenerate with \`bun run generate:bidi-data\`.
// Formatting and isolate controls are projected onto \`BN\` because the rich
// bidi helper consumes a simplified class set and does not model UBA isolates.

export type GeneratedBidiType =
  | 'L'
  | 'R'
  | 'AL'
  | 'AN'
  | 'EN'
  | 'ES'
  | 'ET'
  | 'CS'
  | 'ON'
  | 'BN'
  | 'B'
  | 'S'
  | 'WS'
  | 'NSM'

export const latin1BidiTypes: readonly GeneratedBidiType[] = [
${latin1Rows},
]

export const nonLatin1BidiRanges: readonly (readonly [number, number, GeneratedBidiType])[] = [
${rangeRows},
]

// Code points whose Bidi_Paired_Bracket_Type is Open or Close, sorted. All of
// them have class \`ON\`.
export const bidiPairedBrackets: readonly number[] = [
${bracketRows},
]
`
}

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const sourceFile = join(scriptsDir, 'unicode', 'DerivedBidiClass-17.0.0.txt')
const bracketsFile = join(scriptsDir, 'unicode', 'BidiBrackets-17.0.0.txt')
const generatedDir = join(scriptsDir, '..', 'src', 'generated')
const outputPath = join(generatedDir, 'bidi-data.ts')

const sourceText = readFileSync(sourceFile, 'utf8')
const payload = buildPayload(sourceText, readFileSync(bracketsFile, 'utf8'))
const nextSource = buildSource(
  payload,
  'scripts/unicode/DerivedBidiClass-17.0.0.txt\n// and scripts/unicode/BidiBrackets-17.0.0.txt',
)

if (process.argv.includes('--check')) {
  const currentSource = readFileSync(outputPath, 'utf8')
  if (currentSource !== nextSource) {
    throw new Error(`Generated bidi data is stale: ${outputPath}`)
  }
  console.log(`Generated bidi data is up to date (${payload.unicodeVersion}).`)
} else {
  mkdirSync(generatedDir, { recursive: true })
  await Bun.write(outputPath, nextSource)
  console.log(`Wrote ${outputPath} (${payload.unicodeVersion}).`)
}
