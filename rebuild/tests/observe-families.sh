#!/bin/bash
# Observes the rule families in one browser. derive.ts runs offline steps; every case file it asks for is observed under
# the shared browser lock with the no-prediction predictor, one short job per file (run.ts records the app bundle build
# in every row). Once the family cases exist, they run forward and in reverse with the real predictor, and both runs are
# scored against each other so history-dependent cases are known. One failed launch stops the loop.
#
#   bash rebuild/tests/observe-families.sh <chrome|webkit-host|firefox> <dir> [seed]
set -uo pipefail
browser=$1
dir=$2
seed=${3:-rule-families-20260916}
repo=$(cd "$(dirname "$0")/../.." && pwd)
lock="$HOME/github/pretext-rebuild/.artifacts/session/with-browser-lock.py"
cd "$repo" || exit 1

observe() {
  local cases=$1 out=$2 predictor=$3 order=$4 job=$5
  mkdir -p "$out"
  python3 "$lock" "$job" --max-wait-min=240 -- bun rebuild/lab/run.ts --browser="$browser" --cases="$cases" --out="$out" --predictor="$predictor" --order="$order"
}

for step in $(seq 1 40); do
  pending=$(bun rebuild/tests/derive.ts --browser="$browser" --dir="$dir" --seed="$seed")
  code=$?
  if [ $code -eq 0 ]; then break; fi
  if [ $code -ne 10 ]; then echo "[families] derive failed with exit $code"; exit 1; fi
  for cases in $pending; do
    index=$(basename "$cases" .ndjson)
    out="$(dirname "$cases")/observed-${index#cases-}"
    echo "[families] $browser step $step: observing $cases ($(wc -l < "$cases" | tr -d ' ') cases)"
    if ! observe "$cases" "$out" rebuild/tests/noop-predictor.ts file "tests-families-$browser"; then
      echo "[families] observation failed: $cases; stopping"
      exit 1
    fi
  done
done

final="$dir/final"
if [ ! -f "$final/family-cases.ndjson" ]; then echo "[families] no family cases after 40 steps"; exit 1; fi
for order in file reverse; do
  if ! observe "$final/family-cases.ndjson" "$final/$order" rebuild/lab/predictor.ts "$order" "tests-families-$browser-$order"; then
    echo "[families] final $order run failed; stopping"
    exit 1
  fi
done
for order in file reverse; do
  other=reverse
  if [ "$order" = reverse ]; then other=file; fi
  bun rebuild/lab/score.ts --rows="$final/$order/$browser-rows.ndjson" --cases="$final/family-cases.ndjson" \
    --out="$final/$order/$browser-summary.json" --per-case="$final/$order/$browser-per-case.ndjson" \
    --native-compare="$final/$other/$browser-rows.ndjson" --examples=5 || exit 1
done
echo "[families] $browser done: $final"
