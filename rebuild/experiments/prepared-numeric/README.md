# Direct numeric plaintext experiment

This two-module laboratory keeps the direct constructor and one selected
numeric count/range counter. It is not a public API or a replacement for general
plaintext layout. The full generators, previous candidates and original
native/performance evidence belong in the external archive linked by the
accompanying experiment report.

`prepareDirectWord()` accepts a literal ASCII word under its explicit policy
guards. It uses existing exported redo helpers for font learning, style and
Canvas setup, then measures each distinct letter/pair plus the whole word.
Nonzero pairs, a whole-width residual, declared per-font coverage/cluster facts,
saturation and omitted source policies remain explicit unsupported results.
Matching local/whole measurements is an empirical qualification, not proof for
every arbitrary font program. Native cut/count checks remain necessary.

The returned value retains numeric positions, total width and zoom. The counter
reads those numbers at arbitrary widths, with no Canvas, DOM, source strings,
line records or mutable width history. Optional caller-owned output records
source end offsets; it does not establish complete native line geometry.

Place this folder at `rebuild/experiments/prepared-numeric`. Imports go directly
to `../../src`; every used helper is already exported. No engine copy, source
patch, setup generator or intermediate staging tree is needed.

```sh
bun node_modules/typescript/bin/tsc --noEmit --project rebuild/experiments/prepared-numeric/tsconfig.json
```

`exact-count.ts` bounds its search forward from the current line start, then
bisects that interval. It keeps the original Chrome width conversion, one raw
LayoutUnit allowance, saturated arithmetic, whole admission and mandatory source
progress. On qualified sorted positions the total comparison work is O(N) per
width, with no extra retained column; wide-line searches remain logarithmic.
The historical whole-suffix bisection and plain scan are in the external archive.

The constructor body is unchanged from the frozen direct control; only its
imports changed. The selected counter body matches the independently checked
bracket prototype. Fresh strict/native validation for these direct engine
imports is recorded in the accompanying round report. The returned kind means
that the numerical model was constructed, not that arbitrary font behavior was
certified. No general plaintext fallback calls Canvas from this loop.
