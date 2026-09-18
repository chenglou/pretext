#!/bin/bash
# Pins a browser for the lab: a private byte-identical copy of the installed bundle, so an update of /Applications can't
# change the build a round observes (Chrome went from 153.0.8010.48 to .50 in the middle of ceiling round 2). The installed
# app isn't touched, and the copy isn't edited.
#
#   bash rebuild/lab/pin-browser.sh chrome|firefox
#
# ditto clones the files on APFS, so the copy costs no disk until the installed app changes. The script then hashes both
# trees (every file's path and sha256, every link's target) and refuses a copy that differs. It writes the hash beside the
# copy as <copy>.tree-sha256, which run.ts and probes/runner.ts record with the app path. Point browser-build.ts LAB_APPS
# at the new copy afterwards (TESTS.md §12).
#
# Chrome's updater keeps one path per app id, and a Chrome running from another path registers that path 19 s after it
# starts unless it runs with --disable-updater-scheduler (chrome_browser_main.cc PreCreateMainMessageLoop,
# browser_updater_client_util_mac.mm EnsureUpdater, browser_updater_client_mac.mm AppMatches, read at Chromium 152; the
# switch is in 153.0.8010.50's framework binary). The lab and the probe runner always pass it. Don't start the copy by hand
# without it: the updater would then update the copy and leave the installed Chrome alone until it runs again.
set -euo pipefail
case ${1:-} in
  chrome) installed="/Applications/Google Chrome.app"; name="Google Chrome" ;;
  firefox) installed="/Applications/Firefox.app"; name="Firefox" ;;
  *) echo "Usage: bash rebuild/lab/pin-browser.sh chrome|firefox"; exit 2 ;;
esac
apps="$HOME/github/browser-engines/apps"
version=$(plutil -extract CFBundleShortVersionString raw -o - "$installed/Contents/Info.plist")
copy="$apps/$name $version.app"

tree_hash() {
  (cd "$1" && {
    find . -type f -print0 | sort -z | xargs -0 shasum -a 256
    find . -type l -print0 | sort -z | while IFS= read -r -d '' link; do printf 'link %s -> %s\n' "$link" "$(readlink "$link")"; done
  } | shasum -a 256 | cut -d' ' -f1)
}

mkdir -p "$apps"
if [ -e "$copy" ]; then
  echo "[pin] $copy exists; checking it against the installed $name $version"
else
  ditto "$installed" "$copy"
fi
installed_hash=$(tree_hash "$installed")
copy_hash=$(tree_hash "$copy")
if [ "$installed_hash" != "$copy_hash" ]; then
  echo "[pin] $copy ($copy_hash) differs from $installed ($installed_hash)"
  exit 1
fi
printf '%s\n' "$copy_hash" > "$copy.tree-sha256"
echo "[pin] $copy: $name $version, tree sha256 $copy_hash"
