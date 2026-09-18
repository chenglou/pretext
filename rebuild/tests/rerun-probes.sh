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
sysui-domfirst-dpr2|chrome|blink-probes-sysui-domfirst|probeSet=blink-probes-sysui-domfirst,process=fresh||" ;;
  webkit-host)
    engine=webkit
    sets="webkit-host|webkit-host|webkit-probes|probeSet=webkit-probes||"
    if [ "${ALLOW_SAFARI:-0}" = 1 ]; then sets="$sets
safari|safari|webkit-probes|probeSet=webkit-probes||--allow-safari-frontmost"; fi ;;
  firefox)
    engine=gecko
    sets="main|firefox|gecko-probes|probeSet=gecko-probes,apd=30||
followup|firefox|gecko-probes|probeSet=gecko-probes-followup,apd=30||--only=H3b"
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
