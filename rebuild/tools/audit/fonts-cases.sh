#!/bin/zsh
# For each knockout whose cut fonts probe found families with differing lines: lab cases of those families at the
# probe's widths (tools/cut-fonts-cases.ts), observed natively with the baseline, predicted with the knockout, and scored.
#   rebuild/tools/audit/fonts-cases.sh <fonts dir> <knockout>...
dir=$1; shift
tree=${0:A:h:h:h:h}
for name in "$@"; do
  probe=$dir/$name/chrome-probes.json
  [ -f $probe ] || { echo "[fonts-cases] $name: no probe"; continue; }
  bun $tree/rebuild/tools/audit/fonts-summary.ts $dir/$name > $dir/$name/summary.txt
  families=$(python3 -c "import json; d=json.load(open('$dir/$name/summary.json')); print(','.join(f['family'] for f in d['familiesWithDifferences'][:40]))")
  if [ -z "$families" ]; then echo "[fonts-cases] $name: no family differs"; continue; fi
  bun $tree/rebuild/tools/cut-fonts-cases.ts --probe=$probe --families="$families" --out=$dir/$name/cases.ndjson > $dir/$name/cases.log 2>&1 || { echo "[fonts-cases] $name: cases failed"; continue; }
  mkdir -p $dir/$name/runs
  NATIVE_BASE=1 $tree/rebuild/tools/audit/chain.sh chrome $dir/$name/runs $dir/$name/cases.ndjson base $name > $dir/$name/runs.log 2>&1
  bun $tree/rebuild/tools/audit/eval.ts --base=$dir/$name/runs/base-chrome/chrome-rows.ndjson --ko=$dir/$name/runs/$name-chrome/chrome-rows.ndjson --native=$dir/$name/runs/base-chrome/chrome-rows.ndjson --all --json=$dir/$name/eval.json > $dir/$name/eval.txt 2>&1
  echo "[fonts-cases] $(date +%H:%M:%S) $name done: $(grep '(all)' $dir/$name/eval.txt | head -1)"
done
