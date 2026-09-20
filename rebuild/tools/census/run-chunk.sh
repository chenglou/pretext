#!/bin/bash
# run-chunk.sh <browser> <chunk>
# One calibration chunk, run while the caller holds a browser lock slot, from the worktree's top folder:
# 1. native observation with today's library (the headline configuration: baselines/no-facts-predictor.ts);
# 2. main's predictions alone over the same case file (baselines/main-predictor.ts, --predict-only);
# 3. census.ts chunk (one record per case), then the rows are compressed.
# The case chunks are the census's of 2026-09-17 (.artifacts/research-20260916/census/cases/chunks), in file order with
# its round-trip sizes, so every case meets the document history it met then. A finished run is skipped. A stall stops
# the chunk with exit 3 and leaves the rows written so far; small chunks stall after 30 s without page activity, corpus
# chunks (one paragraph of up to 270,000 units a round trip) after 600 s.
# Env: CASES_FILE runs another case file under the chunk's name (real-text, rerun-file, rerun-reverse); ORDER=reverse.
set -u
CASES=.artifacts/research-20260916/census/cases/chunks
OUT=.artifacts/census-20260919
browser=$1
chunk=$2
cases=${CASES_FILE:-$CASES/$chunk.ndjson}
size=25
stall=30000
case $chunk in corpus*) size=1; stall=600000;; esac
for kind in rebuild main; do
  out=$OUT/$browser/$chunk/$kind
  if [ -f "$out/$browser-run.json" ] && grep -q '"status": "ok"' "$out/$browser-run.json"; then echo "skip $out"; continue; fi
  mkdir -p "$out"
  if [ "$kind" = rebuild ]; then
    set -- --predictor=rebuild/lab/baselines/no-facts-predictor.ts --stall-ms=$stall --order=${ORDER:-file}
  else
    set -- --predictor=rebuild/lab/baselines/main-predictor.ts --predict-only --stall-ms=$stall --order=${ORDER:-file}
  fi
  echo "== $(date +%T) $browser $chunk $kind"
  bun rebuild/lab/run.ts --browser="$browser" --cases="$cases" --out="$out" --chunk=$size "$@" > "$out/run.log" 2>&1
  code=$?
  grep -a -E '^\[lab\] .*(ok|error);' "$out/run.log" | tail -1
  if [ $code -ne 0 ]; then
    echo "FAILED ($code): $out"
    grep -a -E '^\[lab\] ' "$out/run.log" | tail -3
    if grep -a -q 'No page activity' "$out/run.log"; then exit 3; fi
    exit 1
  fi
done
# Scoring and compression stay inside the hold, so they never run beside another owner's exclusive timed run.
dir=$OUT/$browser/$chunk
if [ ! -f "$dir/cases.ndjson" ]; then
  echo "== $(date +%T) $browser $chunk scoring"
  bun rebuild/tools/census/census.ts chunk "$browser" "$chunk" > "$dir/census.log" 2>&1 || { echo "FAILED scoring: $dir"; tail -3 "$dir/census.log"; exit 1; }
fi
bash .artifacts/session/compress-rows.sh "census-20260919/$browser/$chunk"
