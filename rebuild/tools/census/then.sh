#!/bin/bash
# then.sh <browser>
# census.ts then for every chunk of one browser: the native views of 2026-09-17, read from that census's rows. Offline work;
# run it under one of the browser's lock slots so it never runs beside another owner's exclusive timed run.
set -u
OUT=.artifacts/census-20260919
browser=$1
for dir in "$OUT/$browser"/c*/; do
  chunk=$(basename "$dir")
  case $chunk in *.claim) continue;; esac
  [ -f "$dir/then.ndjson" ] && continue
  nice -n 10 bun rebuild/tools/census/census.ts then "$browser" "$chunk" || exit 1
done
