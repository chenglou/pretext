# Lab issues

One entry per problem: the case id, what the owner expected, and what the lab reported.

## Firefox: the advance of an emoji + VS16 cluster sits on the VS16 rect, which the scorer drops (Gecko owner, 2026-09-16)

- Cases: `c-9b13e18e12ef188a`, `c-c87b0c242d8b3d01`, `c-ee726fc522c4b518`, `c-71c0156667444092` (widths at a line ending
  `❤️❤️`), `c-45a96fe1087eb491`, `c-d93198729f8adfce` (a line holding only `❤️`), in `.artifacts/lab/cases/smoke.ndjson`.
- Rows: `.artifacts/lab/gecko/smoke-r1/firefox-rows.ndjson`. For `c-9b13e18e12ef188a` the native rects of U+2764 are
  zero width and U+FE0F carries the whole 1080 au advance (offsets 43-46 on line 2).
- `markVisible` treats U+FE0F as invisible (Default_Ignorable), and U+2764 has no positive rect, so the cluster has no
  visible code point and the line's observed extent ends before it. Native line 2 of `c-9b13e18e12ef188a` observes
  110.0667px; the hearts natively reach 151.0667px (7984 + 1080 au), which is what the Gecko port predicts.
- Expected: a grapheme cluster with ink counts as visible through whichever of its code points has the positive rect,
  as the scorer already does for a precomposed base letter whose advance sits on its combining mark.

## Safari/webkit-host: widths taken from code point rects end at a floored line-end edge, then fail the float32 edge test (WebKit owner, 2026-09-16)

- Cases (`.artifacts/lab/cases/runs.ndjson`, rows `.artifacts/lab/webkit/runs-r1/webkit-host-rows.ndjson`):
  `c-019fad2e6d75064e`, `c-036aa1473159b950`, `c-0512d206ac683547`, `c-0608392e9e6aad81`, `c-1527768a97b41c3b`,
  `c-b178d5d519151ab5`. About 280 of the 384 runs width failures report "0 units of 1/64px".
- Example `c-0608392e9e6aad81` line 0: the whole-node rects end at 30.469196319580078 + 71.9345703125 =
  102.40376663208008, the WebKit port predicts 102.40376281738281 (the same float32), and the scorer observes
  102.40625, from the code point rect at the line end, which Safari floors to 1/64px (lab/README.md "Range geometry").
- The line has white space with width (spaces inside the bare text node), so `widthSource` becomes code points, and
  `float32EdgesMatch` then compares an exact float32 prediction with a floored edge.
- Expected: when the extent's end edge comes from a code point rect at a line end, either take that edge from the
  whole-node rect of the box that holds it (the node rect ends at the float32 glyph position) or mark the width
  unobserved, as the scorer already does for whole-pixel edges.

## Safari/webkit-host: controls with a .notdef advance are left out of the observed extent (WebKit owner, 2026-09-16)

- Cases (`.artifacts/lab/cases/smoke.ndjson`, rows `.artifacts/lab/webkit/smoke-r2/webkit-host-rows.ndjson`):
  `c-1cb8b9aea80ececb` (U+001C), `c-5bb28a79f6310f0d` (U+009D), `c-03aa275e47e0acb4` (U+0004),
  `c-be7f6b754e4527ff` (U+001E), `c-672e97f1328e77cb` (U+0093), `c-e553ef18898ef0fc` (U+0016),
  `c-03d168a744591444` (U+0081), `c-360b9a5c18e93dbf` (U+0085), `c-de31834f9896a7cc` (trailing U+000C text node).
- WebKit draws VT, FF and other Cc characters with the `.notdef` advance (specs/webkit-lines.md §3.3; probes-safari
  webkit-text H12: "FF node between spans: 12px rect"). The port predicts a line holding only U+001C in 16px Arial as
  12px; the scorer observes 0px because controls aren't visible code points.
- Expected: a control whose rect has positive width counts toward the line's extent, or the line's width is unobserved.

## Safari/webkit-host: Latin-1 text reaches layout as 16-bit strings (WebKit owner, 2026-09-16)

- Cases (`.artifacts/lab/cases/smoke.ndjson`): `c-42086912543bce9f` (Menlo, keep-all, break-word, width 5: native keeps
  `e.` together, the 16-bit line-start prohibition of InlineContentBreaker.cpp:139-158), `c-c551e7ed97f564ff` and
  `c-c62182c46f2a130d` (keep-all breaks after `.` and `@`, which BreakablePositions.h:268-271 makes only in 16-bit text).
- Every code unit of these texts is at most U+00FF, which a JS string literal stores as Latin-1 (specs/webkit-gaps.md
  §7.4, probes-safari webkit-canvas H14: `abcd,efghé` gives 1 line). The page creates text nodes from strings parsed out
  of a chunk reply; JSC gives JSON strings longer than 16 units from a 16-bit source 16-bit storage, and a chunk that
  contains any non-Latin-1 character decodes to a 16-bit source, so storage depends on which cases share the chunk.
- Expected: text nodes built from strings whose storage doesn't depend on the chunk (for example each case's run texts
  rebuilt from single-character strings), or the storage recorded per row. The port assumes Latin-1 storage and reports
  `string-storage`.

## Safari/webkit-host: a line holding only a chosen soft hyphen observes 0px (WebKit owner, 2026-09-16)

- Cases (`.artifacts/lab/cases/smoke.ndjson`): `c-45a96fe1087eb491`, `c-5bb28a79f6310f0d`, `c-03aa275e47e0acb4` (the
  `­` line).
- WebKit adds the hyphen when the next content wraps (InlineContentBreaker.cpp:114-120, InlineLine.cpp:609-619), so the
  line is the hyphen's width; the Range over U+00AD has no positive rect, and the scorer reports 0px instead of
  unobserved.
- Expected: unobserved, as for a line ending at a positive-width soft hyphen.

## Safari/webkit-host: "predicted line splits a grapheme" across a text node edge that native layout splits too (WebKit owner, 2026-09-16)

- Cases (`.artifacts/lab/cases/runs.ndjson`, rows `.artifacts/lab/webkit/runs-debug-r1/webkit-host-rows.ndjson`):
  `c-a560dabf8d17cd2c` (`nai` in one span, `̈ve` in the next), `c-60d5fd5f5ad2f9ec` (`e` then a span holding U+0301),
  `c-a11286faf2988d0e` (`क्` and `षत्` in separate spans).
- WebKit never measures or segments across a text box (specs/webkit-text.md §7.5), and native layout breaks at those node
  edges: native `c-a560dabf8d17cd2c` has `i` and `̈` on separate lines, as the port predicts.
- Expected: a line start at a text node edge doesn't count as splitting a grapheme, since the engine's grapheme
  iterator never sees across it.

## Safari/webkit-host: a code point with ink but a zero-width rect moves the first visible code point (WebKit owner, 2026-09-16)

- Case: `c-4f0c9d3cd9d60735` (`.artifacts/lab/cases/runs.ndjson`), Kohinoor Devanagari 24px, width 44, line 8.
- The port starts line 8 at offset 23 (`र्ट है।`); native layout starts it at 23 too, but `र्` forms a reph on the next
  consonant and its Range rects have zero width, so the scorer's native line starts at `ट` (offset 25) and breaks fail.
- Expected: compare line starts at the first code point of the line's first grapheme with ink through any of its code
  points, as in the Gecko owner's VS16 issue above.

## Chrome: break-all breaks inside Thai grapheme clusters natively, and the scorer calls the prediction wrong (Blink owner, 2026-09-16)

- Cases: `c-213e2818602b7033`, `c-8234a339ec2266c1` (`policy/thai`, `word-break: break-all`, 2px wide) and
  `c-8299efa6cdb80808` (324px wide), in `.artifacts/lab/cases/policy.ndjson`.
- Rows: `.artifacts/lab/blink/policy-r1/chrome-rows.ndjson`. In `c-213e2818602b7033` Chrome's native lines are `ท` then
  `ู` (U+0E39, a combining vowel) on a line of its own, and `c-8299efa6cdb80808` natively starts line 2 at `ำ` (U+0E33).
  Blink's break-all table breaks between two Line_Break=SA characters (text_break_iterator.cc kBreakAllLineBreakClassTable
  row SA, and ShouldBreakAfterBreakAll), so the break lands inside the extended grapheme cluster.
- The Blink prediction starts the same lines at the same offsets, and the scorer reports `breaks` as "predicted line splits
  a grapheme".
- Expected: when the native lines themselves start inside a grapheme, the grapheme check shouldn't fail a prediction that
  starts at the same offset (compare against native starts, or mark those lines unobserved).

## Firefox: "predicted line splits a grapheme" where Firefox itself starts the line inside the lab's grapheme (Gecko owner, 2026-09-16)

- Cases: `c-4f0c9d3cd9d60735` (`क` and `्षत्रिय` in two spans), `c-a11286faf2988d0e` (`क्षत्रिय`), `c-a560dabf8d17cd2c` (bold `nai` +
  regular `̈ve`), in `.artifacts/lab/cases/runs.ndjson`. Rows: `.artifacts/lab/gecko/debug2/firefox-rows.ndjson`.
- Native: `c-4f0c9d3cd9d60735` has `क्` (offsets 31-32) on one line and `षत्रि` from offset 33 on the next; `c-a560dabf8d17cd2c` draws
  U+0308 (offset 12) alone on its own line with a positive rect. The Gecko port predicts the same starts (33; 12).
- The scorer's grapheme segmentation (the JS engine's `Intl.Segmenter`, Unicode 15.1+ conjunct rule GB9c; a mark joined to
  a base in another span) says these starts fall inside a grapheme and fails `breaks`. Firefox builds cluster starts per
  shaped word and forces a cluster start at each text run start (gfxFont.cpp:708-769, gfxTextRun.cpp:2824-2831).
- Expected: a predicted line start that equals a native line start isn't a split, whatever the lab's segmenter says.
- Same class for U+200C and U+200D (Gecko owner, 09:30): Firefox gives the base letter before a joiner a zero-width rect and the
  joiner the cluster's advance. `c-027754d73c591d1d` (`a­b‌b`, suite-sample): line 2's `b` (offset 2) is 0 au and U+200C (offset 3)
  534 au, so the line observes 0px where the Gecko port predicts 8.9px. About 600 suite-sample width and painter failures in
  `suite/U+200C/*`, `suite/U+200D/*` and `suite/woman-after-zwj/zwsp` are this, in `.artifacts/lab/gecko/suite-r1/`.
