#!/bin/bash
# Per browser release (research/TEST-ARCHITECTURE.md §4.3): rerun an engine's probe sets, every set the previous build's
# facts file holds, each as one short job under the browser lock and all at the same time (the lock gives a browser three
# slots). Then extract facts under the build the runner records and diff them against the previous build's facts file. A
# verdict flip or a missing fact exits 1 and blocks that engine's gate until triaged: the browser changed (read the new
# source, update specs and port), or the claim depends on process history (narrow its scope to fresh processes). Changed
# decisive values and new facts are reported. A failed job stops the script before anything is extracted; nothing runs twice.
#
#   bash rebuild/tests/rerun-probes.sh <chrome|webkit-host|firefox> <previous facts file> <out dir>
#
# webkit-host's release also takes installed Safari's probe set when ALLOW_SAFARI=1 (one job under 8 minutes, opened with
# --allow-safari-frontmost); without it the release reports Safari's facts as missing.
set -uo pipefail
browser=$1
previous=$2
out=$3
repo=$(cd "$(dirname "$0")/../.." && pwd)
lock="$HOME/github/pretext-rebuild/.artifacts/session/with-browser-lock.py"
cd "$repo" || exit 1
mkdir -p "$out"

# One set per line: name | browser | probes module | scope | environment | more runner arguments.
case $browser in
  chrome)
    engine=blink
    sets="dpr2|chrome|blink-probes|probeSet=blink-probes||--probe-timeout-ms=60000
dpr1|chrome|blink-probes|probeSet=blink-probes,forcedDpr=1||--probe-timeout-ms=60000 --chrome-args=--force-device-scale-factor=1
dsf3.5|chrome|blink-probes-zoom|probeSet=blink-probes-zoom,forcedDpr=3.5||--chrome-args=--force-device-scale-factor=3.5
emulated|chrome|blink-probes-zoom|probeSet=blink-probes-zoom,emulatedDpr=2||--chrome-args=--force-device-scale-factor=1 --chrome-emulate-dsf=2
sysui-dpr2|chrome|blink-probes-sysui|probeSet=blink-probes-sysui,process=fresh||
sysui-dpr1|chrome|blink-probes-sysui|probeSet=blink-probes-sysui,process=fresh,forcedDpr=1||--chrome-args=--force-device-scale-factor=1
sysui-domfirst-dpr2|chrome|blink-probes-sysui-domfirst|probeSet=blink-probes-sysui-domfirst,process=fresh||
storage|chrome|blink-storage|probeSet=blink-storage||--probe-timeout-ms=120000" ;;
  webkit-host)
    engine=webkit
    # round4: the WebKit owner's round 4 probes (R7, R8, R10 to R14) return raw values alone, so each gives one undecided fact
    # that holds its record's hash (facts.ts): a release reports when the browser's answers changed. R14 takes about a minute.
    sets="webkit-host|webkit-host|webkit-probes|probeSet=webkit-probes||
round4|webkit-host|webkit-round4|probeSet=webkit-round4||--probe-timeout-ms=240000 --stall-ms=300000"
    if [ "${ALLOW_SAFARI:-0}" = 1 ]; then sets="$sets
safari|safari|webkit-probes|probeSet=webkit-probes||--allow-safari-frontmost"; fi ;;
  firefox)
    engine=gecko
    # round2 to round4: the Gecko owner's follow-up probes F7 to F27 (rebuild/probes/gecko-round*.ts), which return checks
    # since ceiling round 4: 83 facts in rebuild/facts/gecko/156.0.ndjson.
    sets="main|firefox|gecko-probes|probeSet=gecko-probes,apd=30||
followup|firefox|gecko-probes|probeSet=gecko-probes-followup,apd=30||--only=H3b
round2|firefox|gecko-round2|probeSet=gecko-round2,apd=30||
round2b|firefox|gecko-round2b|probeSet=gecko-round2b,apd=30||
round3|firefox|gecko-round3|probeSet=gecko-round3,apd=30||--probe-timeout-ms=240000
round4|firefox|gecko-round4|probeSet=gecko-round4,apd=30||--probe-timeout-ms=240000"
    for entry in 60:1.0 40:1.5 27:2.2222222 23:2.6086957; do
      printf '{ "layout.css.devPixelsPerPx": "%s" }\n' "${entry#*:}" > "$out/prefs-apd${entry%%:*}.json"
      sets="$sets
apd${entry%%:*}|firefox|gecko-probes|probeSet=gecko-probes,apd=${entry%%:*}|GECKO_PROBE_SET=apd|--firefox-prefs=$out/prefs-apd${entry%%:*}.json"
    done ;;
  *) echo "unknown browser $browser"; exit 2 ;;
esac

pids=""
while IFS='|' read -r name set_browser module scope environment arguments; do
  # No argument holds a space, so the unquoted expansions split into whole arguments.
  # shellcheck disable=SC2086
  env $environment python3 "$lock" "tests-probes-$set_browser-$name" --max-wait-min=240 -- bun rebuild/probes/runner.ts --browser="$set_browser" \
    --probes="rebuild/probes/$module.ts" --out="$out/$name" $arguments > "$out/$name.log" 2>&1 &
  pids="$pids $!:$name"
done <<< "$sets"
failed=""
for entry in $pids; do
  if ! wait "${entry%%:*}"; then failed="$failed ${entry#*:}"; fi
done
if [ -n "$failed" ]; then echo "[probes] failed:$failed; see $out/<set>.log. Nothing was extracted, and nothing runs again"; exit 1; fi

inputs=""
build=""
while IFS='|' read -r name set_browser module scope environment arguments; do
  bun rebuild/tests/facts.ts extract --output="$out/$name/$set_browser-probes.json" --engine="$engine" --scope="$scope" --out="$out/$name.facts.ndjson" || exit 1
  inputs="$inputs${inputs:+,}$out/$name.facts.ndjson"
  set_build=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$out/$name/$set_browser-probes.json','utf8')).build.engine)")
  if [ -n "$build" ] && [ "$build" != "$set_build" ]; then echo "[probes] $name ran build $set_build, earlier sets $build"; exit 1; fi
  build=$set_build
done <<< "$sets"
bun rebuild/tests/facts.ts release --previous="$previous" --inputs="$inputs" --out="rebuild/facts/$engine/$build.ndjson" --report="$out/release-report.json"
