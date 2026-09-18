#!/bin/bash
# Observes the rule families in one browser. derive.ts runs offline steps; every case file it asks for is observed with the
# no-prediction predictor through lab/sharded.ts, which cuts it into shards and runs them at the same time, each under the
# browser lock in its own browser instance (run.ts records the app bundle build in every row). Once the family cases exist,
# they run forward and in reverse with the real predictor, and both runs are scored against each other so history-dependent
# cases are known. One failed job stops the loop, and nothing runs twice.
#
#   bash rebuild/tests/observe-families.sh <chrome|webkit-host|firefox> <dir> [seed]
#
# Environment:
#   FAMILIES=a,b        derive only these families (read when the directory is first planned)
#   LAB_RUN_ARGS=...    more run.ts arguments for every job, such as --chrome-apple-languages=en-US --chrome-accept-languages=en-US,en
#   FINAL_RUNS=native   run the family cases forward and reverse with the no-prediction predictor into final/native-file and
#                       final/native-reverse, and compare only their native observations: for families whose inputs the
#                       engine ports don't implement yet, and for derivations made while the library is being changed
#   SHARDS=N            shards per case file (default: the browser's lock slots)
set -uo pipefail
browser=$1
dir=$2
seed=${3:-rule-families-20260916}
families=${FAMILIES:-}
extra=${LAB_RUN_ARGS:-}
final_runs=${FINAL_RUNS:-predict}
shards=${SHARDS:-}
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo" || exit 1

observe() {
  local cases=$1 out=$2 predictor=$3 order=$4 job=$5
  mkdir -p "$out"
  # shellcheck disable=SC2086
  bun rebuild/lab/sharded.ts --browser="$browser" --cases="$cases" --out="$out" --job="$job" ${shards:+--shards=$shards} -- --predictor="$predictor" --order="$order" $extra
}

derive_args=(--browser="$browser" --dir="$dir" --seed="$seed")
if [ -n "$families" ]; then derive_args+=(--families="$families"); fi

for step in $(seq 1 40); do
  pending=$(bun rebuild/tests/derive.ts "${derive_args[@]}")
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
predictor=rebuild/lab/predictor.ts
prefix=""
if [ "$final_runs" = native ]; then predictor=rebuild/tests/noop-predictor.ts; prefix="native-"; fi
for order in file reverse; do
  if ! observe "$final/family-cases.ndjson" "$final/$prefix$order" "$predictor" "$order" "tests-families-$browser-$prefix$order"; then
    echo "[families] final $prefix$order run failed; stopping"
    exit 1
  fi
done
for order in file reverse; do
  other=reverse
  if [ "$order" = reverse ]; then other=file; fi
  bun rebuild/lab/score.ts --rows="$final/$prefix$order/$browser-rows.ndjson" --cases="$final/family-cases.ndjson" \
    --out="$final/$prefix$order/$browser-summary.json" --per-case="$final/$prefix$order/$browser-per-case.ndjson" \
    --native-compare="$final/$prefix$other/$browser-rows.ndjson" --examples=5 || exit 1
done
echo "[families] $browser done: $final"
