# The second reader's hb-shape survey of lam + alef in font files, for the x-lam-alef study only (the library reads no font):
# whether lam and the alef share one glyph cluster alone, after beh, with a fatha between, before alef madda, and with liga,
# clig and calt off (what Blink sets under a letter spacing, font_features.cc:54-86).
#   python3 rebuild/tools/cluster-default/font-survey.py <font file> ...
import subprocess, sys, glob, json
TESTS = [('isolated', [0x644, 0x627], []), ('final', [0x628, 0x644, 0x627, 0x628], []), ('mark between', [0x628, 0x644, 0x64e, 0x627], []), ('alef madda', [0x644, 0x622], []), ('spaced features', [0x628, 0x644, 0x627], ['--features=liga=0,clig=0,calt=0'])]
for f in sorted(sys.argv[1:]):
    row = []
    for name, cps, extra in TESTS:
        out = subprocess.run(['hb-shape', '--output-format=json', '--no-glyph-names'] + extra + [f, '--unicodes=' + ','.join('U+%04X' % c for c in cps)], capture_output=True, text=True).stdout
        glyphs = json.loads(out)
        lam = cps.index(0x644)
        alef = [i for i, c in enumerate(cps) if c in (0x627, 0x622)][0]
        clusters = sorted({g['cl'] for g in glyphs})
        notdef = any(g['g'] == 0 for g in glyphs)
        # one cluster when no glyph cluster starts after lam and at or before the alef
        one = not any(lam < c <= alef for c in clusters)
        row.append('NOT IN FONT' if notdef else 'one' if one else 'two')
    print(f.split('/')[-1].ljust(28), ' | '.join(row))
print('columns:', ' | '.join(t[0] for t in TESTS))
