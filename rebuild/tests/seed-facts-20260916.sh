#!/bin/bash
# Seeds rebuild/facts from the probe outputs recorded on 2026-09-16, before the probe runner recorded builds, so each
# extract takes its build as given: Chrome 153.0.8010.48, WebKit.framework 22625.1.29.11.27 (webkit-host and installed
# Safari 27.0), Firefox 156.0, all on macOS 27 (26A428). Every output gets a scope naming its probe set and the process or
# DPR setup it ran under, so reruns of one probe in two setups stay two facts.
#
#   bash rebuild/tests/seed-facts-20260916.sh
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"
probes=.artifacts/probes
work=.artifacts/charter-20260916/tests/facts-20260916
mkdir -p "$work" rebuild/facts/blink rebuild/facts/webkit rebuild/facts/gecko

extract() {
  local engine=$1 build=$2 output=$3 scope=$4 name=$5
  if [ ! -f "$output" ]; then echo "[facts] missing $output; skipped"; return 0; fi
  bun rebuild/tests/facts.ts extract --output="$output" --engine="$engine" --build="$build" --scope="$scope" --out="$work/$name.ndjson"
}

extract blink 153.0.8010.48 $probes/blink/dpr2/chrome-probes.json probeSet=blink-probes blink-dpr2
extract blink 153.0.8010.48 $probes/blink/dpr1/chrome-probes.json probeSet=blink-probes,forcedDpr=1 blink-dpr1
extract blink 153.0.8010.48 $probes/blink/dsf3.5/chrome-probes.json probeSet=blink-probes-zoom,forcedDpr=3.5 blink-dsf35
extract blink 153.0.8010.48 $probes/blink/emulated/chrome-probes.json probeSet=blink-probes-zoom,emulatedDpr=2 blink-emulated
extract blink 153.0.8010.48 $probes/blink/sysui-dpr2/chrome-probes.json probeSet=blink-probes-sysui,process=fresh blink-sysui-dpr2
extract blink 153.0.8010.48 $probes/blink/sysui-dpr1/chrome-probes.json probeSet=blink-probes-sysui,process=fresh,forcedDpr=1 blink-sysui-dpr1
extract blink 153.0.8010.48 $probes/blink/sysui-domfirst-dpr2/chrome-probes.json probeSet=blink-probes-sysui-domfirst,process=fresh blink-sysui-domfirst
extract blink 153.0.8010.48 $probes/blink/followups/chrome-probes.json probeSet=blink-followups blink-followups
extract blink 153.0.8010.48 $probes/blink/gaps/chrome-probes.json probeSet=blink-gaps-probes blink-gaps
bun rebuild/tests/facts.ts merge --inputs="$(ls $work/blink-*.ndjson | paste -sd, -)" --out=rebuild/facts/blink/153.0.8010.48.ndjson

extract webkit 22625.1.29.11.27 $probes/webkit/webkit-host-probes.json probeSet=webkit-probes webkit-host
extract webkit 22625.1.29.11.27 $probes/webkit/installed-safari/webkit-probes/safari-probes.json probeSet=webkit-probes webkit-safari
extract webkit 22625.1.29.11.27 $probes/webkit/followups/webkit-host-probes.json probeSet=webkit-followups webkit-followups
extract webkit 22625.1.29.11.27 $probes/webkit/followups-b5/webkit-host-probes.json probeSet=webkit-followups-b5 webkit-followups-b5
bun rebuild/tests/facts.ts merge --inputs="$(ls $work/webkit-*.ndjson | paste -sd, -)" --out=rebuild/facts/webkit/22625.1.29.11.27.ndjson

extract gecko 156.0 $probes/gecko/main/firefox-probes.json probeSet=gecko-probes,apd=30 gecko-main
for apd in 60 40 27 23; do
  extract gecko 156.0 $probes/gecko/apd$apd/firefox-probes.json probeSet=gecko-probes,apd=$apd gecko-apd$apd
done
extract gecko 156.0 $probes/gecko/followup/firefox-probes.json probeSet=gecko-probes-followup,apd=30 gecko-followup
extract gecko 156.0 $probes/gecko/followups/firefox-probes.json probeSet=gecko-followups,apd=30 gecko-followups
extract gecko 156.0 $probes/gecko/followups-f2/firefox-probes.json probeSet=gecko-followups-f2,apd=30 gecko-followups-f2
extract gecko 156.0 $probes/gecko/emoji-font/firefox-probes.json probeSet=gecko-emoji-font,apd=30 gecko-emoji-font
bun rebuild/tests/facts.ts merge --inputs="$(ls $work/gecko-*.ndjson | paste -sd, -)" --out=rebuild/facts/gecko/156.0.ndjson

# Cross-setup diffs: the same probe set in two environments, compared on the probe set only.
bun rebuild/tests/facts.ts diff --before="$work/webkit-host.ndjson" --after="$work/webkit-safari.ndjson" --match-scope=probeSet --out="$work/diff-webkit-host-vs-safari.json" || true
bun rebuild/tests/facts.ts diff --before="$work/blink-dpr2.ndjson" --after="$work/blink-dpr1.ndjson" --match-scope=probeSet --out="$work/diff-blink-dpr2-vs-dpr1.json" || true
bun rebuild/tests/facts.ts diff --before="$work/gecko-main.ndjson" --after="$work/gecko-apd60.ndjson" --match-scope=probeSet --out="$work/diff-gecko-apd30-vs-apd60.json" || true
