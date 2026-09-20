#!/bin/bash
# sample-run.sh <browser> <cases.ndjson> <sample folder>
# Runs a sample's cases the way the census ran its reruns (run-chunk.sh with CASES_FILE and ORDER): the headline predictor
# with native observation, then main's predictions alone, in file order and reversed, each in a fresh browser process, 25
# cases a round trip; then one record per case (census.ts chunk --out). The caller holds one of the browser's lock slots.
# Rows land in <sample folder>/<browser>/{file,reverse}/{rebuild,main}. Run it from the worktree's top folder.
set -u
browser=$1
cases=$2
out=$3
for order in file reverse; do
  for kind in rebuild main; do
    dir=$out/$browser/$order/$kind
    mkdir -p "$dir"
    if [ "$kind" = rebuild ]; then
      set -- --predictor=rebuild/lab/baselines/no-facts-predictor.ts
    else
      set -- --predictor=rebuild/lab/baselines/main-predictor.ts --predict-only
    fi
    echo "== $(date +%T) $browser $order $kind"
    bun rebuild/lab/run.ts --browser="$browser" --cases="$cases" --out="$dir" --chunk=25 --stall-ms=30000 --order=$order "$@" > "$dir/run.log" 2>&1
    code=$?
    echo "== $(date +%T) $browser $order $kind exit $code"
    if [ $code -ne 0 ]; then exit $code; fi
  done
  bun rebuild/tools/census/census.ts chunk "$browser" "$order" --out="$out" || exit 1
done
