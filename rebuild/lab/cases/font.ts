// Strict CSS font shorthand parsing for case import. Only the forms the lab can represent in a FontDecl
// are accepted: `[normal|italic] [normal|bold|<number>] <size>px <family list>` in any order before the
// size. Anything else (oblique, small-caps, stretch keywords, relative weights, other units, a line
// height inside the shorthand, unterminated strings, escapes) throws.

import type { FontDecl } from '../types.ts'

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'emoji', 'fangsong',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
])
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'])
const SIZE = /^(?:\d+(?:\.\d+)?|\.\d+)px$/
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/
const IDENT = /^-?[A-Za-z_-\u{10FFFF}][A-Za-z0-9_\--\u{10FFFF}]*$/u

export type FamilyName = { name: string; generic: boolean }

export function parseFontFamilyList(list: string): FamilyName[] {
  const fail = (why: string): never => {
    throw new Error(`Cannot parse font family list ${JSON.stringify(list)}: ${why}`)
  }
  const names: FamilyName[] = []
  let i = 0
  const skipSpace = (): void => {
    while (i < list.length && /\s/.test(list[i]!)) i++
  }
  for (;;) {
    skipSpace()
    if (i >= list.length) fail('expected a family name')
    const quote = list[i]!
    if (quote === '"' || quote === "'") {
      const end = list.indexOf(quote, i + 1)
      if (end === -1) fail('unterminated string')
      const name = list.slice(i + 1, end)
      if (name.includes('\\')) fail('escapes in family names are unsupported')
      if (/[\n\r\f]/.test(name)) fail('newline inside a quoted family name')
      if (name.trim() === '') fail('empty quoted family name')
      names.push({ name, generic: false })
      i = end + 1
    } else {
      let end = i
      while (end < list.length && list[end] !== ',') end++
      const raw = list.slice(i, end).trim()
      i = end
      if (raw === '') fail('empty family name')
      const words = raw.split(/\s+/)
      for (const word of words) {
        if (!IDENT.test(word)) fail(`${JSON.stringify(word)} is not an unquoted identifier`)
        if (CSS_WIDE_KEYWORDS.has(word.toLowerCase())) fail(`${JSON.stringify(word)} is reserved`)
      }
      const single = words.length === 1 ? words[0]!.toLowerCase() : null
      if (single !== null && GENERIC_FAMILIES.has(single)) names.push({ name: single, generic: true })
      else names.push({ name: words.join(' '), generic: false })
    }
    skipSpace()
    if (i >= list.length) break
    if (list[i] !== ',') fail(`unexpected ${JSON.stringify(list[i])}`)
    i++
  }
  return names
}

// Generic keywords stay unquoted; a one-identifier name that is not a keyword stays unquoted; every
// other name is double-quoted. Equivalent spellings ('Times New Roman' and "Times New Roman", "Arial"
// and Arial) therefore serialize identically, which keeps case ids stable across spellings.
export function formatFontFamilyList(names: readonly FamilyName[]): string {
  if (names.length === 0) throw new Error('A font family list needs at least one name')
  const out: string[] = []
  for (const { name, generic } of names) {
    if (generic) {
      if (!GENERIC_FAMILIES.has(name)) throw new Error(`${JSON.stringify(name)} is not a generic family`)
      out.push(name)
      continue
    }
    const lower = name.toLowerCase()
    if (!/\s/.test(name) && IDENT.test(name) && !GENERIC_FAMILIES.has(lower) && !CSS_WIDE_KEYWORDS.has(lower)) {
      out.push(name)
      continue
    }
    if (name.includes('"') || name.includes('\\')) throw new Error(`Cannot serialize family name ${JSON.stringify(name)}`)
    out.push(`"${name}"`)
  }
  return out.join(', ')
}

export function canonicalFontFamily(list: string): string {
  return formatFontFamilyList(parseFontFamilyList(list))
}

export function parseFontShorthand(css: string): FontDecl {
  const fail = (why: string): never => {
    throw new Error(`Cannot parse font shorthand ${JSON.stringify(css)}: ${why}`)
  }
  let rest = css.trim()
  let style: FontDecl['style'] | null = null
  let weight: number | null = null
  let normals = 0
  let size = 0
  for (;;) {
    const match = /^(\S+)(?:\s+|$)/.exec(rest)
    if (match === null) return fail('missing font size')
    const token = match[1]!
    rest = rest.slice(match[0].length)
    if (SIZE.test(token)) {
      size = Number(token.slice(0, -2))
      break
    }
    if (token.includes('/')) fail('a line height inside the font shorthand is unsupported')
    if (token.includes('"') || token.includes("'") || token.includes(',')) fail('missing font size before the family list')
    const lower = token.toLowerCase()
    if (lower === 'normal') {
      if (++normals > 4) fail('too many normal keywords')
    } else if (lower === 'italic') {
      if (style !== null) fail('font-style given twice')
      style = 'italic'
    } else if (lower === 'bold') {
      if (weight !== null) fail('font-weight given twice')
      weight = 700
    } else if (NUMBER.test(token)) {
      if (weight !== null) fail('font-weight given twice')
      const value = Number(token)
      if (value < 1 || value > 1000) fail(`font-weight ${token} is out of range`)
      weight = value
    } else {
      fail(`unsupported token ${JSON.stringify(token)}`)
    }
  }
  if (!(size > 0) || !Number.isFinite(size)) fail('font size must be positive')
  if (/^\//.test(rest)) fail('a line height inside the font shorthand is unsupported')
  if (rest.trim() === '') fail('missing font family')
  return { family: canonicalFontFamily(rest), size, weight: weight ?? 400, style: style ?? 'normal' }
}

export function formatFontShorthand(font: FontDecl): string {
  return `${font.style === 'italic' ? 'italic ' : ''}${font.weight} ${font.size}px ${font.family}`
}
