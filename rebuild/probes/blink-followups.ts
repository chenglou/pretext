// Follow-up probes from the Blink port's lab runs (rebuild/specs/blink-RESULTS.md): spec claims the rows contradict or
// can't settle. Plain observations; the verdicts are written by hand from the recorded rects.
//
// Run under the browser lock (from ~/github/pretext-rebuild):
//   bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/blink-followups.ts \
//     --out=.artifacts/probes/blink/followups --probe-timeout-ms=60000
import type { Probe } from './types.ts'

export default async function followupProbes(): Promise<Probe[]> {
  return [
    {
      // specs/blink-gaps.md §3.2 lists Arabic joining as unsafe_to_break; specs/painter.md §3.1 a says joining marks only
      // unsafe_to_concat, so a break inside a joined word keeps the paragraph's joined forms. The lab rows split by font
      // type: Amiri (OpenType) kept joined forms at breaks (c-f73e825e2a1758dd), Geeza Pro (AAT, morx) reshaped isolated
      // forms (c-a6803706e450767e, c-0dd1d404ea812dbc).
      id: 'blink-followups F1 (Amiri)',
      spec: 'blink-gaps §3.2 vs painter.md §3.1 a',
      pageLang: 'en',
      fontFixtures: ['Amiri'],
      html: '<div id="t" lang="ar" dir="rtl" style="font:24px Amiri; width:1px; overflow-wrap:anywhere; line-height:40px">بببب</div>',
      observe: ['lines', 'rangeWidth'],
      note: 'Expected (painter.md): each one-letter line has the width of the joined form (initial, medial, medial, final), not the isolated form.',
    },
    {
      id: 'blink-followups F1 (Geeza Pro)',
      spec: 'blink-gaps §3.2 vs painter.md §3.1 a',
      pageLang: 'en',
      html: '<div id="t" lang="ar" dir="rtl" style="font:24px &quot;Geeza Pro&quot;; width:1px; overflow-wrap:anywhere; line-height:40px">لللل</div>',
      observe: ['lines', 'rangeWidth'],
      note: 'Expected from the lab rows: isolated-form widths, because HarfBuzz marks AAT transitions unsafe and the reshape sees no context.',
    },
    {
      // shaping_line_breaker.cc:344-378 (LineBreakerHanKerningEnd): a close mark that doesn't fit at full width is
      // reshaped with han_kerning_end. The lab saw 》 alone on a line at 10px in 20px PingFang SC (c-3e4c81707a37c51f),
      // while the painted line of the same text was 20px.
      id: 'blink-followups F2',
      spec: 'blink-lines §6 step 4',
      pageLang: 'en',
      html: '<div id="t" lang="zh-Hans" style="font:20px &quot;PingFang SC&quot;; width:1px; line-height:32px">《书名》：标</div>',
      observe: ['lines'],
      note: 'Expected: the line holding 》 is 10px wide; 《 at a wrapped line start stays 20px (is_line_start keeps its start untrimmed).',
    },
    {
      // In RTL lines that end at a chosen soft hyphen, Chrome reports the SHY's Range rect with zero width, so the lab
      // can't mark the width unobserved (c-0167f0e244838f3b: native 4.40625px, predicted 9.5625px with the hyphen).
      // Does Blink draw a hyphen there at all?
      id: 'blink-followups F3',
      spec: 'blink-lines §11',
      pageLang: 'en',
      fontFixtures: ['Noto Naskh Arabic'],
      html: '<div id="t" style="font:16px &quot;Noto Naskh Arabic&quot;; white-space:pre-wrap; width:10.48px; line-height:48px">ب­ب</div>',
      observe: ['lines', 'rangeWidth', { kind: 'script', source: 'const r = element.getBoundingClientRect(); return { scrollWidth: element.scrollWidth, width: r.width, height: r.height }' }],
      note: 'Expected if a hyphen is drawn: line 1 extends about 5.16px beyond the initial-form letter (the hyphen fragment), visible in a screenshot or in scrollWidth.',
    },
    {
      // Font::TabWidth uses SimpleFontData::SpaceWidth, the float advance; Canvas measureText gives the advance truncated
      // to 16.16. The lab's c-87e013cf240ecbdc ended 1/128px wider natively than the prediction from the truncated width.
      id: 'blink-followups F4',
      spec: 'blink-lines §12',
      pageLang: 'en',
      html: '<div id="t" style="white-space:pre; font:16px &quot;Helvetica Neue&quot;; line-height:24px"><span style="font:20px Verdana">sharply.</span>\t \t<span style="font:12px Verdana">the first ones</span>\t \t<span style="font:16px Verdana">parents</span></div>',
      observe: ['rangeWidth', { kind: 'boxWidth', selectors: ['span'] }],
      note: 'Expected: span lefts follow tab stops computed from the untruncated space advance (8 x 0.278em at the zoomed size).',
    },
  ]
}
