// A CSS font-family list as the families it names. The list is CSS syntax, the same in every engine: commas outside strings
// separate the families, a family is a string or a sequence of identifiers, and escapes are resolved before anything reads
// a name (CSS Fonts 4 §4.2: `<family-name> = <string> | <custom-ident>+`, the identifiers "joined by single spaces"; CSS
// Syntax §4.3.5 for strings, §4.3.7 for escapes, §4.2 for white space). What differs per engine is which unquoted names are
// its generic families and system font keywords, and how it compares names: each port classifies the names itself
// (engines/blink/content.ts styleOf, engines/webkit/fonts.ts familyNames, engines/gecko/fonts.ts parseFamilyList), and the
// font checks read the same list (measure/font-checks.ts primaryFamily).
//
// CssFont.family stays the string the page sets: Canvas and the painter are given it as it is, so the list is read from it
// where a name is needed and kept nowhere.
//
// The scan is the one the Gecko port had, after Servo's SingleFontFamily::parse
// (servo/components/style/values/computed/font.rs:707-768). It reads what a page can set and checks little else: it throws on
// a list with an empty family or with anything but a comma after a string, which CSS rejects whole, and doesn't check that
// an unquoted name is made of identifiers. It doesn't read comments, and CR LF counts as two white space characters.

// One family of the list. `css` is the family as the list writes it, for a list Canvas is given again.
export type ListedFamily =
  // A string: the name is its value. It names a family of that name, never a keyword (CSS Fonts 4 §4.2).
  | { quoted: true; name: string; css: string }
  // Identifiers: the name is them joined by single spaces. `identifiers` keeps them apart, since an escape can put a space
  // inside one.
  | { quoted: false; name: string; css: string; identifiers: string[] }

// CSS white space: space, tab and the newlines, which are LF, CR and FF (CSS Syntax §4.2, §3.3). U+00A0 isn't one.
function isWhiteSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
}

// One CSS escape at text[i] === '\\' (CSS Syntax §4.3.7): the code point and where parsing continues.
function escape(text: string, i: number): { value: string; next: number } {
  let hex = ''
  let k = i + 1
  while (k < text.length && hex.length < 6 && /[0-9a-fA-F]/.test(text[k]!)) hex += text[k++]
  if (hex.length > 0) {
    if (isWhiteSpace(text[k])) k++
    const cp = parseInt(hex, 16)
    return { value: cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp), next: k }
  }
  return { value: k < text.length ? text[k]! : '�', next: k + 1 }
}

export function listedFamilies(list: string): ListedFamily[] {
  const out: ListedFamily[] = []
  let i = 0
  for (;;) {
    while (isWhiteSpace(list[i])) i++
    const start = i
    const quote = list[i]
    let family: ListedFamily
    if (quote === '"' || quote === "'") {
      let name = ''
      i++
      while (i < list.length && list[i] !== quote) {
        if (list[i] !== '\\') {
          name += list[i++]
        } else if (i + 1 === list.length || list[i + 1] === '\n' || list[i + 1] === '\r' || list[i + 1] === '\f') {
          // An escaped newline continues the string on the next line, and a backslash at the end adds nothing (§4.3.5).
          i += 2
        } else {
          const e = escape(list, i)
          name += e.value
          i = e.next
        }
      }
      i++
      family = { quoted: true, name, css: list.slice(start, i) }
      while (isWhiteSpace(list[i])) i++
    } else {
      const identifiers: string[] = []
      let end = i
      for (;;) {
        while (isWhiteSpace(list[i])) i++
        if (i >= list.length || list[i] === ',') break
        let identifier = ''
        while (i < list.length && !isWhiteSpace(list[i]) && list[i] !== ',') {
          if (list[i] === '\\') {
            const e = escape(list, i)
            identifier += e.value
            i = e.next
          } else {
            identifier += list[i++]
          }
        }
        identifiers.push(identifier)
        end = i
      }
      family = { quoted: false, name: identifiers.join(' '), css: list.slice(start, end), identifiers }
    }
    if (family.css === '' || (i < list.length && list[i] !== ',')) throw new Error(`font-family ${JSON.stringify(list)} isn't a list of family names`)
    out.push(family)
    if (i >= list.length) return out
    i++ // ','
  }
}
