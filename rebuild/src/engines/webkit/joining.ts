// Cursive joining at a box edge, for text shaped across inline boxes (lines.ts applyShapingOnRunRange). Core Text shapes the
// joined text as one run, and which letters join in a run is the Unicode Standard's: a letter's Joining_Type says whether it
// joins the letter after it (Dual_Joining, Left_Joining, Join_Causing) and the letter before it (Dual_Joining, Right_Joining,
// Join_Causing), and Transparent characters, marks among them, are skipped (The Unicode Standard 17.0 §9.2, ArabicShaping.txt;
// OpenType fonts get their init, medi and fina forms by these types, and AAT fonts encode them in their own tables).
import { webkitJoiningTypeRanges } from './generated/joining.js'

// Flat [first, last, type] triples in code point order; type is the letter's char code.
let ranges: number[] | null = null

function decodeRanges(): number[] {
  const out: number[] = []
  const pattern = /([0-9a-z]+)\.([0-9a-z]+)([CDLRT])/g
  let end = -1
  for (let match = pattern.exec(webkitJoiningTypeRanges); match !== null; match = pattern.exec(webkitJoiningTypeRanges)) {
    const first = end + 1 + parseInt(match[1]!, 36)
    end = first + parseInt(match[2]!, 36)
    out.push(first, end, match[3]!.charCodeAt(0))
  }
  return out
}

// 'C', 'D', 'L', 'R', 'T', or 'U' for Non_Joining.
export function joiningType(cp: number): string {
  ranges ??= decodeRanges()
  let low = 0
  let high = ranges.length / 3 - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (cp < ranges[3 * middle]!) high = middle - 1
    else if (cp > ranges[3 * middle + 1]!) low = middle + 1
    else return String.fromCharCode(ranges[3 * middle + 2]!)
  }
  return 'U'
}

// Whether the last letter of `before` and the first letter of `after` join when the two texts are shaped as one run.
export function joinsAcross(before: string, after: string): boolean {
  let left = 'T'
  for (let i = before.length; i > 0 && left === 'T';) {
    i -= i > 1 && (before.charCodeAt(i - 1) & 0xfc00) === 0xdc00 && (before.charCodeAt(i - 2) & 0xfc00) === 0xd800 ? 2 : 1
    left = joiningType(before.codePointAt(i)!)
  }
  let right = 'T'
  for (let i = 0; i < after.length && right === 'T';) {
    const cp = after.codePointAt(i)!
    right = joiningType(cp)
    i += cp > 0xffff ? 2 : 1
  }
  return (left === 'D' || left === 'L' || left === 'C') && (right === 'D' || right === 'R' || right === 'C')
}
