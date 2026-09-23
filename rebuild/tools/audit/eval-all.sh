#!/bin/zsh
# Evaluates every finished knockout run of a browser in one folder against the folder's baseline run, into
# <dir>/eval/<name>-<browser>.{txt,json}. Natives: the given rows files, or by default the chat natives of the recording
# run and the census's real-text natives.
#   rebuild/tools/audit/eval-all.sh <browser> <dir> [<native rows>[,<native rows>...]]
browser=$1; ko=$2; given=$3
tree=${0:A:h:h:h:h}
natives=${given:-$tree/.artifacts/audit/runs/record-$browser/$browser-rows.ndjson,$HOME/github/pretext-rebuild/.artifacts/census-20260919/$browser/real-text/rebuild/$browser-rows.ndjson.zst}
mkdir -p $ko/eval
for run in $ko/*-$browser; do
  name=${${run:t}%-$browser}
  [ $name = base ] && continue
  [ -f $run/$browser-run.json ] || continue
  [ -f $ko/eval/$name-$browser.json ] && continue
  bun $tree/rebuild/tools/audit/eval.ts --base=$ko/base-$browser/$browser-rows.ndjson --ko=$run/$browser-rows.ndjson --native=$natives --json=$ko/eval/$name-$browser.json > $ko/eval/$name-$browser.txt 2>&1
  echo "== $name"; grep -v "^   " $ko/eval/$name-$browser.txt | grep "(all)\|80px"
done
