#!/bin/sh
# Builds and runs the WebKit break-data tools. Build products go to $BUILD (default: a scratch directory);
# data goes to ../ (rebuild/data/webkit).
#   icu-brk-dump-system    : links the system libicucore (Safari's ICU) with U_DISABLE_RENAMING=1 and
#                            Homebrew icu4c@78 headers (C API only).
#   icu-brk-dump-upstreamNN: links Homebrew upstream ICU NN (renamed symbols), for comparison.
#   break-tables-*         : verbatim BreakablePositions classify() and pair table from a WebKit checkout.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
DATA=$(cd "$HERE/.." && pwd)
BUILD=${BUILD:-${TMPDIR:-/tmp}/pretext-webkit-data-build}
WEBKIT=${WEBKIT:-$HOME/github/browser-engines/webkit-7625.1.29.11.27}
GROUNDWORK_WEBKIT=${GROUNDWORK_WEBKIT:-$HOME/github/browser-engines/pretext-emulation-20260915/research/webkit-safari}
mkdir -p "$BUILD"

clang -std=c11 -O1 -Wall -Wno-deprecated-declarations -DU_DISABLE_RENAMING=1 -I/opt/homebrew/opt/icu4c@78/include \
    "$HERE/icu_brk_dump.c" -licucore -framework CoreFoundation -o "$BUILD/icu-brk-dump-system"
for v in 76 77 78; do
    clang -std=c11 -O1 -Wall -Wno-deprecated-declarations -I/opt/homebrew/opt/icu4c@$v/include \
        "$HERE/icu_brk_dump.c" -L/opt/homebrew/opt/icu4c@$v/lib -licui18n -licuuc -licudata -framework CoreFoundation \
        -o "$BUILD/icu-brk-dump-upstream$v"
done

# System libicucore, as Safari's WebContent process would open it. The ICU default locale only matters for
# locales ICU has no data for (resource fallback goes to the default locale before root), so dump twice.
env -u LANG -u LC_ALL -u LC_CTYPE "$BUILD/icu-brk-dump-system" "$DATA/icu-macos27-libicucore" --label="macOS 27.0 (26A428) /usr/lib/libicucore.A.dylib, no LANG"
LANG=zh_CN.UTF-8 "$BUILD/icu-brk-dump-system" "$BUILD/icu-macos27-libicucore-LANG-zh_CN" --label="macOS 27.0 libicucore, LANG=zh_CN.UTF-8"
for v in 76 77 78; do
    env -u LANG -u LC_ALL -u LC_CTYPE "$BUILD/icu-brk-dump-upstream$v" "$BUILD/icu-upstream$v" --label="Homebrew icu4c@$v, no LANG"
done

mkdir -p "$DATA/breakable-positions"
python3 "$HERE/gen_break_tables.py" "$WEBKIT/Source/WebCore/rendering/BreakablePositions.h" "$WEBKIT/Source/WebCore/rendering/BreakablePositions.cpp" "$BUILD/break-tables-7625.cpp" "$DATA/breakable-positions/linebreak_table.inc" "WebKit-7625.1.29.11.27 (2756e8be58521b10c8e8bff8da1f13d97f2eae27)"
clang++ -std=c++20 -O1 -Wall -DU_DISABLE_RENAMING=1 -DU_SHOW_CPLUSPLUS_API=0 -I/opt/homebrew/opt/icu4c@78/include -I"$DATA/breakable-positions" \
    "$BUILD/break-tables-7625.cpp" -licucore -o "$BUILD/break-tables-7625"
"$BUILD/break-tables-7625" "$DATA/breakable-positions"

python3 "$HERE/gen_break_tables.py" "$GROUNDWORK_WEBKIT/Source/WebCore/rendering/BreakablePositions.h" "$GROUNDWORK_WEBKIT/Source/WebCore/rendering/BreakablePositions.cpp" "$BUILD/break-tables-7624.cpp" "$BUILD/linebreak_table-7624.inc" "safari-7624.2.5.11-branch (7c696f573290ed8ba774ff24f2dfda07af822a31)"
mkdir -p "$BUILD/breakable-positions-7624"
clang++ -std=c++20 -O1 -Wall -DU_DISABLE_RENAMING=1 -DU_SHOW_CPLUSPLUS_API=0 -I/opt/homebrew/opt/icu4c@78/include -I"$BUILD" \
    "$BUILD/break-tables-7624.cpp" -licucore -o "$BUILD/break-tables-7624"
"$BUILD/break-tables-7624" "$BUILD/breakable-positions-7624"
