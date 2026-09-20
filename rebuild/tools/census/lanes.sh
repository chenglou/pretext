#!/bin/bash
# lanes.sh <browser> [lanes=3]
# Runs every census chunk for one browser through run-chunk.sh, in <lanes> loops at the same time, each chunk under its own
# hold of one of the browser's lock slots. A loop claims the next unclaimed chunk with mkdir; chunks go longest first by the
# 2026-09-17 census's durations, so the loops end together. After a hold a loop waits 12 s, so other owners polling the lock
# get a turn. A failed chunk is logged in <out>/<browser>/failed.txt and the loop goes on; touch <out>/STOP2 to end the loops
# at their next chunk. Run it from the worktree's top folder; it returns when every loop has ended.
# Env: CHUNK_ORDER, the chunk names in another order (small chunks first once time runs short: they hold 99.5% of the cases).
set -u
OUT=.artifacts/census-20260919
OLD=.artifacts/research-20260916/census
browser=$1
lanes=${2:-3}
mkdir -p "$OUT/$browser"
order=${CHUNK_ORDER:-$(python3 -c "
import json
runs = json.load(open('$OLD/census.json'))['browsers']['$browser']['runs']
print(' '.join(sorted(runs, key=lambda n: -(runs[n]['rebuild']['durationMs'] or 0))))")}
lane() {
  for chunk in $order; do
    if [ -f "$OUT/STOP2" ]; then echo "== lane $1: STOP"; return; fi
    mkdir "$OUT/$browser/$chunk.claim" 2>/dev/null || continue
    python3 .artifacts/session/with-browser-lock.py "census-$browser-$chunk" --browser="$browser" --max-wait-min=240 -- \
      bash rebuild/tools/census/run-chunk.sh "$browser" "$chunk" 2>&1 | grep -a --line-buffered -v '^\[lock\] waiting'
    code=${PIPESTATUS[0]}
    echo "== $(date +%T) lane $1: $browser $chunk exit $code"
    if [ "$code" -ne 0 ]; then echo "$chunk exit $code" >> "$OUT/$browser/failed.txt"; fi
    python3 -c 'import time; time.sleep(12)'
  done
}
for k in $(seq 1 "$lanes"); do lane "$k" & done
wait
echo "== $(date +%T) lanes done: $browser"
