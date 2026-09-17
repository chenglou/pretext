# Gecko (Firefox 156.0): the observation model

What Firefox reports through `Range.getClientRects()` for the lab's per-code-point ranges and whole-text-node ranges. It
is derived from the pinned source at `~/github/browser-engines/firefox-156.0` and checked against the final Firefox lab
rows. Charter tentpole 2: the lab should derive expected observations from engine-true output by these rules and compare
them exactly.

Terms:

- **au**: app units, integers, 60 per CSS px at any DPR.
- **Frame**: an `nsTextFrame`: one text node, or one continuation of it on a line or bidi level. The rebuild's
  `GeckoFrame` (`rebuild/src/engines/gecko/types.ts:19-33`) placed on a line is a `FrameResult`
  (`rebuild/src/engines/gecko/lines.ts:257-275`).
- **Box**: a frame's rect, `[0, mRect.width]` in frame-local au (`layout/generic/nsIFrame.h:1121-1123`).
- **Point(o)**: the inline position of content offset `o` inside a frame, from `nsTextFrame::GetPointFromOffset`.
- **Skipped character**: a source character TransformText removed: collapsed white space, an unused soft hyphen, bidi
  controls. The port marks these with `sourceT[s] === -1`.
- **Cluster start**: the text run's `IsClusterStart` flag, the port's `clusterStart[t]`.

Data and scripts for every count below are in `~/github/pretext-rebuild/.artifacts/research-20260916/tentpoles/gecko-observation/`.

## 0. Results in one page

1. **Units and rounding, exact.** Every rect edge Gecko computes is an integer au. Each DOMRect field is then encoded as:
   - `R(a) = floor(a × (65536/60) + 0.5) / 65536` (a double);
   - `x = fround(R(a0))`, `width = fround(R(a1) − R(a0))`, and the same for `y` and `height`.

   Over 30,595 Firefox rows this reproduces all 1,431,864 native rects and all 1,438,838 painted rects, with 0
   mismatches (`rect-model-census.json`). The rows cover the dev smoke, runs, ws, policy and suite-sample sets and the
   held-out runs, ws and policy sets.
2. **One rect per code point.** A code point whose text node has a frame has exactly one rect: 1,066,127 of 1,066,127
   (`frame-presence.json`). A code point whose node has no frame has none: 898 code points in 333 runs, all
   white-space-only.
3. **Where rects start and end.**
   - A code point's rect is its frame's box, cut at Point(i) and Point(i+len) and clamped to the box.
   - A whole-node rect is the box of each frame of the node.
   - Positions snap back to the cluster start, so a cluster's advance lands on its last code point.
   - Trimmed or overflowing trailing white space is clamped to the box edge, so it reports width 0.
   - A chosen soft hyphen's rect is the hyphen, because the hyphen is inside the frame's box after the SHY.
4. **Exact comparisons available.**
   - Every rect's `x` and `width`, from engine frame geometry (§5).
   - Every line box width, as the union of the line's whole-node rects in au. From source it equals the port's
     `engineWidth.au`; the rows don't record `engineWidth`, so this equality isn't verified here.
   - The chosen hyphen's width.
5. **Unobservable by rule (§8):**
   - text nodes without frames;
   - advances of trimmed trailing white space, and of the overflowing part of hanging spaces;
   - how a cluster's advance splits among its code points;
   - glyph widths inside a ligature beyond the per-cluster share;
   - `y` and `height` beyond which line a rect is on (not modeled; needs font metrics);
   - coordinates beyond about 139,800 CSS px.

## 1. What the lab records

`rebuild/lab/page.ts:176-215`. For each case the page:

- builds the paragraph `div` at `(0, 0)`, with body margin 0 (`rebuild/lab/run.ts:558-559`);
- reads the paragraph's `getBoundingClientRect()` as the origin (x = y = 0);
- for every code point, calls `range.setStart(node, i); range.setEnd(node, i + len); range.getClientRects()` on the
  run's own text node;
- for each run, calls `range.selectNodeContents(node)` and `getClientRects()` (`runRects`);
- records `height` from the origin rect.

Subtracting the origin (`page.ts:110-112`) is exact, because the origin is 0. The painter observation
(`page.ts:217-280`) uses the same calls on painted line elements inside a host at `(0, 0)`.

## 2. The source path

### 2.1 Range to rect callback

- `AbstractRange::GetClientRects(aClampToEdge = true, aFlushLayout = true)` (`dom/base/AbstractRange.h:133`,
  `AbstractRange.cpp:985-989`) calls `GetClientRectsInner` (`:1012-1039`). That builds an
  `nsLayoutUtils::RectListBuilder` and calls `CollectClientRectsAndText`.
- `CollectClientRectsAndText` (`:890-962`) flushes layout (`:909-919`) and walks a `RangeSubtreeIterator`. For our
  ranges both boundaries sit in one text node, so `CollectClientRectsForSubtree` (`:833-887`) calls
  `GetPartialTextRect(content, start, end, clamp)` (`:843-851`).
- `GetPartialTextRect` (`:771-831`):
  1. `textFrame = content->GetPrimaryFrame()` (`:767-769`). With no frame there are no rects (`:775-778`).
  2. `relativeTo = root frame` (`nsLayoutUtils.cpp:3698-3700`).
  3. For each continuation from `FindContinuationForOffset(start)` (`nsTextFrame.cpp:8598-8623`):
     - skip it while `fend <= start` (`:785-787`); stop when `fstart >= end` (`:788-790`);
     - `r = GetRectRelativeToSelf()`, the box;
     - if `fstart < start`, `ExtractRectFromOffset(f, start, &r, flushToOrigin = RTL, clamp)` (`:804-809`);
     - if `fend > end`, `ExtractRectFromOffset(f, end, &r, flushToOrigin = LTR, clamp)` (`:810-815`);
     - `r = TransformFrameRectToAncestor(f, r, root)` (`:816`), then `AddRect` (`:817`).
- `ExtractRectFromOffset` (`:715-765`): `point = GetPointFromOffset(offset)`, then `point = r.ClampPoint(point)`
  (`:741-743`; `gfx/2d/BaseRect.h:701-705` clamps into `[x, XMost]`). Then:
  - flush to the origin edge: `width = point.x − r.x`;
  - otherwise: `x = point.x`, `width = XMost − point.x`.

  Clamping is against `r` as already cut, so a cut can never produce a negative width. The rows hold 0 negative widths.

### 2.2 Point(offset)

`nsTextFrame::GetPointFromOffset` (`nsTextFrame.cpp:8721-8752`):

- With content length 0, return `(0, 0)` (`:8731-8735`).
- `properties.InitializeForDisplay(false)` (`:4479-4490`) takes `GetTrimmedOffsets(NoTrimAfter)` (`:3287-3330`):
  - under `white-space` that preserves spaces, nothing is trimmed (`:3306-3308`);
  - otherwise, when the frame starts a line (`TEXT_START_OF_LINE`), leading trimmable white space is removed from the
    start (`:3310-3317`);
  - the end is never trimmed here.
- `UpdateIteratorFromOffset` (`:8667-8690`):
  - clamp to `[contentOffset, contentEnd]`, then to `[trimmedStart, trimmedEnd]`;
  - if the offset is before the end, isn't skipped and isn't a cluster start, `FindClusterStart` (`:3549-3558`) walks
    back, stopping at the trimmed start, a skipped character or a cluster start.
- `GetPointFromIterator` (`:8692-8719`):
  - `iSize = NSToCoordCeilClamped(GetAdvanceWidth(Range(trimmedStart, iter)))`;
  - `x = iSize`, or `mRect.width − iSize` for an RTL text run (`:8712-8716`).

`gfxTextRun::GetAdvanceWidth` (`gfx/thebes/gfxTextRun.cpp:1214-1256`) sums three things:

- the integer glyph advances of whole ligature groups (`GetAdvanceForGlyphs` `:331-338`, `gfxTextRun.h:780-800`);
- partial ligature shares, `partClusterCount × (ligatureWidth / totalClusterCount)` with integer division and the
  remainder on the last part (`:238-329`);
- spacing: letter spacing after cluster ends (`nsTextFrame.cpp:4202-4214`, `CanAddSpacingAfter` `:3860-3873`), word
  spacing after the cluster end of a space (`:4215-4226`), and tab widths (`:4261-4273`, `NSToIntRound` in `:4364-4369`).

All of these are integers in the lab's styles (no justification, no `text-combine-upright`), so the ceil does nothing
and a Point is an integer au. `GetCharacterRectsInRange` (`:8754-8866`, ceil per cluster) serves IME and accessibility,
not `getClientRects`.

### 2.3 Frame boxes

- `ReflowText` (`nsTextFrame.cpp:10847-11532`):
  - A frame at a line start skips leading trimmable white space (`:10935-10951`). If nothing is left, `ClearMetrics`
    gives it size 0 (`:10954-10957`).
  - `BreakAndMeasureText` reports trailing white space as `trimmableWS` (`:11115-11145`). That counts only characters
    with `CharIsSpace` (U+0020 and U+3000; `gfxFont.cpp:749-750`).
  - A used soft hyphen adds the hyphen run's advance through `AddHyphenToMetrics`, without letter spacing
    (`:11192-11197`, `:6829-6845`). `CombineWith(isRTL)` puts it after the text in inline direction: at the left of an
    RTL frame.
  - Trailing white space at a break is trimmed (`TEXT_TRIMMED_TRAILING_WHITESPACE`). Under `pre-wrap` only the part
    beyond the available width is removed: `hang = min(max(0, advance − avail), trimmableWS)` (`:11203-11240`).
  - `ISize = ceil(max(0, advance))` (`:11268-11273`).
  - `BSize = 0` when nothing fit and no hyphen was used. Otherwise it is `max(ceil(text ascent), font max ascent) +
    max(ceil(text descent), font max descent)` (`:11279-11307`, `LOOSE_INK_EXTENTS` `:11075`).
- `nsLineLayout::TrimTrailingWhiteSpaceIn` (`nsLineLayout.cpp:2851-2985`) calls `nsTextFrame::TrimTrailingWhiteSpace`
  (`nsTextFrame.cpp:11540-11628`):
  - it doesn't run for frames already trimmed at a break (`:11576-11592`);
  - otherwise it subtracts `floor(advance of [trimmedEnd, contentEnd))` from the box, unclamped (`:11605`). Here
    trimmable means `IsTrimmableSpace`: SPACE, U+1680, TAB, FF, LF and CR (`:904-944`, `:967-996`);
  - frames after it slide back (`nsLineLayout.cpp:2934-2968`).
- Positions:
  - `PlaceFrame` advances the span's inline coordinate by the box (`nsLineLayout.cpp:1347-1400`).
  - `TextAlignLine` (`:3482-3670`): with `text-align: start` there is no shift, except that on a wrapped line whose last
    text frame hangs white space against the line's direction, `dx = hang` (negative) (`:3503-3512`, `:3598-3605`;
    `GetHangFrom` `:3420-3450`).
  - If the document has bidi enabled, `nsBidiPresUtils::ReorderFrames` places frames in visual order from the line start
    (`:3646-3652`; `nsBidiPresUtils.cpp:1494-1533`; `RepositionFrame` `:1769-1866`).
  - Bidi is enabled by any RTL text node in the document (`dom/base/CharacterData.cpp:298-302, :405-411`) and by any
    frame with `direction: rtl` (`layout/generic/nsIFrame.cpp:1505-1511`). It stays on for the document.

### 2.4 Frame au to DOMRect

- `TransformFrameRectToAncestor` (`nsLayoutUtils.cpp:2517-2537`):
  - `LayoutDeviceRect::FromAppUnits` gives float32 device px;
  - `TransformGfxRectToAncestor` (`:2287-...`) applies the translation to the root in float32;
  - `ScaleThenRoundGfxRectToAppRect` (`nsLayoutUtils.h:3373-3400`) scales back and rounds x and width separately to
    integer au.

  With a pure translation and |coordinate| < about 2^23 au (139,800 CSS px at apd 30), the round trip returns the exact
  integer au.
- `RectListBuilder::AddRect` (`nsLayoutUtils.cpp:3691-3696`) calls `DOMRect::SetLayoutRect` (`dom/base/DOMRect.cpp:152-164`):
  - `x = RoundFloat(a0 × 65536/60) / 65536`, where `RoundFloat(v) = floor(v + 0.5)`;
  - `width = RoundFloat(a1 × 65536/60) / 65536 − x`;
  - `y` and `height` the same way;
  - `SetRect(float, float, float, float)` (`DOMRect.h:122-127`) then narrows each of the four values to float32
    separately, and `mX` and the others stay doubles (`:97`).

## 3. The encoding, exactly

```ts
const R = (au: number) => Math.floor(au * (65536 / 60) + 0.5) / 65536
function encodeRect(a0: number, a1: number, b0: number, b1: number) {   // integer au edges, root coordinates
  return { x: Math.fround(R(a0)), width: Math.fround(R(a1) - R(a0)), y: Math.fround(R(b0)), height: Math.fround(R(b1) - R(b0)) }
}
// Inverse, exact for |a| < 2^23 au (checked for every au in [0, 2^23) in encode-examples.txt):
const a0 = Math.round(rect.x * 60)
// a1 is the integer au with Math.fround(R(a1) - R(a0)) === rect.width (search round((R(a0) + width) × 60) ± 2).
```

Examples (`encode-examples.txt`):

| Edges (au) | x | width | Naive au/60 |
|---|---|---|---|
| 2304, 2304 | 38.399993896484375 | 0 | 38.4, 0 |
| 16112, 17150 (`c-4d300b0c89681336`, 이) | 268.5333251953125 | 17.29998779296875 | 268.5333…, 17.3 |
| 17150, 18188 (루) | 285.83331298828125 | 17.300003051757812 | 285.8333…, 17.3 |
| 0, 3120 (probe gecko-lines H16) | 0 | 52 | |
| 0, 1 | 0 | 0.01666259765625 | |

This explains `285.83331298828125 for 17150 au`, cited in `rebuild/lab/README.md:302-305`:

- `R(17150) = 18732373/65536`;
- float32 at 285 px has a step of 2/65536, so that value is a tie between 18732372 and 18732374;
- ties go to even, giving 18732372/65536.

It is not a float32 sum, and it isn't the nearest float32 of 17150/60 (that is 285.8333435…). The same rounding produces
the "119 of 20,494 values more than 1e-3 au off the grid" (`rebuild/lab/VALIDATION.md:357-360`): R is off by up to
0.00046 au and fround by up to 0.0009 au at 256 to 512 px. It is also why widths alternate between 17.29998779296875 and
17.300003051757812 for equal advances.

## 4. What the model needs from the engine

Fragments (`rebuild/src/model.ts:76-91`) aren't enough. They hold no frame boxes, no content ranges per frame, no
cluster flags and no positions. The Gecko port computes all of these inside `buildLine`
(`rebuild/src/engines/gecko/lines.ts:474-749`) and throws them away. The observation model consumes:

```ts
// Per paragraph, for every text node (run): all its continuation frames in content order, across lines, including
// empty ones. The Gecko port has each of these fields today.
type GeckoFrameGeometry = {
  run: number
  line: number             // line index; y and height aren't modeled (§8, U7)
  contentStart: number     // GetContentOffset(): FrameResult.contentStart (lines.ts:259)
  contentEnd: number       // GetContentEnd(): contentStart + contentLength (lines.ts:263)
  measuredStart: number    // after the line-start skip: FrameResult.offset (lines.ts:289-306); contentStart when nothing was skipped
  rtl: boolean             // text run direction: frame level odd (GeckoFrame.level)
  boxAu: number            // r.width − floor trim delta: frameBox[k] (lines.ts:621-625)
  hasHeight: boolean       // BSize > 0: charsFit > 0 || usedHyphenation (= FrameResult.nonEmpty, lines.ts:357-361)
  xAu: number              // physical left edge from the block content box (below)
  // Advance from measuredStart's transformed index to transformed index t: glyph records, partial ligature shares,
  // letter and word spacing, tabs. In the port: advance(p, m, r.prov, r.prov.startT, t) (lines.ts:98-103).
  pointAu: (t: number) => number
}
type GeckoObservationInput = {
  text: string
  runStarts: number[]
  sourceT: Int32Array      // per source offset, -1 when skipped (types.ts:110-111)
  nextT: Int32Array        // first transformed index at or after a source offset (types.ts:112-113)
  clusterStart: Uint8Array // text run cluster flags per transformed index (types.ts:101)
  framesOfRun: GeckoFrameGeometry[][]   // empty for a run whose node got no frame (prepare.ts:605-621, nsCSSFrameConstructor.cpp:5220-5290)
  contentWidthAu: number   // round(fround(width) × 60) (specs/gecko-lines.md:79)
}
```

`xAu` per line, with frames in visual order (`lines.ts:674-695`, UAX #9 L2 over frame levels), `L` the sum of the
line's boxes and `leftSum(k)` the sum of boxes visually left of frame k:

- LTR block: `xAu(k) = leftSum(k) + dx`.
- RTL block: `xAu(k) = contentWidthAu − L + leftSum(k) − dx`. `RepositionInlineFrames` walks the visual order from the
  right and `RepositionFrame` sets `IStart` from the right edge (`nsBidiPresUtils.cpp:1860-1866`).
- `dx = GetHangFrom(line)` when that is negative, the line is wrapped and `white-space` lets spaces hang; otherwise 0.
  The port doesn't compute it today.
- Without document bidi (an LTR paragraph with no RTL text anywhere in the document), frames keep logical order. Levels
  can't differ then, except for LTR embedding controls (shortcut audit F3).

## 5. Port-level pseudo-code

```ts
function clusterStartAt(o: number): boolean { return clusterStart[sourceT[o]] === 1 }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// nsTextFrame::GetPointFromOffset, frame-local au (nsTextFrame.cpp:8667-8752).
function pointLocal(f: GeckoFrameGeometry, o: number): number {
  if (f.contentEnd - f.contentStart <= 0) return 0                               // :8731-8735
  o = clamp(o, f.contentStart, f.contentEnd)                                      // :8670-8676
  o = clamp(o, f.measuredStart, f.contentEnd)                                     // :8678-8681 (no trim after)
  if (o < f.contentEnd && sourceT[o] !== -1 && !clusterStartAt(o)) {              // :8685-8689
    while (o > f.measuredStart && sourceT[o] !== -1 && !clusterStartAt(o)) o--    // FindClusterStart :3549-3558
  }
  const iSize = f.pointAu(nextT[o])     // an integer, so NSToCoordCeilClamped does nothing
  return f.rtl ? f.boxAu - iSize : iSize                                          // :8712-8716
}

// One code point [i, i + len): AbstractRange.cpp:771-831 with ExtractRectFromOffset :715-765, clamp on.
function codePointRects(i: number, len: number): Observed[] {
  const frames = framesOfRun[runOf(i)]
  if (frames.length === 0) return []                                              // no primary frame
  const out: Observed[] = []
  for (const f of framesFrom(frames, i)) {                                        // FindContinuationForOffset
    if (f.contentEnd <= i) continue
    if (f.contentStart >= i + len) break
    let x0 = 0, x1 = f.boxAu
    if (f.contentStart < i) {
      const p = clamp(pointLocal(f, i), x0, x1)
      if (f.rtl) x1 = p; else x0 = p                                              // RTL: flush to origin; LTR: opposite edge
    }
    if (f.contentEnd > i + len) {
      const p = clamp(pointLocal(f, i + len), x0, x1)
      if (f.rtl) x0 = p; else x1 = p
    }
    out.push({ ...encodeX(f.xAu + x0, f.xAu + x1), line: f.line, positiveHeight: f.hasHeight })
  }
  return out            // exactly one element: frames split only at code point boundaries
}

// A whole text node: selectNodeContents takes the same path with [0, length), so every continuation's box.
function nodeRects(run: number): Observed[] {
  const length = runText(run).length
  return framesOfRun[run]
    .filter(f => f.contentEnd > 0 && f.contentStart < length)                    // an empty frame at an interior offset still counts
    .map(f => ({ ...encodeX(f.xAu, f.xAu + f.boxAu), line: f.line, positiveHeight: f.hasHeight }))
}

const encodeX = (a0: number, a1: number) => ({ x: Math.fround(R(a0)), width: Math.fround(R(a1) - R(a0)) })
```

The painted lines use the same functions over the painted document's frames. Element boxes: the paragraph's own rect is
`x = y = 0`, and `height = fround(R(sum of line box block sizes))`. Line box heights aren't modeled.

## 6. Fragment kinds and their rects

The derivations below use §5; `s` is a source offset, `f` its frame.

| Fragment | Rects of its code points |
|---|---|
| `text` | Code points in one cluster: every code point but the last reports width 0 at the cluster start; the last reports `[Point(clusterStart), Point(clusterEnd)]`, letter and word spacing included. Skipped units inside the piece (`sourceT = −1`: collapsed spaces, removed segment breaks, unused SHY, bidi controls) report width 0 at the position after the kept content before them. A kept zero-advance character (ZWSP, a hidden control without letter spacing, U+2060) reports width 0 at its position. |
| `trimmed` (trimmed at the break) | The box excludes it. Point(s) ≥ box end, clamped, so width 0 at the frame's inline end: x = box right in LTR, x = box left in RTL. |
| `trimmed` (by `TrimTrailingWhiteSpace`) | Also width 0 at the box end, unless the removed advance was negative. Then the floored delta grows the box, and a range reaching the box end covers the growth: `c-79e5272a2644d9b8`, a −90 au space alone in its frame, observes 90 au (1.5 px). |
| `collapsed` at a line start, inside a frame | The frame's measured start is past it. Every Point clamps to measuredStart, so width 0 at the frame's inline start. |
| `collapsed` inside a frame (skipped) | Width 0 at Point(s). |
| `collapsed` in a run with no frame | No rects. |
| `hanging` (`pre-wrap`) | Spaces up to the available width are inside the box and report their advances. The overflowing part clamps to the box end and reports width 0. |
| `hyphen` after SHY at `at − 1` | The frame's last content code point, normally the SHY, reports `[Point(SHY), box end]`: the hyphen run's advance, without letter spacing. In an RTL frame the hyphen is at the left: `[0, hyphenAu]`. If skipped characters (bidi controls) follow the SHY inside the frame, the last of them carries the hyphen and the SHY reports width 0. |
| `forced-break` (preserved LF) | The LF is the frame's last content character (`nsTextFrame.cpp:11165-11171`), with no advance and no letter spacing (`CanAddSpacingAfter` `:3864-3866`): width 0 at the box end, positive height. |

Other cases:

- **Negative advances inside a frame.** A space whose advance plus word spacing is negative: Point(i+1) < Point(i),
  clamped, so width 0. Examples: `c-4aafc349e1c161fd` (−270 au) and `c-3b2e9519e5b651d4` (−218 au),
  specs/gecko-AUDIT.md:338-341.
- **Letter spacing on hidden controls.** VT, NUL and other hidden C0/C1 controls have no glyph advance (the invalid-char
  path, `gfxFont.cpp:3872-3897`), but `CanAddSpacingAfter` doesn't exclude them. A lone VT with 1 px letter spacing
  reports 60 au (`c-92b6963ae4344985`; NUL `c-fc59a73aa616baff`; specs/gecko-AUDIT.md:114-118).
- **Tabs.** Tab spacing sits on the tab character, so the tab reports its width.
- **Bidi runs.** Each frame is one level run with its own box and direction. Points count from the right edge in RTL.
  Frames reach their positions through `ReorderFrames` (§4).
- **Paragraph-end join controls.** A U+200C or U+200D at the paragraph end gets the paragraph level by L1 over the
  whole paragraph: removed characters join the trailing run (the crate's `lib.rs:1143-1204, :1264-1270`, as ported in
  `rebuild/src/unicode/unicode-bidi.ts:274-281`). It becomes a frame of its own, so the base letter before it keeps the
  cluster's advance.
  - `c-980e7db47ba28459` (`ب­ب‌`): ب reports [0, 11.4167] px and U+200C width 0 at 15.3167 px, the edge of its own frame.
  - All 78 one-node, one-line cases where the base carries the advance are this shape (`joiner-base-cases.json`).
- **Span edges.** Every range stays inside its own node's frames. A cluster split over two nodes gives each piece's
  advance to that piece's last code point. FindClusterStart stops at the frame's measured start, so a mark that begins
  a node reports width 0 at the node's start, and the base's frame holds the glyph advance. Census over dev rows
  (`cluster-span-edges.json`), graphemes of the lab segmenter:
  - 91 with the advance on a non-last code point and 167 with several positive code points, all across a text node edge;
  - 198 more in one node, where the grapheme sits on two lines, or ends in a paragraph-end joiner (above).

## 7. Recorded observation quirks, explained

### Firefox, from source

| # | Recorded in | Observation | Source explanation |
|---|---|---|---|
| F1 | lab/README.md:302-305; VALIDATION.md:357-360; score.ts:49-55 | Rect values "read through float32", "two float32 steps" allowed | §3: rounding to 1/65536 px, then `DOMRect::SetRect(float…)` per field. With the encoding the allowance isn't needed. |
| F2 | lab/README.md:303-305; specs/probes-firefox.md:43-46 | A precomposed base letter has a zero-width rect; its combining mark carries the advance | `UpdateIteratorFromOffset` snaps a non-cluster-start offset to the cluster start (`nsTextFrame.cpp:8685-8689`). The base's range [Point(start), Point(start)] is empty, and the last code point's range reaches the cluster end. Census: 38,772 multi-code-point graphemes with only the last code point positive. |
| F3 | lab/ISSUES.md:5-24, :209-217; VALIDATION.md:197-202 | Emoji + VS16 puts the advance on the VS16; a letter + ZWNJ or ZWJ puts it on the joiner | The same rule. VS16 and the joiners extend clusters (`gfxFont.cpp:708-769`, `nsUnicodeProperties.h:202-207`), and HarfBuzz clumps keep the cluster flags (`gfxHarfBuzzShaper.cpp:1778-1786`). |
| F4 | lab/ISSUES.md:224-235 | U+3000 + VS16: VS16 carries 960 au; the lab derives 0 | Again F2's rule: VS16 is the cluster's last code point. U+3000 is `CharIsSpace` (`gfxFont.cpp:749-750`), so the port's trimming question is separate from the rect. From the rects it can be observed exactly (F2); whether to count it in a line width is a lab definition. |
| F5 | lab/README.md:305; specs/probes-firefox.md:143, :185-192; VALIDATION.md:136-137 | VT and FF keep zero-width rects on the line they end; the space before them keeps its width | At a break, trailing white space counts only `CharIsSpace` characters, so VT and FF stop it, and a broken frame isn't trimmed again (`nsTextFrame.cpp:11576-11592`). The box keeps `aaaa ` (48 px for W3), and the control reports width 0 at the box end. Rows: 3 FF and 3 VT line ends with the space positive (`space-before-control.json`). **Correction:** the other trim path (`TrimTrailingWhiteSpace`, `IsTrimmableSpace`, `:922-944`) treats FF, TAB, CR and LF as trimmable but not VT. So a space before an FF that ends an unbroken frame at a line end, such as an FF at the end of a text node whose next node starts line 2, would be trimmed. Not observed in rows; to probe. |
| F6 | lab/README.md:306-307; ISSUES.md:80-84; specs/gecko-AUDIT.md:114-118 | 4 controls with 1 px advances | The two traced ones are letter spacing, not glyph advances (§6, "Letter spacing on hidden controls"). The two Amiri ones (VT, FF, U+0000 in 24 px Amiri) weren't traced here. |
| F7 | lab/README.md:137-138 | An emoji line's rects are 21 px tall, the next line's 19 px | Rect height is the frame's block size: `max(ceil(text ascent), font max ascent) + max(descents)` over the fonts the frame uses (`nsTextFrame.cpp:11290-11307`). |
| F8 | specs/gecko-AUDIT.md:106-113, :333-341 | A negative-advance space: 0 wide inside a line, 90 au at a line end | Clamping (§2.1), `ISize = max(0, …)` and the unclamped floored trim delta (§2.3). |
| F9 | lab/README.md:141-151; VALIDATION.md:87-90 | A lone ZWSP, joiner or SHY makes a line with only zero-width rects | Such a frame has `transformedCharsFit > 0`, so it gets block size from font metrics (`:11279-11307`): width 0, height positive. A frame holding only skipped or trimmed characters has height 0 and marks no line. |
| F10 | lab/ISSUES.md:199-222; README.md:167-171 | Firefox starts lines inside the lab's grapheme and splits graphemes at text node edges | Ranges stay inside frames (§6, "Span edges"). Gecko's clusters come from one text run, with a cluster start forced at each text run start (ISSUES.md:206-207). |
| F11 | lab/README.md:200-201; research/TESTS.md:53, :284 | A positive soft hyphen rect at a line end: "a Range rect doesn't establish whether a hyphen was drawn" | In Gecko it does. A SHY is skipped, and reports a positive width only as the frame's last content character when the box holds more after it: the hyphen added with `TEXT_HYPHEN_BREAK` (`:11192-11197`), which is also what paint draws (`drawSoftHyphen`, `:6930`, `:7875`). The width equals the hyphen advance. Census: 4,026 of 4,026 positive SHY rects end their node or line (`cluster-and-shy-classes.json`). Only a SHY after a negative-advance trimmed space could be positive without a hyphen. |
| F12 | engine rule P19 (research/gecko-shortcut-audit.md:62); census | White-space-only nodes with no rects at all | 8-bit white-space-only text nodes at a line boundary get no frame (`nsCSSFrameConstructor.cpp:5220-5290`), and `GetPartialTextRect` returns nothing without a primary frame. 333 runs, 898 code points. |
| F13 | lab/ISSUES.md:237-251 | U+1F600 is 1020 au after an earlier `😀︎` | Font matching state in the document (layout), not observation. The rect encodes whatever box layout made. |

### Chrome and Safari, by contrast

These belong to the Blink and WebKit parts; each line says what Gecko does instead and why.

| # | Recorded | Gecko |
|---|---|---|
| B1 | Chrome rects on 1/(64 × DPR) px (README.md:280-282) | Gecko edges are au at any DPR, encoded as in §3. |
| B2 | Chrome's duplicate soft hyphen box on the next letter (README.md:139-140, :282-285; VALIDATION.md:83-86) | Gecko emits one rect per overlapping continuation (`AbstractRange.cpp:782-817`). No code point in any Firefox row has more than one rect. |
| B3 | Chrome gives a chosen SHY in an RTL run a zero-width rect (ISSUES.md:253-270) | Gecko's hyphen sits at the left of the RTL frame, inside the SHY's rect: the width is positive. |
| B4 | Chrome copies the next letter's rect onto a line-start U+2028 (VALIDATION.md:355) | Not traced for Gecko. |
| B5 | Chrome and Safari give controls advances (ISSUES.md:55-79) | Gecko hides controls: no glyph, zero advance (`gfxFont.cpp:3872-3897`), apart from letter spacing (F6). |
| W1 | Safari snaps code point Range edges to whole px and floors box ends (README.md:287-297; ISSUES.md:26-53) | Gecko's Points are exact integer au (§2.2), with no snapping before §3's encoding. |
| W2 | Safari splits a cluster's advance with a following ZWSP (README.md:291-292) | ZWSP is its own cluster in Gecko, with zero advance. |
| W3 | WebKit: a collapsed space after `</span>` reports a zero-width rect on the next line (README.md:143-145, :299-300; specs/PROBES.md:166) | In Gecko a collapsed space that starts the next line's frame reports width 0 at that frame's start (`:10935-10951` with `:8678-8681`), and one trimmed at a line end reports width 0 at the box end. The scorer's rule that collapsed white space establishes no line fits Gecko for the same reason. |
| W4 | WebKit box right edges as float32 sums (ISSUES.md:39-41) | Gecko widths are fround of a double difference of rounded edges. Invert per field (§3). |

## 8. What the lab can derive exactly, and what it can't

**Exact, given `GeckoObservationInput`:**

- **E1.** Every native and painted rect's `x` and `width`, by exact double equality. Line membership follows from `line`
  and `positiveHeight`.
- **E2.** From the rows alone: every edge as integer au (§3 inverse), for coordinates below 2^23 au.
- **E3.** A line's box width: the union of its whole-node rects with positive area, in au.
  - From source it is the line box `psd->mICoord`: the sum of box widths after `TrimTrailingWhiteSpaceIn`, the same
    quantity as the port's `lineBoxAu` (`lines.ts:581-604`).
  - Conditions: no inline box margins, borders or padding (true in the lab), and every positive-width frame has positive
    height.
  - Under `pre-wrap` it includes the hanging spaces that fit (`:11216-11229`). The lab's visible extent leaves those out.
  - Rows don't record `engineWidth`, so the equality isn't verified.
- **E4.** The first code point of each line: the measured start of the line's first frame with positive height.
- **E5.** A chosen hyphen's width: the SHY rect (F11).
- **E6.** The visible extent the lab scores today, computed by lab code from the E1 rects with its own visibility rules.
  The library doesn't need to copy those rules.

**Unobservable by rule:**

- **U1.** Anything about code points in a node without a frame: no rects.
- **U2.** The advance of trailing white space trimmed at a break or by `TrimTrailingWhiteSpace`, and the overflowing
  part of hanging spaces: clamped to the box edge. The exception is growth from a negative delta (F8).
- **U3.** How a cluster's advance splits among its code points, and which glyph in a cluster carries kerning: only the
  per-cluster sum within a frame shows.
- **U4.** Glyph widths inside a ligature beyond the integer share per started cluster (`gfxTextRun.cpp:279-288`).
- **U5.** Which zero-advance characters exist (skipped, hidden controls without spacing, ZWSP): each reports width 0 at
  a position. They show up only through line membership when the frame has height.
- **U6.** Letter spacing apart from the glyph advance of the same cluster: they're summed.
- **U7.** `y` and `height` beyond line membership. Not modeled, not unobservable: they need per-frame ascent and descent
  and line box block sizes.
- **U8.** Coordinates beyond about 139,800 CSS px, where the float32 round trips of §2.4 and §3 can lose an au. That
  affects `y` in very tall corpus paragraphs, not `x`.
- **U9.** Where frames split between characters that all report width 0 (for example a level change at a zero-width
  character).
- **U10.** Whether the hyphen glyph is U+2010 or `-`: only its width shows.

## 9. Consequences for the lab and the library

1. **Scorer, Firefox rows.** Replace the grid and float32-step checks with §3's encoding, or invert per field.
2. **Library width (tentpoles 1 and 2).** Move `lines.ts:605-744`, the visible-width derivation copied from the scorer,
   out of the library. The library returns `GeckoFrameGeometry` per line, which the port already computes. The lab
   derives expected rects by §5 and applies its own visibility definitions in lab code.
3. **Widths.** Score `engineWidth.au` against the E3 box union once the predictor records `engineWidth`.
4. **Firefox verdict changes.**
   - Soft hyphens: a positive SHY rect at a line end observes the hyphen width (F11) instead of marking the width
     unobserved.
   - Other space separators at a line end: their rects are exact. U+2000 to U+200A aren't `CharIsSpace` or trimmable and
     keep their width; U+3000 is trimmed at a break and hangs under `pre-wrap`. So the "other space separator" rule
     that marks widths unobserved isn't needed for Firefox.
5. **Geometry the port doesn't have yet.**
   - The negative-hang shift `dx` (§4).
   - The document-wide bidi state (shortcut audit F3). It also decides whether `ReorderFrames` runs for LTR paragraphs
     with embedding controls.
   - Line `y`.
6. **Probes to add.**
   - FF ending an unbroken frame at a line end (F5 correction).
   - `pre-wrap` RTL trailing spaces on a wrapped LTR line: is x shifted by the hang?
   - U+2028 at a line start (B4).
   - The two Amiri controls of F6.
