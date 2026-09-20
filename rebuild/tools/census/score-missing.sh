#!/bin/bash
# score-missing.sh [<browser>/<chunk>...]
# Scores and compresses every chunk whose two runs finished ok and that has no cases.ndjson yet (chunks that ran before
# run-chunk.sh scored inside the hold, or whose scoring was cut off): the named ones, or all of them. One at a time, at low
# priority, from the worktree's top folder; never name a chunk a lane still holds.
set -u
OUT=.artifacts/census-20260919
if [ $# -eq 0 ]; then set -- $(cd "$OUT" && ls -d chrome/*/ firefox/*/ webkit-host/*/ 2>/dev/null); fi
for name in "$@"; do
  dir=$OUT/${name%/}
  browser=$(basename "$(dirname "$dir")")
  chunk=$(basename "$dir")
  [ -f "$dir/cases.ndjson" ] && continue
  grep -q '"status": "ok"' "$dir/rebuild/$browser-run.json" 2>/dev/null || continue
  grep -q '"status": "ok"' "$dir/main/$browser-run.json" 2>/dev/null || continue
  echo "== $(date +%T) scoring $browser $chunk"
  nice -n 10 bun rebuild/tools/census/census.ts chunk "$browser" "$chunk" > "$dir/census.log" 2>&1 || { echo "FAILED scoring: $dir"; tail -3 "$dir/census.log"; continue; }
  bash .artifacts/session/compress-rows.sh "census-20260919/$browser/$chunk"
done
