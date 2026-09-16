// Reader for ICU's preparsed Unicode Character Database (ppucd.txt), the property source ICU 78 builds its data
// from. Engine generators use it for Bidi_Class, paired brackets, Line_Break, General_Category and the like.
//
// Line kinds (ICU tools/unicode/py/preparseucd.py output):
//   defaults;0000..10FFFF;props   property values for code points no other line changes
//   block;first..last;props       the most common values in a block
//   cp;first[..last];props        assigned code points: the block's values overlaid with these
//   unassigned;first[..last];props unassigned code points: the defaults overlaid with these
// A prop is `name=value`, a binary `Name` (true) or `-Name` (false).
import { forEachLine } from './lines.ts'

export type PpucdProps = Map<string, string>
export type PpucdRange = { first: number; last: number; props: PpucdProps }

// Chromium ICU 78.2 (third_party/icu d578f2e8, the Chrome 152 pin; the Chrome 153 pin 8cc91d9b differs only by an
// nfkc_scf data filter), Unicode 17.0.0.
export const PPUCD_PATH = 'chromium-152/src/third_party/icu/source/data/unidata/ppucd.txt'
export const PPUCD_SHA256 = 'bccc5a5ca1baea3de767e8266d59ffa13ff99595bea37ca82415851386f57dbd'

function parseRange(field: string): [number, number] {
  const dots = field.indexOf('..')
  if (dots < 0) {
    const cp = parseInt(field, 16)
    return [cp, cp]
  }
  return [parseInt(field.slice(0, dots), 16), parseInt(field.slice(dots + 2), 16)]
}

function overlay(base: PpucdProps, fields: string[]): PpucdProps {
  const props = new Map(base)
  for (let i = 2; i < fields.length; i++) {
    const field = fields[i]!
    const eq = field.indexOf('=')
    if (eq >= 0) props.set(field.slice(0, eq), field.slice(eq + 1))
    else if (field.startsWith('-')) props.delete(field.slice(1))
    else props.set(field, '')
  }
  return props
}

// Calls `visit` for every cp and unassigned range, in file order, with resolved props.
export async function forEachPpucdRange(path: string, visit: (range: PpucdRange) => void): Promise<void> {
  let defaults: PpucdProps = new Map()
  let block: PpucdProps = new Map()
  let blockLast = -1
  await forEachLine(path, line => {
    if (line.length === 0 || line.startsWith('#')) return
    const fields = line.split(';')
    switch (fields[0]) {
      case 'defaults':
        defaults = overlay(new Map(), fields)
        return
      case 'block': {
        const [, last] = parseRange(fields[1]!)
        block = overlay(defaults, fields)
        blockLast = last
        return
      }
      case 'cp': {
        const [first, last] = parseRange(fields[1]!)
        if (last > blockLast) throw new Error(`cp line outside its block: ${line}`)
        visit({ first, last, props: overlay(block, fields) })
        return
      }
      case 'unassigned': {
        const [first, last] = parseRange(fields[1]!)
        visit({ first, last, props: overlay(defaults, fields) })
        return
      }
      default:
        return
    }
  })
}
