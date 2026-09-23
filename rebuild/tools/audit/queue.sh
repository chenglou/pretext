#!/bin/zsh
# Runs audit chains one after another for one browser, after the process `wait` names has exited:
#   rebuild/tools/audit/queue.sh <browser> <wait pid> <out dir>:<cases>:<native 0|1>:<name,name,...> ...
browser=$1; waitpid=$2; shift 2
tree=${0:A:h:h:h:h}
while kill -0 $waitpid 2>/dev/null; do sleep 20; done
for step in "$@"; do
  IFS=: read out cases native names <<< "$step"
  mkdir -p $out
  NATIVE_BASE=$native $tree/rebuild/tools/audit/chain.sh $browser $out $cases ${(s:,:)names} >> $out/chain-$browser.log 2>&1
done
