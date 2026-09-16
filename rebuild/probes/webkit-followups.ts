// Follow-up probes from the WebKit port's lab runs (rebuild/specs/webkit-RESULTS.md): spec claims the rows contradict or
// can't settle. Plain observations; the verdicts are written by hand from the recorded rects.
//
// Run under the browser lock (from ~/github/pretext-rebuild):
//   python3 .artifacts/session/with-browser-lock.py probes-webkit-followups -- bun rebuild/probes/runner.ts \
//     --browser=webkit-host --probes=rebuild/probes/webkit-followups.ts --out=.artifacts/probes/webkit/followups
import type { Probe } from './types.ts'

const TEXT = 'aبِبِ((tail'

export default async function followupProbes(): Promise<Probe[]> {
  return [
    {
      // suite/original-vs-reshaped-admission (c-17af0e41879fc51f and six more widths, .artifacts/lab/webkit/suite-r1-part*):
      // native lines are a | بِ | بِ | (( | t | a | il, and line 2's display box is 2.232px, W("بِبِ") − W("بِ"). That is the
      // carried rest of an item that ends at offset 5. The port's items are [0,1) [1,7) [7,11): "((" resolves to level 1
      // like the Arabic before it (N2), no break opportunity exists at 5 (LB30), and the line-start prohibition of
      // InlineContentBreaker.cpp:139-158 keeps "((" with "بِ", so it predicts a | بِ | بِ(( | t | a | il.
      id: 'webkit-followups F1 (Amiri)',
      spec: 'webkit-lines §7.1 firstCharacterBreakRespectingLineStartProhibitions; webkit-text §6 item splits',
      pageLang: 'en',
      fontFixtures: ['Amiri'],
      html: `<div id="t" dir="rtl" style="font:24px Amiri; width:15.5px; white-space:pre-wrap; overflow-wrap:break-word; line-height:48px">${TEXT}</div>`,
      canvas: [
        { kind: 'offscreen', context: 'a', font: '24px Amiri', text: 'بِ' },
        { kind: 'offscreen', context: 'a', text: 'بِبِ' },
        { kind: 'offscreen', context: 'a', text: 'بِبِ((' },
        { kind: 'offscreen', context: 'a', text: '((' },
        { kind: 'offscreen', context: 'a', text: 'بِ((' },
      ],
      observe: ['lines', 'rangeWidth', 'canvasWidths'],
      note: 'Expected from the rows: 7 lines, line 2 holds offsets 3-4 only. If so, find what splits the item at 5 (bidi levels, a break opportunity, or the carried width).',
    },
    {
      // Same text in Arial at a width where "بِ" alone overflows. The rows of c-8b2085f124bbb6f1 ("بِبِ((tail", 8px) keep
      // the rest "بِ((" together with the carried width 14.562px, as the port predicts.
      id: 'webkit-followups F1 (Arial)',
      spec: 'webkit-lines §7.1; webkit-text §6',
      pageLang: 'en',
      html: `<div id="t" dir="rtl" style="font:16px Arial; width:8px; white-space:pre-wrap; overflow-wrap:break-word; line-height:48px">${TEXT}</div>`,
      observe: ['lines', 'rangeWidth'],
      note: 'Control: expected a | بِ | بِ(( | t | a | il if the Amiri split depends on the font.',
    },
    {
      // Amiri with Arabic after the parentheses: no bidi level change around "((", so a split at 5 here can't come from
      // setBidiLevelOnRange.
      id: 'webkit-followups F1 (Amiri, Arabic after)',
      spec: 'webkit-lines §7.1; webkit-text §6',
      pageLang: 'en',
      fontFixtures: ['Amiri'],
      html: '<div id="t" dir="rtl" style="font:24px Amiri; width:15.5px; white-space:pre-wrap; overflow-wrap:break-word; line-height:48px">aبِبِ((بب</div>',
      observe: ['lines', 'rangeWidth'],
    },
  ]
}
