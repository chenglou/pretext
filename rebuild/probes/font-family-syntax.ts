// Font-family lists as CSS syntax (rebuild/src/font-family.ts): whether the browser's own CSS parser, for an element's
// style and for a Canvas font, reads a comma inside a string, escapes, runs of white space, U+00A0 and U+3000, keyword
// case, an empty string, and an unclosed string or a last backslash with what follows it, the way the library's one
// parser does, and rejects the lists it throws on. Every observation is a width of `mmmmiiii` at 40px beside the widths
// of reference families, so a family is known by what it draws: a list that resolves to the monospace generic measures
// as `monospace`, one that names Courier New as `"Courier New"`, a name no font has as the browser's default font does,
// and a declaration the parser rejects leaves the host's Georgia (DOM) or the context's font unset (Canvas). Returns
// `checks` (name, measured, expected, ok) and the raw rows.
//
// Which names an engine takes for its keywords is no syntax and no check here: `classification` records, per list, the
// reference it measures as. On 2026-09-19 a quoted "system-ui" drew the system UI font in Chrome 153 and webkit-host, in
// the DOM and in Canvas, and the default font in Firefox 156, while a quoted "monospace" named a family in all three
// (.artifacts/probes/font-family-syntax/). webkit-host's Canvas gives `monospace` the width of Courier New, which no check
// tells apart from it.
//
//   python3 .artifacts/session/with-browser-lock.py font-family-syntax-<browser> -- \
//     bun rebuild/probes/runner.ts --browser=<chrome|firefox|webkit-host> --probes=rebuild/probes/font-family-syntax.ts
import type { Probe } from './types.ts'

const spec = 'font-family-syntax 2026-09-19'

const SOURCE = String.raw`
const NBSP = String.fromCharCode(0xa0);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
const SAMPLE = 'mmmmiiii';
host.style.fontFamily = 'Georgia';
const span = document.createElement('span');
span.style.cssText = 'font-size: 40px; white-space: pre; position: absolute; left: 0; top: 0';
span.textContent = SAMPLE;
host.append(span);
const observe = (family) => {
  span.style.fontFamily = '';
  span.style.fontFamily = family;
  const accepted = span.style.fontFamily !== '';
  const computed = getComputedStyle(span).fontFamily;
  const dom = span.getBoundingClientRect().width;
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  const before = ctx.font;
  ctx.font = '40px ' + family;
  const canvasAccepted = ctx.font !== before;
  return { family, accepted, computed, dom, canvasAccepted, canvasFont: ctx.font, canvas: ctx.measureText(SAMPLE).width };
};
const reference = {
  monospace: observe('monospace'), courierNew: observe('"Courier New"'), systemUi: observe('system-ui'),
  noSuchFamily: observe('"Probe No Such Family"'), inherited: observe(''),
};
const rows = [];
const checks = [];
const check = (name, measured, expected) => { checks.push({ name, measured, expected, ok: measured === expected }); };
// A list the grammar takes: it must measure as the reference it names, in the DOM and in Canvas.
const takes = (name, family, as) => {
  const row = observe(family);
  rows.push({ name, ...row });
  check(name + ': the style takes it', row.accepted, true);
  check(name + ': DOM width', row.dom, reference[as].dom);
  check(name + ': Canvas takes it', row.canvasAccepted, true);
  check(name + ': Canvas width', row.canvas, reference[as].canvas);
};
// A list the grammar rejects: the style stays unset, so the host's family draws, and the context keeps its font.
const rejects = (name, family) => {
  const row = observe(family);
  rows.push({ name, ...row });
  check(name + ': the style rejects it', row.accepted, false);
  check(name + ': DOM width', row.dom, reference.inherited.dom);
  check(name + ': Canvas rejects it', row.canvasAccepted, false);
};
// What the checks rest on: every reference a list is expected to measure as differs from the one a wrong reading gives,
// the default font's for a name no font has, and in the DOM the host's family too.
const others = ['monospace', 'courierNew', 'systemUi'];
for (let i = 0; i < others.length; i++) {
  check('references differ: ' + others[i] + ' and no such family, DOM', reference[others[i]].dom !== reference.noSuchFamily.dom, true);
  check('references differ: ' + others[i] + ' and no such family, Canvas', reference[others[i]].canvas !== reference.noSuchFamily.canvas, true);
  check('references differ: ' + others[i] + ' and the inherited family, DOM', reference[others[i]].dom !== reference.inherited.dom, true);
}
check('references differ: no such family and the inherited family, DOM', reference.noSuchFamily.dom !== reference.inherited.dom, true);
// Which reference a list measures as, where that is the engine's own choice of keywords and not syntax.
const classification = [];
const classify = (name, family) => {
  const row = observe(family);
  const as = (width, key) => Object.keys(reference).filter(k => k !== 'inherited' && reference[k][key] === width);
  classification.push({ name, ...row, domAs: as(row.dom, 'dom'), canvasAs: as(row.canvas, 'canvas') });
};

takes('a comma inside a string stays in the name', '"Probe, Comma", monospace', 'monospace');
takes('a comma inside a single-quoted string', "'Probe,Comma' , monospace", 'monospace');
takes('an escape spells a generic keyword', 'm\\6fnospace', 'monospace');
takes('an escape with its closing space spells a generic keyword', 'm\\6f nospace', 'monospace');
takes('a quoted keyword names a family, not the generic', '"monospace"', 'noSuchFamily');
takes('a quoted keyword spelled with an escape names a family', '"m\\6fnospace"', 'noSuchFamily');
takes('a generic keyword in capitals', 'MONOSPACE', 'monospace');
takes('an escape spells system-ui', 'system\\-ui', 'systemUi');
takes('system-ui in mixed case', 'System-UI', 'systemUi');
classify('a quoted system-ui', '"system-ui"');
classify('a quoted monospace', '"monospace"');
classify('BlinkMacSystemFont', 'BlinkMacSystemFont');
classify('blinkmacsystemfont in small letters', 'blinkmacsystemfont');
classify('-apple-system', '-apple-system');
classify('a quoted -apple-system', '"-apple-system"');
takes('identifiers join with one space', 'Courier    New', 'courierNew');
takes('identifiers across a tab and a newline', 'Courier\t\nNew', 'courierNew');
takes('an escaped space inside a string', '"Courier\\20New"', 'courierNew');
takes('an escaped space between identifiers', 'Courier\\ New', 'courierNew');
takes('a backslash before a comma takes the comma into the name', 'Probe No Such\\, monospace', 'noSuchFamily');
takes('a family name in another case', '"courier NEW"', 'courierNew');
takes('white space around a name and its comma', '  "Courier New"  ,  monospace  ', 'courierNew');
takes('no space after the comma', '"Probe No Such Family","Courier New"', 'courierNew');
takes('U+00A0 is part of an identifier, not white space', 'Courier' + NBSP + 'New', 'noSuchFamily');
takes('U+3000 is part of an identifier, not white space', IDEOGRAPHIC_SPACE + 'Courier New', 'noSuchFamily');
takes('an unclosed string runs to the end', '"Courier New', 'courierNew');
takes('a last backslash in an unclosed string adds nothing', '"Courier New\\', 'courierNew');
takes('an unclosed string takes a comma and a generic after it into its name', '"Probe No Such, monospace', 'noSuchFamily');
takes('a last backslash after an identifier adds U+FFFD to the name', 'Courier New\\', 'noSuchFamily');
takes('an escaped quote inside a string', '"Probe \\"No\\" Such Family", monospace', 'monospace');
takes('an escaped newline inside a string adds nothing', '"Courier \\\nNew"', 'courierNew');
takes('an empty string is a family, and the next one draws', '"", monospace', 'monospace');
rejects('an empty family between commas', '"Courier New",,monospace');
rejects('a comma at the end', '"Courier New",');
rejects('an identifier after a string', '"Courier New" bold');
return { userAgent: navigator.userAgent, reference, rows, classification, checks };
`

export default [
  { id: 'font-family-syntax/lists', spec, pageLang: 'en', observe: [{ kind: 'script', source: SOURCE }] },
] satisfies Probe[]
