#!/bin/sh
# Builds main.swift into .artifacts/webkit-host/webkit-host. Building launches nothing.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out="$(cd "$here/../.." && pwd)/.artifacts/webkit-host"
mkdir -p "$out"
# WebKit turns on behaviours by the app's linked SDK version, all of them for Safari (computeSDKAlignedBehaviors in
# Source/WTF/wtf/cocoa/RuntimeApplicationChecksCocoa.mm), so the host records installed Safari's SDK version.
safari_sdk=$(otool -l /Applications/Safari.app/Contents/MacOS/Safari | awk '/cmd LC_BUILD_VERSION/ { found = 1 } found && $1 == "sdk" { print $2; exit }')
[ -n "$safari_sdk" ] || { echo "build.sh: could not read Safari's linked SDK version" >&2; exit 1; }
sdk=$(xcrun --show-sdk-version)
cat > "$out/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.pretext.harness.webkit-host</string>
  <key>CFBundleName</key><string>webkit-host</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
xcrun swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos$sdk" "$here/main.swift" -o "$out/webkit-host" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$out/Info.plist" \
  -Xlinker -platform_version -Xlinker macos -Xlinker "$sdk" -Xlinker "$safari_sdk"
# The harness runs only a host built from main.swift as it is (harness/browsers.ts).
shasum -a 256 "$here/main.swift" | cut -d' ' -f1 > "$out/webkit-host.source-sha256"
echo "build.sh: $out/webkit-host (SDK $sdk, Safari's SDK $safari_sdk)"
