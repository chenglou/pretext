#!/bin/zsh
# Runs a browser job of the audit under the rebuild's browser lock (a slot of the browser), after waiting until no other
# audit job holds a slot of the same browser, so no two of the audit's checkers run on one browser at once. Other
# jobs on the machine take their own slots, as the lock allows.
#   rebuild/tools/audit/lock-run.sh <browser> <job-name> <command...>
browser=$1; job=$2; shift 2
root=/private/tmp/pretext-eng-20260912
waited=0
mine() { grep -l '"job": "audit-' $root/browser-lock-$browser-*.owner 2>/dev/null | head -1 }
while [ -n "$(mine)" ] || [ -d $root/browser-lock ]; do
  if [ $waited -eq 0 ]; then echo "[audit] waiting for another audit $browser job or an exclusive job"; fi
  sleep 20; waited=$((waited+20))
  if [ $waited -gt 10800 ]; then echo "[audit] gave up after 3h"; exit 75; fi
done
exec python3 $HOME/github/pretext-rebuild/.artifacts/session/with-browser-lock.py $job --browser=$browser -- "$@"
