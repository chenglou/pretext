#!/bin/bash
# Pins a browser for the lab: a private copy of the installed bundle, so an update of /Applications can't change the build
# a round observes (Chrome went from 153.0.8010.48 to .50 in the middle of ceiling round 2). The installed app isn't
# touched, and the copy is byte-identical to it except for the update policy a Firefox copy gets (below).
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
# switch is in the framework binaries of 153.0.8010.50 and 154.0.8037.57). The lab and the probe runner always pass it.
# Don't start the copy by hand without it: the updater would then update the copy and leave the installed Chrome alone
# until it runs again.
#
# Firefox updates the bundle it runs from, and a release build takes the update policy only from the bundle or the system
# (UpdateServiceStub.sys.mjs updateDisabled). The lab's profiles turn updates off, but a launch under the default profile
# doesn't: after a crash on 2026-09-25 macOS reopened the pinned 156.0 copy at login, and Firefox updated it to 156.0.1.
# So a Firefox copy gets Contents/Resources/distribution/policies.json with DisableAppUpdate, and its tree hash includes
# that file. The file breaks the bundle's resource seal (codesign --verify fails); the executables' signatures are intact,
# and the copy, which carries no quarantine, launches through LaunchServices as before. The check against the installed
# bundle leaves the policy file out. The policy goes in before the copy's first launch: from then on macOS's App
# Management refuses other apps' writes inside the bundle ("Operation not permitted"), so the script writes it only when
# it isn't there.
set -euo pipefail
# The hash sorts paths bytewise. Sorted under a UTF-8 locale, the same tree hashes otherwise: the hashes written on
# 2026-09-17 (Chrome 153.0.8010.50's 712aa9f5..., Firefox 156.0's 30499e6f...) were, and under the C locale the
# unchanged Chrome copy hashes to 2abf470a....
export LC_ALL=C
case ${1:-} in
  chrome) installed="/Applications/Google Chrome.app"; name="Google Chrome" ;;
  firefox) installed="/Applications/Firefox.app"; name="Firefox" ;;
  *) echo "Usage: bash rebuild/lab/pin-browser.sh chrome|firefox"; exit 2 ;;
esac
apps="$HOME/github/browser-engines/apps"
version=$(plutil -extract CFBundleShortVersionString raw -o - "$installed/Contents/Info.plist")
copy="$apps/$name $version.app"
policy="Contents/Resources/distribution/policies.json"

# The tree's hash, leaving out the file named by $2 when there is one.
tree_hash() {
  (cd "$1" && {
    find . -type f ! -path "./${2:-}" -print0 | sort -z | xargs -0 shasum -a 256
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
copy_hash=$(tree_hash "$copy" "$policy")
if [ "$installed_hash" != "$copy_hash" ]; then
  echo "[pin] $copy ($copy_hash) differs from $installed ($installed_hash)"
  exit 1
fi
if [ "$1" = firefox ]; then
  rule='{"policies": {"DisableAppUpdate": true}}'
  if [ "$(cat "$copy/$policy" 2>/dev/null)" != "$rule" ]; then
    mkdir -p "$copy/Contents/Resources/distribution"
    printf '%s\n' "$rule" > "$copy/$policy"
  fi
  copy_hash=$(tree_hash "$copy")
fi
printf '%s\n' "$copy_hash" > "$copy.tree-sha256"
echo "[pin] $copy: $name $version, tree sha256 $copy_hash"
