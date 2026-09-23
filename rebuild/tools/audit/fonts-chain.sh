#!/bin/zsh
# The cut fonts probe for each Blink cut knockout, one after another in Chrome, base = the clean audit checkout, head = the
# scratch tree with the switches (tools/audit/cut-fonts-ko-probe.ts). Output goes to <out>/<knockout>/.
#   rebuild/tools/audit/fonts-chain.sh <out dir> <knockout>...
out=$1; shift
tree=${0:A:h:h:h:h}
base=$HOME/github/pretext-rebuild-wt/audit
fonts=$HOME/github/pretext-rebuild/.artifacts/tests/runs/b1b-fonts-20260920/families.json
for name in "$@"; do
  if [ -f $out/$name/summary.json ]; then echo "[fonts] $name done already"; continue; fi
  mkdir -p $out/$name
  # The switches of the knockout's predictor (a combination names several).
  flags=$(grep -o "'[A-Za-z0-9-]*': true" $tree/rebuild/tools/audit/ko/$name.ts | sed "s/'//g; s/: true//" | paste -sd+ -)
  echo "[fonts] $(date +%H:%M:%S) $name ($flags)"
  CUT_KO=$flags CUT_TREE_A=$base CUT_TREE_B=$tree CUT_FONTS=$fonts $tree/rebuild/tools/audit/lock-run.sh chrome audit-fonts-$name bun $tree/rebuild/probes/runner.ts --browser=chrome --probes=$tree/rebuild/tools/audit/cut-fonts-ko-probe.ts --out=$out/$name --probe-timeout-ms=3000000 --stall-ms=3000000 > $out/$name.log 2>&1
  echo "[fonts] $(date +%H:%M:%S) $name exit $?"
done
