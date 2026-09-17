#!/bin/bash
# Per browser release (research/TEST-ARCHITECTURE.md §4.3): rerun an engine's probe sets, one short job per set under the
# shared browser lock, extract facts under the new build the runner records, and diff them against the previous build's
# facts file. A verdict flip or a missing fact exits 1 and blocks that engine's gate until triaged: the browser changed
# (read the new source, update specs and port), or the claim depends on process history (narrow its scope to fresh
# processes). Changed decisive values and new facts are reported.
#
#   bash rebuild/tests/rerun-probes.sh <chrome|webkit-host|firefox> <previous facts file> <out dir>
set -uo pipefail
browser=$1
previous=$2
out=$3
repo=$(cd "$(dirname "$0")/../.." && pwd)
lock="$HOME/github/pretext-rebuild/.artifacts/session/with-browser-lock.py"
cd "$repo" || exit 1
mkdir -p "$out"

case $browser in
  chrome) engine=blink; sets="blink-probes:probeSet=blink-probes" ;;
  webkit-host) engine=webkit; sets="webkit-probes:probeSet=webkit-probes" ;;
  firefox) engine=gecko; sets="gecko-probes:probeSet=gecko-probes,apd=30" ;;
  *) echo "unknown browser $browser"; exit 2 ;;
esac

inputs=""
for entry in $sets; do
  name=${entry%%:*}
  scope=${entry#*:}
  if ! python3 "$lock" "tests-probes-$browser-$name" --max-wait-min=240 -- bun rebuild/probes/runner.ts --browser="$browser" --probes="rebuild/probes/$name.ts" --out="$out/$name"; then
    echo "[probes] $name failed; stopping"
    exit 1
  fi
  bun rebuild/tests/facts.ts extract --output="$out/$name/$browser-probes.json" --engine="$engine" --scope="$scope" --out="$out/$name.facts.ndjson" || exit 1
  inputs="$inputs${inputs:+,}$out/$name.facts.ndjson"
done
build=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$out/${sets%%:*}/$browser-probes.json','utf8')).build.engine)")
bun rebuild/tests/facts.ts release --previous="$previous" --inputs="$inputs" --out="rebuild/facts/$engine/$build.ndjson" --report="$out/release-report.json"
