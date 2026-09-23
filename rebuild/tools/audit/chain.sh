#!/bin/zsh
# The audit's knockout runs in one browser, one after another: the baseline and each knockout, predict-only, over the
# chat and real-text cases. Rows go to $OUT/<name>-<browser>/.
#   [NATIVE_BASE=1] [CHUNK=n] rebuild/tools/audit/chain.sh <browser> <out dir> <cases> base <knockout>...
browser=$1; out=$2; cases=$3; shift 3
tree=${0:A:h:h:h:h}
for name in "$@"; do
  if [ -f $out/$name-$browser/$browser-run.json ]; then echo "[chain] $name done already"; continue; fi
  if [ $name = base ]; then pred=$tree/rebuild/tools/audit/count-predictor.ts; else pred=$tree/rebuild/tools/audit/ko/$name.ts; fi
  mode=--predict-only
  # CHUNK=n: cases a round trip (1 for the book survey's whole books).
  chunk=${CHUNK:+--chunk=$CHUNK}
  # NATIVE_BASE=1: the baseline run also observes native layout, for sets no earlier run observed.
  if [ $name = base ] && [ "$NATIVE_BASE" = 1 ]; then mode=; fi
  echo "[chain] $(date +%H:%M:%S) $name"
  $tree/rebuild/tools/audit/lock-run.sh $browser audit-$name-$browser bun $tree/rebuild/lab/run.ts --browser=$browser --cases=$cases --out=$out/$name-$browser --predictor=$pred $mode $chunk --stall-ms=1800000 > $out/$name-$browser.log 2>&1
  echo "[chain] $(date +%H:%M:%S) $name exit $?"
done
