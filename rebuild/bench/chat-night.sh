#!/bin/sh
# The chat rows in the three background browsers, one after the other, each alone on the machine, then the summary across
# them (README.md, "Chat"):
#   rebuild/bench/chat-night.sh .artifacts/bench/night-YYYYMMDD [more run.ts arguments]
# Each browser runs once, whatever the one before it did; a failed run still writes its report and its log says why.
# --quiet-load=8: a run holds the lock and waits up to 15 minutes for the 1-minute load average to go under 8 before it
# launches its browser, then runs whatever the load is, and its report says which.
# `--browser=all --exclusive` is what makes the lock exclusive: with --exclusive alone the wrapper reads the browser from
# the command and takes one of that browser's slots.
set -u
if [ $# -lt 1 ]; then
  echo "Usage: rebuild/bench/chat-night.sh <out-dir> [more run.ts arguments]" >&2
  exit 2
fi
cd "$(dirname "$0")/../.." || exit 1
out=$1
shift
mkdir -p "$out"
status=0
for browser in chrome firefox webkit-host; do
  if python3 .artifacts/session/with-browser-lock.py "bench-chat-$browser" --browser=all --exclusive -- \
    bun rebuild/bench/run.ts --browser="$browser" --scenarios=chat --headline=10000 --quiet-load=8 --out="$out" "$@" > "$out/$browser.log" 2>&1; then
    code=0
  else
    code=$?
    status=1
  fi
  echo "[chat-night] $browser: exit $code; log $out/$browser.log"
done
reports=""
for browser in chrome firefox webkit-host; do
  if [ -f "$out/$browser-bench.json" ]; then reports="$reports $out/$browser-bench.json"; fi
done
if [ -z "$reports" ]; then
  echo "[chat-night] no browser report was written; see the logs" >&2
  exit 1
fi
# shellcheck disable=SC2086
if bun rebuild/bench/report.ts $reports > "$out/summary.md"; then
  echo "[chat-night] summary $out/summary.md"
else
  status=1
fi
exit "$status"
