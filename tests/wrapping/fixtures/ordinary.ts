import type { RetainedInput } from './retained.ts'

type Control = {
  families?: string[]
  texts?: string[]
  fonts?: string[]
  widths?: number[]
  whiteSpace?: RetainedInput['whiteSpace'][]
  wordBreak?: RetainedInput['wordBreak'][]
  letterSpacing?: number[]
  directions?: RetainedInput['direction'][]
}
type Behavior = {
  name: string
  reason: string
  // These paths name already-selected reproductions, never an entire discovery matrix.
  evidence?: string[]
  controls?: Control[]
}

// Curation follows the behavior, its exact witness, neighboring controls and
// dimensions implicated by that witness. Full still runs every finite source
// recipe. No current candidate result, ID ordering or per-family quota selects
// ordinary inputs.
export const retainedBehaviors: Behavior[] = [
  {
    name: 'original-policy',
    reason: 'All 122 nominated original-family inputs retain their exact browser-captured thresholds; ordinary hyphen and numeric controls are also generated in cases.ts.',
    evidence: ['runs/api-admission-v1-retained/inputs.json', 'runs/integration-retained-chrome-v3/inputs.json', 'runs/integration-retained-firefox-v1/inputs.json'],
  },
  {
    name: 'historical-allocation',
    reason: 'The specifically identified Safari 162 and Firefox 16 regressions are exact witnesses, including their original font, spacing, source and width.',
    evidence: ['runs/api-source7-historical162-v1/inputs.json', 'runs/measurement-reserve-historical16-firefox-v2/inputs.json'],
  },
  {
    name: 'restart-source-rights',
    reason: 'Preserve the individually isolated lost successes for source ends, restart admission, signed prefixes, zero rights and canceled visible glyphs.',
    evidence: ['api/control-restart-end-v1/amiri-ltr-main-loss-inputs.json', 'api/control-restart-only-v2/small-loss-inputs.json',
      'api/control-source-views-v1/loss-inputs.json', 'api/spaced-prefix-rights-v2/small-loss-inputs.json',
      'api/spaced-prefix-v1/small-loss-inputs.json', 'api/spacing-semantics/inputs.json', 'api/zero-rights-v1/loss-inputs.json'],
  },
  {
    name: 'selected-hyphen-origin',
    reason: 'The opposing 44 signed-space witnesses, local threshold witnesses and final v3 counterexamples preserve source selection independently of hyphen paint. A leading ZWSP before Arabic SHY retains its exact admission threshold and neighboring captured widths.',
    evidence: ['api/runs/shy-candidate-v1-heldout44/inputs.json', 'api/runs/shy-candidate-v1-threshold-ltr/inputs.json', 'api/runs/shy-candidate-v3-narrow-ltr/inputs.json'],
    controls: [
      { families: ['shy-source-stage', 'shy-source-heldout'], texts: ['\u00AD', '\u00ADb', '\u00AD\u00ADb', 'a\u00ADb', '\u200B\u00ADb', 'a\u200B\u00ADb', 'a\u2060\u00ADb', 'a\0\u00ADb', 'a\u3000\u00ADb', 'a\u00AD\u3000b'],
        fonts: ['16px Arial', '24px Amiri'], widths: [1, 8, 24], letterSpacing: [0] },
      { texts: ['\u200Bب\u00ADب'], fonts: ['16px Amiri'], widths: [9.800000381469726, 14.750000190734863, 14.850000190734864],
        wordBreak: ['normal'], letterSpacing: [0], directions: ['ltr'] },
    ],
  },
  {
    name: 'language-and-dictionary',
    reason: 'Five-source Myanmar comparisons keep default versus explicit preparation locale and empty content-language reset; these are separate public/native dimensions.',
    evidence: ['api/runs/source4-language-absent-v1/inputs.json', 'api/runs/source4-language-en-v1/inputs.json',
      'api/runs/source4-language-my-v1/inputs.json', 'api/runs/source4-language-zh-cn-v1/inputs.json',
      'corpus-analysis/runs/myanmar-data-v3-native/inputs.json', 'corpus-analysis/runs/myanmar-language-v3/inputs.json'],
  },
  {
    name: 'carried-versus-fresh',
    reason: 'Equal-cursor history witnesses compare short and ordinary following words across the exact carried-admission threshold; the API lane also resumes with changing widths.',
    controls: [{ families: ['history-collision'], texts: ['a\u200B\u0301\u00AD\u0323b i', 'a\u200B\u0301\u00AD\u0323b tail'], widths: [8, 18, 18.5, 19, 30] }],
  },
  {
    name: 'negative-space-advance',
    reason: 'Keep negative, zero and positive SPACE advance; leading versus interior preserved spaces; ordinary and monospace fonts; narrow versus completed-item widths.',
    controls: [{ families: ['negative-space'], fonts: ['16px Arial', '16px Courier New'], texts: [' A B', 'A  B'],
      widths: [6.5, 8, 8.5, 12, 30], letterSpacing: [-6, 0, 6], whiteSpace: ['pre-wrap'] }],
  },
  {
    name: 'control-and-mark-shaping',
    reason: 'ZWSP, WJ and repeated SHY differ when adjoining combining marks. Ligature and non-ligature text are nearby controls; exact named font and signed spacing matter.',
    controls: [{ families: ['mark-context', 'physical-text-geometry'], fonts: ['16px Arial', 'bold 16px ProbeShantell'],
      texts: ['a\u200B\u0301b', 'a\u200B\u0301\u00AD\u0323b', 'a\u2060\u0301\u200B\u0308b', 'a\u2060\u0301b', 'a\u00AD\u0301\u00AD\u0323b', 'office', 'ffiffl'], widths: [7] }],
  },
  {
    name: 'partial-advance-threshold',
    reason: 'The exact Latin SHY and Safari ligature thresholds distinguish partial source advances. Preserve adjacent captured widths, both SHY directions and a zero-spacing ligature control; do not round thresholds or remeasure them with the candidate.',
    controls: [
      { families: ['latin'], texts: ['f\u00ADfi'], fonts: ['16px Arial'],
        widths: [12.066666984558106, 12.116666984558105, 12.216666984558106], whiteSpace: ['normal'], letterSpacing: [0] },
      { families: ['ligature-thresholds-v3'], texts: ['waffles'], fonts: ['bold 16px ProbeShantell'],
        widths: [34.52075004577637, 34.53637504577637, 34.55200004577637], letterSpacing: [1] },
      { families: ['ligature-thresholds-v3'], texts: ['waffles'], fonts: ['bold 16px ProbeShantell'],
        widths: [31.520750045776367, 31.536375045776367, 31.552000045776367], letterSpacing: [0] },
    ],
  },
  {
    name: 'ascii-opener-domain',
    reason: 'Gecko keeps ASCII AL/QU prefixes attached to following openers, while CJK-leading mixed runs retain their own boundary rule. Exact quoted, hash-prefixed and Hangul/Latin failures retain zero/signed-spacing and wider controls. Unicode-affix plus guillemet/curly-quote sources preserve the existing unmodeled boundary domain.',
    controls: [
      { texts: ['""""((aabb', '####((aabb'], fonts: ['16px Arial'], widths: [28.146875, 41.021875, 46.35], letterSpacing: [-1, 0, 1.5] },
      { texts: ['한글x{value}! end'], fonts: ['16px Arial'], widths: [41.1, 41.12374267578125, 69.71798950195313], letterSpacing: [-1, 0, 1.5] },
      { texts: ['−+x«value»! end', '−+x‘value’! end', '−+x’value’! end'], fonts: ['16px Arial'], letterSpacing: [-1] },
    ],
  },
  {
    name: 'emoji-punctuation-boundary',
    reason: 'Emoji have ordinary boundary behavior distinct from word-internal symbol runs. Exact emoji-plus-bracket W24 cases retain nearby captured widths, balanced brackets and hyphen controls; emergency permission alone must not add an orphan punctuation line.',
    controls: [{ families: ['script-prefix-heldout'], texts: ['😀((tail', '😀))tail', '😀[[tail', '😀((()))tail', '😀--tail'],
      fonts: ['24px Amiri', '24px Times New Roman'], widths: [8, 24, 40], letterSpacing: [0] }],
  },
  {
    name: 'embedded-emoji-control',
    reason: 'SHY or ZWSP inserted inside an emoji ZWJ or modifier sequence changes grapheme segmentation and possible source ends. Exact forced-progress and visible-prefix failures retain unbroken controls, adjacent captured widths and normal/pre-wrap comparisons in the implicated Arial size.',
    controls: [
      { texts: ['a👩\u00AD\u200D🚀b', 'a👩\u200B\u200D🚀b', 'a👩\u200D🚀b'], fonts: ['24px Arial'],
        widths: [0.5, 1, 3], wordBreak: ['normal'], letterSpacing: [0], directions: ['ltr'] },
      { texts: ['a👍\u00AD🏽b', 'a👍\u200B🏽b', 'a👍🏽b'], fonts: ['16px Arial'],
        widths: [8, 8.849999618530273, 8.949999618530274], wordBreak: ['normal'], letterSpacing: [0], directions: ['ltr'] },
      { texts: ['a👍\u00AD🏽b', 'a👍🏽b'], fonts: ['24px Arial'],
        widths: [51.716667938232426, 63.28333206176758, 63.383332061767575], whiteSpace: ['pre-wrap'], wordBreak: ['normal'], letterSpacing: [0], directions: ['ltr'] },
    ],
  },
  {
    name: 'unicode-space-source',
    reason: 'U+2006 must not become ordinary collapsible SPACE merely because it is Unicode Zs. Its exact punctuation-context whitespace failure retains U+2002, ideographic-space and NBSP controls at adjacent widths in normal and pre-wrap modes.',
    controls: [{ families: ['unicode-space'], texts: ['…\u2006?”', '…\u2002?”', '…\u3000?”', '…\u00A0?”'], fonts: ['16px Arial'],
      widths: [16, 24, 36], wordBreak: ['normal'], letterSpacing: [0], directions: ['ltr'] }],
  },
  {
    name: 'tab-stop-and-progress',
    reason: 'A leading, interior, repeated and terminal TAB exercise minimum advance and forced progress. Signed spacing straddles the zero-interval boundary; fractional widths retain the exact positive-spacing repeated-TAB regression and adjacent captured controls.',
    controls: [
      { families: ['tab-sizing'], texts: ['\tb', 'a\tb', '\t\tb', 'a\t'], fonts: ['16px Arial'], widths: [8, 20, 40], letterSpacing: [-10, -4.5, -4.45, -4.449, 0, 1] },
      { families: ['tab-sizing'], texts: ['a\t'], fonts: ['16px Arial'], widths: [8, 20], letterSpacing: [-4] },
      { families: ['tab-progress'], texts: ['\t', 'a\t b', 'a\t\tb'], fonts: ['16px Arial'], widths: [8, 35.5, 35.6, 35.7, 72], letterSpacing: [-1, 0, 1] },
      { families: ['tab-progress'], texts: ['\t\tb'], fonts: ['16px Arial'], widths: [35.5, 35.6, 35.7], letterSpacing: [1] },
      { families: ['tab-sizing-fonts'], texts: ['a\tb'], fonts: ['24px Amiri'], widths: [8, 20, 40], letterSpacing: [0] },
    ],
  },
  {
    name: 'separator-source-ownership',
    reason: 'U+3000 differs from NBSP and ordinary space; leading, terminal, repeated and mark-attached sources distinguish scalar hanging from whole-grapheme admission. TAB followed by ZWSP retains narrow and keep-all failures, normal-word-break and wider controls in both directions, plus implicated Amiri/Courier spacing. Signed U+3000 followed by ZWSP retains its zero-spacing control.',
    controls: [
      { families: ['hanging-IDEOGRAPHIC', 'hanging-NBSP', 'hanging-SP'], fonts: ['16px Arial'],
        texts: ['a\u3000b', '\u3000b', 'a\u3000', 'a\u3000\u3000b', 'a\u00A0b', 'a b'], widths: [8, 24, 40], letterSpacing: [0] },
      { families: ['separator-grapheme'], fonts: ['16px Arial', '24px Amiri'],
        texts: ['a\u3000\u0301b', '\u3000\u0301b', 'a\u3000\u0301', 'a\u0301\u3000b'], widths: [8, 24], letterSpacing: [0] },
      { texts: ['a\u3000\u2060b'], fonts: ['16px Arial'], widths: [8], whiteSpace: ['normal'], wordBreak: ['normal'], letterSpacing: [0], directions: ['ltr'] },
      { families: ['hanging-TAB'], texts: ['a\t\u200Bword'], fonts: ['16px Arial'], widths: [8, 24, 40], whiteSpace: ['pre-wrap'], letterSpacing: [0] },
      { families: ['tab-sizing-fonts'], texts: ['a\t\u200Bb'], fonts: ['16px "Courier New"'], widths: [8, 20], whiteSpace: ['pre-wrap'], letterSpacing: [-1, 0] },
      { families: ['tab-sizing-fonts'], texts: ['a\t\u200Bb'], fonts: ['24px Amiri'], widths: [8, 20], whiteSpace: ['pre-wrap'], letterSpacing: [0] },
      { texts: ['a\u3000\u200Bword'], fonts: ['24px Amiri'], widths: [8, 24], whiteSpace: ['normal'], wordBreak: ['normal'], letterSpacing: [0, 1.5], directions: ['ltr'] },
    ],
  },
  {
    name: 'directional-opener-context',
    reason: 'A leading RTL mark before an opener changes the actual source context despite zero advance. Preserve the exact Times 24px RTL witness, its LTR control and the unmarked source in both directions.',
    controls: [{ families: ['partial-source-context'], texts: ['\u200F((tail', '((tail'], fonts: ['24px Times New Roman'],
      widths: [40], whiteSpace: ['pre-wrap'], wordBreak: ['normal'], letterSpacing: [0] }],
  },
  {
    name: 'raw-control-endpoints',
    reason: 'Every C0/C1 scalar stays represented in one ordinary Latin font at a forced-progress and a visible-prefix width. Exact noncharacter/SHY API failure and PUA/surrogate controls remain distinct.',
    controls: [
      { texts: Array.from({ length: 65 }, (_, index) => `a\u00ADb${String.fromCodePoint(index < 32 ? index : index + 95)}b`),
        fonts: ['16px Arial'], widths: [1, 12], whiteSpace: ['normal'], letterSpacing: [0], directions: ['ltr'] },
      { texts: ['a\u00AD\uE000b', 'a\u00AD\uD800b', 'a\u00AD\u200Eb', 'a\u00AD\u2066b\u2069c'], fonts: ['16px Arial'], widths: [0, 1, 8], letterSpacing: [0], directions: ['ltr'] },
      { texts: ['a\u00ADb\uFFFE'], fonts: ['16px Arial'], widths: [17.849999237060548], whiteSpace: ['pre-wrap'], letterSpacing: [0], directions: ['ltr'] },
    ],
  },
  {
    name: 'following-space-context',
    reason: 'Flat and partitioned sources distinguish an actual following SPACE from control source. Latin, Arabic, Hebrew and SHY contexts cover the causal shaping difference; wide controls retain whole-item admission.',
    controls: [
      { families: ['following-space-context'], fonts: ['16px Arial', '18px Times New Roman'],
        texts: ['A B', 'A\u200B B', 'AV\u00AD tail', 'آگ\u200C ب', 'אב\u2060 גד', 'ffi  A'], widths: [1, 12, 48] },
      { families: ['following-space-scope'], fonts: ['16px Arial', '18px Times New Roman'],
        texts: ['A B', 'A\u200B B', 'آگ\u200C ب', 'אב\u2060 גד', 'X A\u00ADV B', '😀A\u200B B'], widths: [1, 12, 48] },
    ],
  },
  {
    name: 'following-space-metrics',
    reason: 'An invisible glue source or emoji before SPACE changes admission under negative spacing; collapsed repeated spaces also retain a separate painted-width failure. Preserve the exact Arial/Times witnesses, zero-spacing and nearby-width controls, and the relevant whitespace/direction comparisons.',
    controls: [
      { families: ['terminal-spacing'], texts: ['a\uFEFF b'], fonts: ['16px Arial'], widths: [7, 8, 12], whiteSpace: ['pre-wrap'], letterSpacing: [-4, 0], directions: ['ltr'] },
      { families: ['terminal-spacing'], texts: ['a\uFEFF b'], fonts: ['16px Arial'], widths: [8], whiteSpace: ['normal'], letterSpacing: [-4], directions: ['ltr'] },
      { families: ['space-context-emoji'], texts: ['a😀 b'], fonts: ['16px Times New Roman'], widths: [1, 7], whiteSpace: ['pre-wrap'], letterSpacing: [-6, 0], directions: ['ltr'] },
      { families: ['space-context'], texts: ['A  B'], fonts: ['16px Times New Roman'], widths: [20, 35, 64], whiteSpace: ['normal'], letterSpacing: [0, 1] },
    ],
  },
  {
    name: 'bounded-source-length',
    reason: 'The original finite cap probes retain the ordinary short control, near-cap punctuation runs and one long combining cluster.',
    evidence: ['runs/policy-script-context-cost-v2/inputs.json'],
  },
]

function matchesControl(input: RetainedInput, control: Control): boolean {
  return (control.families === undefined || control.families.includes(input.family))
    && (control.texts === undefined || control.texts.includes(input.text))
    && (control.fonts === undefined || control.fonts.includes(input.font))
    && (control.whiteSpace === undefined || control.whiteSpace.includes(input.whiteSpace))
    && (control.wordBreak === undefined || control.wordBreak.includes(input.wordBreak))
    && (control.letterSpacing === undefined || control.letterSpacing.includes(input.letterSpacing))
    && (control.directions === undefined || control.directions.includes(input.direction))
}

export function ordinaryReasons(input: RetainedInput, widths: number[]): string[][] {
  const reasons: string[][] = widths.map(() => [])
  for (const behavior of retainedBehaviors) {
    if (behavior.evidence?.some(path => input.origins.some(origin => origin.endsWith(path))) === true) {
      for (const names of reasons) names.push(behavior.name)
    } else {
      const controls = behavior.controls?.filter(control => matchesControl(input, control)) ?? []
      if (controls.length === 0) continue
      for (let index = 0; index < widths.length; index++) {
        if (controls.some(control => control.widths === undefined || control.widths.includes(widths[index]!))) reasons[index]!.push(behavior.name)
      }
    }
  }
  return reasons
}
