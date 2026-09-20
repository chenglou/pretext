# The census by paragraph width: how much of the suite is narrower than any application's column, and what the two
# predictors do above that.
#   python3 rebuild/tools/census/check/by-width.py [<census folder>] [<09-17 census folder>]
# Counts are over every scored suite record, as observed (no set-aside). Run it from the worktree's top folder.
import collections, glob, json, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else '.artifacts/census-20260919'
THEN = sys.argv[2] if len(sys.argv) > 2 else '.artifacts/research-20260916/census'
EDGES = [20, 40, 80, 160, 320]
NAMES = ['under 20', '20 to 40', '40 to 80', '80 to 160', '160 to 320', '320 and over']


def read(path):
    with open(path, encoding='utf8') as f:
        return [json.loads(line) for line in f if line.strip()]


width = {}
for path in sorted(glob.glob(f'{THEN}/cases/chunks/c*.ndjson')):
    for case in read(path):
        width[case['id']] = case['paragraph']['width']

for browser in ['chrome', 'firefox', 'webkit-host']:
    rows = [collections.Counter() for _ in NAMES]
    for d in sorted(glob.glob(f'{OUT}/{browser}/c*')):
        if not os.path.isdir(d) or d.endswith('.claim') or not os.path.exists(f'{d}/cases.ndjson'):
            continue
        for r in read(f'{d}/cases.ndjson'):
            c = rows[sum(1 for e in EDGES if width[r['id']] >= e)]
            main = r['main']['lineCount'] == 'pass'
            c['cases'] += 1
            c['main'] += main
            c['lineCount'] += r['rebuild']['lineCount'] == 'pass'
            c['wrongLines'] += r['rebuild']['lineCount'] == 'fail' or r['rebuild']['breaks'] == 'fail'
            c['mainOnly'] += main and r['rebuild']['lineCount'] != 'pass'
            c['mainFails'] += not main
            c['h1'] += (not main) and r['rebuild']['lineCount'] == 'pass'
    total = sum(c['cases'] for c in rows)
    print(f'== {browser}: {total} cases')
    print('| width, px | cases | share | main | rebuild lineCount | rebuild wrong lines | main fails, rebuild passes | main passes, rebuild fails |\n|---|---:|---:|---:|---:|---:|---:|---:|')
    for k, c in enumerate(rows):
        print(f'| {NAMES[k]} | {c["cases"]} | {100 * c["cases"] / total:.1f}% | {100 * c["main"] / c["cases"]:.2f}% | {100 * c["lineCount"] / c["cases"]:.2f}% | {c["wrongLines"]} | {c["h1"]} of {c["mainFails"]} | {c["mainOnly"]} of {c["main"]} |')
