# A second count of the calibration census, written apart from tables.ts, from the per-case records alone.
#   python3 rebuild/tools/census/check/recount.py [<census folder>] [<09-17 census folder>]
# It reads <census>/<browser>/<chunk>/cases.ndjson, counts every number tables.ts wrote to calibration.json again with its
# own code, and prints each count that differs. Then it prints the numbers the check's report quotes:
# - the case set against the 09-17 chunk files (every chunk, no case twice, none dropped but the ones named);
# - the two headline numbers, and what each way of misleading moves them by (see the report for the definitions).
# Run it from the worktree's top folder. It writes nothing.
import collections, glob, json, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else '.artifacts/census-20260919'
THEN = sys.argv[2] if len(sys.argv) > 2 else '.artifacts/research-20260916/census'
BROWSERS = ['chrome', 'firefox', 'webkit-host']
SUITE_NAME = {'chrome': 'chrome', 'firefox': 'firefox', 'webkit-host': 'safari'}


def read(path):
    with open(path, encoding='utf8') as f:
        return [json.loads(line) for line in f if line.strip()]


def suite_chunks(browser):
    names = sorted(os.path.basename(d) for d in glob.glob(f'{OUT}/{browser}/c*') if os.path.isdir(d) and not d.endswith('.claim'))
    return [n for n in names if os.path.exists(f'{OUT}/{browser}/{n}/cases.ndjson')]


def pct(n, d):
    return 'n/a' if d == 0 else f'{100 * n / d:.2f}%'


# One record's part in every count. The names are calibration.json's, so the two can be compared field by field.
def tally(records):
    c = collections.Counter()
    for r in records:
        c['cases'] += 1
        lc, br, wd = r['rebuild']['lineCount'], r['rebuild']['breaks'], r['rebuild']['widths']
        if lc == 'unobserved':
            continue
        c['observed'] += 1
        main = r['main']['lineCount'] == 'pass'
        wrong = lc == 'fail' or br == 'fail'
        covered = wrong and all(r['covered'].get(m) is True for m in ('lineCount', 'breaks') if r['rebuild'][m] == 'fail')
        half = 'mainPass' if main else 'mainFail'
        c['mainPass'] += main
        c['rebuildPass'] += lc == 'pass'
        if br != 'unobserved':
            c['breaksObserved'] += 1
            c['breaksPass'] += br == 'pass'
            c[half + 'BreaksObserved'] += 1
            c[half + 'BreaksPass'] += br == 'pass'
        if wd != 'unobserved':
            c['widthsObserved'] += 1
            c['widthsPass'] += wd == 'pass'
            c['widthsFail'] += wd == 'fail'
            c[half + 'WidthsObserved'] += 1
            c[half + 'WidthsPass'] += wd == 'pass'
        c['mainFailRebuildPass'] += (not main) and lc == 'pass'
        c['mainPassRebuildFail'] += main and lc != 'pass'
        c['mainPassRebuildFailCovered'] += main and lc != 'pass' and r['covered'].get('lineCount') is True
        c['bothFail'] += (not main) and lc != 'pass'
        c['wrongLines'] += wrong
        c['wrongLinesCovered'] += covered
        c['mainPassWrongLines'] += main and wrong
        c['mainPassWrongLinesCovered'] += main and covered
        c['mainFailRightLines'] += (not main) and not wrong
        c['rightCountWrongBreaks'] += main and r['main']['visibleBreaks'] == 'fail'
        c['truePassWrongLines'] += main and r['main']['visibleBreaks'] != 'fail' and wrong
    return c


def by_family(records):
    groups = collections.defaultdict(list)
    for r in records:
        groups[r['family']].append(r)
    return {name: tally(group) for name, group in groups.items()}


def compare(where, mine, theirs, fields, differences):
    for f in fields:
        if mine.get(f, 0) != theirs.get(f, 0):
            differences.append(f'{where}: {f} recount {mine.get(f, 0)}, calibration.json {theirs.get(f, 0)}')


def headline(name, c):
    fails = c['observed'] - c['mainPass']
    print(f'  {name}: cases {c["observed"]}; main {pct(c["mainPass"], c["observed"])}; rebuild lineCount {pct(c["rebuildPass"], c["observed"])}, breaks {pct(c["breaksPass"], c["breaksObserved"])}, widths {pct(c["widthsPass"], c["widthsObserved"])}')
    print(f'    H1 main wrong -> rebuild right: {pct(c["mainFailRebuildPass"], fails)} ({c["mainFailRebuildPass"]} of {fails}); H2 main right -> rebuild wrong: {pct(c["mainPassRebuildFail"], c["mainPass"])} ({c["mainPassRebuildFail"]} of {c["mainPass"]}); with wrong breaks {pct(c["mainPassWrongLines"], c["mainPass"])} ({c["mainPassWrongLines"]}, covered {c["mainPassWrongLinesCovered"]})')


def family_means(families):
    sums, counted = [0.0] * 4, [0] * 4
    for c in families.values():
        parts = [(c['mainPass'], c['observed']), (c['rebuildPass'], c['observed']), (c['breaksPass'], c['breaksObserved']), (c['widthsPass'], c['widthsObserved'])]
        for k, (n, d) in enumerate(parts):
            if d > 0:
                sums[k] += n / d
                counted[k] += 1
    return [pct(sums[k], counted[k]) for k in range(4)]


then = collections.defaultdict(dict)
with open(f'{THEN}/census-transitions.ndjson', encoding='utf8') as f:
    for line in f:
        t = json.loads(line)
        then[t['browser']][t['id']] = t

calibration = json.load(open(f'{OUT}/calibration.json'))
fields = calibration['fields']
history = {h['id'] for h in json.load(open(f'{THEN}/history/webkit-host/history.json'))['historyDependent']}
tail = set()
for item in json.load(open('rebuild/tests/known-tail.json'))['items']:
    if item['id'] == 'webkit/page-history':
        tail = {case['id'] for case in item['cases']}

for browser in BROWSERS:
    print(f'== {browser}')
    differences = []
    chunks = suite_chunks(browser)
    records = []
    for chunk in chunks:
        records += read(f'{OUT}/{browser}/{chunk}/cases.ndjson')

    # ---- The case set ----
    ids = collections.Counter(r['id'] for r in records)
    twice = [i for i, n in ids.items() if n > 1]
    expected = {}
    for path in sorted(glob.glob(f'{THEN}/cases/chunks/c*.ndjson')):
        for case in read(path):
            if case.get('browsers') is None or SUITE_NAME[browser] in case['browsers']:
                expected[case['id']] = os.path.basename(path)[:-len('.ndjson')]
    filtered = sum(1 for path in glob.glob(f'{THEN}/cases/chunks/c*.ndjson') for case in read(path) if case.get('browsers') is not None and SUITE_NAME[browser] not in case['browsers'])
    missing = collections.Counter(expected[i] for i in expected if i not in ids)
    extra = [i for i in ids if i not in expected]
    moved = sum(1 for r in records if r['id'] in expected and not r['chunk'].startswith(expected[r['id']]))
    print(f'  case set: {len(records)} records in {len(chunks)} chunk folders, {len(ids)} ids, {len(twice)} twice; the chunk files hold {len(expected)} for this browser ({filtered} filtered out by their `browsers` field); missing {sum(missing.values())} {dict(missing)}; not in the chunk files {len(extra)}; under another chunk name {moved}')
    statuses = collections.Counter((r['rebuild']['lineCount'], r['main']['lineCount']) for r in records)
    print(f'  (rebuild lineCount, main lineCount) statuses: {dict(statuses)}; records with mainError {sum(1 for r in records if "mainError" in r)}, rebuildError {sum(1 for r in records if "rebuildError" in r)}')

    # ---- The set-aside, as tables.ts defines it ----
    by_id = {r['id']: r for r in records}
    forward = read(f'{OUT}/{browser}/rerun-file/cases.ndjson')
    reverse = {r['id']: r for r in read(f'{OUT}/{browser}/rerun-reverse/cases.ndjson')}
    wrong = lambda r: r['rebuild']['lineCount'] == 'fail' or r['rebuild']['breaks'] == 'fail'
    main_only = lambda r: r['main']['lineCount'] == 'pass' and r['rebuild']['lineCount'] == 'fail'
    aside = set(history | tail) if browser == 'webkit-host' else set()
    rerun = collections.Counter()
    found = set()
    for a in forward:
        z, r = reverse.get(a['id']), by_id.get(a['id'])
        if z is None or r is None:
            rerun['unmatched'] += 1
            continue
        rerun['cases'] += 1
        rights = (not wrong(a)) + (not wrong(z))
        mains = (a['main']['lineCount'] == 'pass') + (z['main']['lineCount'] == 'pass')
        if a['native']['key'] != r['native']['key'] or z['native']['key'] != r['native']['key']:
            aside.add(a['id'])
            found.add(a['id'])
            rerun['historyDependent'] += 1
            rerun['historyDependentRightInBoth'] += rights == 2
            rerun['historyDependentRightInOne'] += rights == 1
            rerun['historyDependentMainPassInBoth'] += mains == 2
            rerun['historyDependentMainPassInOne'] += mains == 1
            rerun['historyDependentMainOnlyThen'] += main_only(r)
            rerun['historyDependentMainOnlyInBoth'] += main_only(a) and main_only(z)
        else:
            rerun['stable'] += 1
            rerun['stableWrongInBoth'] += rights == 0
            rerun['stableRightInBoth'] += rights == 2
            rerun['stableMainOnlyThen'] += main_only(r)
            rerun['stableMainOnlyInBoth'] += main_only(a) and main_only(z)
    compare(f'{browser} rerun', rerun, calibration[browser]['rerun'], calibration[browser]['rerun'].keys(), differences)
    wrong_small = sum(1 for r in records if wrong(r) and r['chunk'].startswith('chunk'))
    print(f'  reruns: {dict(rerun)}; the rebuild\'s wrong-lines cases in the small chunks today: {wrong_small}; in corpus chunks: {sum(1 for r in records if wrong(r)) - wrong_small}')

    kept = [r for r in records if r['id'] not in aside]
    apart = [r for r in records if r['id'] in aside]
    total, families = tally(kept), by_family(kept)
    compare(f'{browser} suite total', total, calibration[browser]['suite']['total'], fields, differences)
    compare(f'{browser} set aside', tally(apart), calibration[browser]['setAside'], fields, differences)
    compare(f'{browser} suite with set-aside', tally(records), calibration[browser]['suiteWithSetAside'], fields, differences)
    theirs = calibration[browser]['suite']['families']
    if set(theirs) != set(families):
        differences.append(f'{browser}: family names differ: {sorted(set(theirs) ^ set(families))[:10]}')
    for name in families:
        compare(f'{browser} {name}', families[name], theirs.get(name, {}), fields, differences)
    real = read(f'{OUT}/{browser}/real-text/cases.ndjson')
    compare(f'{browser} real text', tally(real), calibration[browser]['realText']['total'], fields, differences)
    real_families = by_family(real)
    for name in real_families:
        compare(f'{browser} {name}', real_families[name], calibration[browser]['realText']['families'].get(name, {}), fields, differences)
    # ---- 2026-09-17 against today, on the kept cases both days hold ----
    native_then = {}
    for chunk in chunks:
        if os.path.exists(f'{OUT}/{browser}/{chunk}/then.ndjson'):
            for t in read(f'{OUT}/{browser}/{chunk}/then.ndjson'):
                native_then[t['id']] = t['native']
    moves = collections.defaultdict(collections.Counter)
    letter = lambda status: 'p' if status == 'pass' else 'f'
    joined = compared = native_moved = lines_moved = 0
    pass_to_fail = []
    for r in kept:
        t = then[browser].get(r['id'])
        if t is None:
            continue
        joined += 1
        was = native_then.get(r['id'])
        if was is not None:
            compared += 1
            native_moved += was['key'] != r['native']['key']
            lines_moved += was['lines'] != r['native']['lines']
        for m in ('lineCount', 'breaks', 'widths'):
            a, z = t['rebuild'][m], r['rebuild'][m]
            key = 'u' if 'unobserved' in (a, z) else letter(a) + letter(z)
            moves[f'rebuild {m}'][key] += 1
            if was is not None and was['key'] == r['native']['key']:
                moves[f'rebuild {m}, same native view'][key] += 1
        a, z = t['main']['lineCount'], 'unobserved' if r['rebuild']['lineCount'] == 'unobserved' else r['main']['lineCount']
        moves['main lineCount']['u' if 'unobserved' in (a, z) else letter(a) + letter(z)] += 1
        if any(t['rebuild'][m] == 'pass' and r['rebuild'][m] == 'fail' for m in ('lineCount', 'breaks')):
            pass_to_fail.append(r['id'])
    theirs_then = calibration[browser]['thenAndNow']
    compare(f'{browser} then and now', {'joined': joined, 'nativeCompared': compared, 'nativeMoved': native_moved, 'nativeLinesMoved': lines_moved}, theirs_then, ['joined', 'nativeCompared', 'nativeMoved', 'nativeLinesMoved'], differences)
    for name in set(moves) | set(theirs_then['moves']):
        compare(f'{browser} moves {name}', moves[name], theirs_then['moves'].get(name, {}), ['pp', 'fp', 'pf', 'ff', 'u'], differences)
    listed = [i for i in open(f'{OUT}/rerun/{browser}-pass-to-fail.ids').read().split('\n') if i]
    facts = read(f'{OUT}/{browser}/facts-pass-to-fail/cases.ndjson')
    rate = lambda m: f'{pct(m["pp"] + m["pf"], m["pp"] + m["fp"] + m["pf"] + m["ff"])} -> {pct(m["pp"] + m["fp"], m["pp"] + m["fp"] + m["pf"] + m["ff"])} (fail to pass {m["fp"]}, pass to fail {m["pf"]})'
    print(f'  09-17 against today, {joined} cases: lineCount {rate(moves["rebuild lineCount"])}; breaks {rate(moves["rebuild breaks"])}; widths {rate(moves["rebuild widths"])}; main {rate(moves["main lineCount"])}; native views differ {native_moved} of {compared} ({lines_moved} in the number of lines)')
    print(f'  passed lineCount or breaks then and fail it now: {len(pass_to_fail)} (the ids file lists {len(listed)}, the same set: {set(listed) == set(pass_to_fail)}); run again with the lab\'s facts {len(facts)}, right lines {sum(1 for r in facts if not wrong(r))}, still wrong {sum(1 for r in facts if wrong(r))}; facts run covers the list: {set(r["id"] for r in facts) == set(listed)}')

    print(f'  compared with calibration.json: {len(families)} suite families, {len(real_families)} real-text families, 3 totals, the rerun counts: {len(differences)} counts differ')
    for d in differences[:20]:
        print('    ' + d)

    headline('suite as the document counts it', total)
    if apart:
        headline('set aside', tally(apart))
        headline('suite with the set-aside', tally(records))
        print(f'  set-aside make-up: {len(apart)} records; found by the reruns {rerun["historyDependent"]}; in the 09-17 history list {sum(1 for r in apart if r["id"] in history)}; in the known tail {sum(1 for r in apart if r["id"] in tail)}; in a list and not found by the reruns {sum(1 for r in apart if r["id"] not in found)}, of which the rebuild has wrong lines on {sum(1 for r in apart if r["id"] not in found and wrong(r))}')
    means = family_means(families)
    print(f'  every family counting once ({len(families)} families): main {means[0]}; rebuild lineCount {means[1]}, breaks {means[2]}, widths {means[3]}')
    headline('real text', tally(real))
