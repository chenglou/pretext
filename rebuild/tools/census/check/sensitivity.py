# How much each way a calibration table can mislead moves the census's two headline numbers.
#   python3 rebuild/tools/census/check/sensitivity.py [<census folder>] [<09-17 census folder>] [<suite-browsers.json>]
# H1: of the cases main gets wrong, the share the rebuild gets right. H2: of the cases main gets right, the share the
# rebuild gets wrong. Both by line count, as the census counts them, unless a line says otherwise. Each block below
# changes one thing and prints both again:
# - definition: main "right" also needs its visible-breaks diagnostic not to fail (research/MAIN-TRIAGE.md files a right
#   count with wrong visible breaks as an accidental pass), and the rebuild "right" needs lineCount and breaks;
# - scope: main's suite marks each row `supported` or `research` (09-17 census, cases/suite-meta.json);
# - own suite: the cases this browser's own suite rows hold (suite-browsers.json, made from the rows of 2026-09-16 by the
#   check's scratch tool; the census ran every browser over the union of the three browsers' cases);
# - near copies: the U+XXXX/start, /middle and /end families left out; each styled text counting once whatever its widths
#   and directions; each template counting once (the same, with every control and format character made one placeholder);
# - main's own history: main's line-count status on the rerun cases in the long document and in the two short ones;
# - webkit-host page history: the set-aside cases left out, kept as observed, and replaced by their fresh-document records.
# Run it from the worktree's top folder. It writes nothing.
import collections, glob, json, os, re, sys, unicodedata

OUT = sys.argv[1] if len(sys.argv) > 1 else '.artifacts/census-20260919'
THEN = sys.argv[2] if len(sys.argv) > 2 else '.artifacts/research-20260916/census'
OWN = sys.argv[3] if len(sys.argv) > 3 else '.artifacts/tests/runs/census-check-20260919/suite-browsers.json'
SUITE_NAME = {'chrome': 'chrome', 'firefox': 'firefox', 'webkit-host': 'safari'}


def read(path):
    with open(path, encoding='utf8') as f:
        return [json.loads(line) for line in f if line.strip()]


def pct(n, d):
    return 'n/a' if d == 0 else f'{100 * n / d:.2f}%'


wrong = lambda r: r['rebuild']['lineCount'] == 'fail' or r['rebuild']['breaks'] == 'fail'
main_right = lambda r: r['main']['lineCount'] == 'pass'
main_right_strict = lambda r: r['main']['lineCount'] == 'pass' and r['main']['visibleBreaks'] != 'fail'


def heads(label, records, weight=None, strict=False):
    h1n = h1d = h2n = h2d = h2b = 0.0
    for r in records:
        w = 1 if weight is None else weight[r['id']]
        right = main_right_strict(r) if strict else main_right(r)
        rebuild_right = (not wrong(r)) if strict else r['rebuild']['lineCount'] == 'pass'
        if right:
            h2d += w
            h2n += w * (not rebuild_right)
            h2b += w * wrong(r)
        else:
            h1d += w
            h1n += w * rebuild_right
    shown = (lambda x: f'{x:.0f}') if weight is None else (lambda x: f'{x:.1f}')
    print(f'  {label}: H1 {pct(h1n, h1d)} ({shown(h1n)} of {shown(h1d)}); H2 {pct(h2n, h2d)} ({shown(h2n)} of {shown(h2d)}); H2 with wrong breaks {pct(h2b, h2d)} ({shown(h2b)})')


meta = json.load(open(f'{THEN}/cases/suite-meta.json'))['byId']
own = json.load(open(OWN))
history = {h['id'] for h in json.load(open(f'{THEN}/history/webkit-host/history.json'))['historyDependent']}
for item in json.load(open('rebuild/tests/known-tail.json'))['items']:
    if item['id'] == 'webkit/page-history':
        history |= {case['id'] for case in item['cases']}

# Each case's styled text and its template, from the chunk files.
text_key, template_key = {}, {}
for path in sorted(glob.glob(f'{THEN}/cases/chunks/c*.ndjson')):
    for case in read(path):
        p = dict(case['paragraph'])
        text = ''.join(run['text'] for run in p['runs'])
        del p['width'], p['direction']
        styled = json.dumps([case['pageLang'], p], sort_keys=True)
        text_key[case['id']] = styled
        template = ''.join(chr(0xFFFD) if unicodedata.category(ch) in ('Cc', 'Cf') else ch for ch in text)
        runs = [dict(run, text='') for run in p['runs']]
        template_key[case['id']] = json.dumps([case['pageLang'], dict(p, runs=runs), template], sort_keys=True)


def once(records, key):
    sizes = collections.Counter(key[r['id']] for r in records)
    return {r['id']: 1 / sizes[key[r['id']]] for r in records}, len(sizes)


for browser in ['chrome', 'firefox', 'webkit-host']:
    print(f'== {browser}')
    records = []
    for d in sorted(glob.glob(f'{OUT}/{browser}/c*')):
        if os.path.isdir(d) and not d.endswith('.claim') and os.path.exists(f'{d}/cases.ndjson'):
            records += read(f'{d}/cases.ndjson')
    by_id = {r['id']: r for r in records}
    forward = {r['id']: r for r in read(f'{OUT}/{browser}/rerun-file/cases.ndjson')}
    reverse = {r['id']: r for r in read(f'{OUT}/{browser}/rerun-reverse/cases.ndjson')}
    found = {i for i in forward if forward[i]['native']['key'] != by_id[i]['native']['key'] or reverse[i]['native']['key'] != by_id[i]['native']['key']}
    aside = found | (history if browser == 'webkit-host' else set())
    kept = [r for r in records if r['id'] not in aside]

    heads('as the census counts it', kept)
    heads('definition: main right needs its visible breaks too, the rebuild right needs lineCount and breaks', kept, strict=True)
    triage = sum(1 for r in kept if main_right(r) and (r['rebuild']['lineCount'] == 'fail' or (r['rebuild']['breaks'] == 'fail' and r['main']['visibleBreaks'] == 'pass')))
    print(f'  MAIN-TRIAGE\'s two kinds (main\'s count right and the rebuild\'s wrong; or both counts right, main\'s visible breaks pass and the rebuild\'s breaks fail): {triage} cases, {pct(triage, sum(1 for r in kept if main_right(r)))} of main\'s right counts')
    for scope in ['supported', 'research']:
        heads(f'scope {scope} ({sum(1 for r in kept if scope in meta[r["id"]]["scope"])} cases)', [r for r in kept if scope in meta[r['id']]['scope']])
    mine = [r for r in kept if SUITE_NAME[browser] in own[r['id']]]
    heads(f'own suite only ({len(mine)} cases; {len(kept) - len(mine)} come from another browser\'s suite alone)', mine)
    heads('cases from another browser\'s suite alone', [r for r in kept if SUITE_NAME[browser] not in own[r['id']]])
    plain = [r for r in kept if re.match(r'^suite/U\+[0-9A-F]{4,6}/', r['family']) is None]
    heads(f'near copies: without the U+XXXX families ({len(kept) - len(plain)} cases in {len({r["family"] for r in kept}) - len({r["family"] for r in plain})} families left out)', plain)
    weight, groups = once(kept, text_key)
    heads(f'near copies: each styled text once ({groups} texts)', kept, weight)
    weight, groups = once(kept, template_key)
    heads(f'near copies: each template once ({groups} templates)', kept, weight)
    # The family mean, with the U+XXXX copies counted as the census does (one family a character and position), as three
    # families (start, middle, end) and as one.
    for label, name_of in [('as the census counts it', lambda f: f), ('U+XXXX families as three', lambda f: re.sub(r'U\+[0-9A-F]{4,6}', 'U+XXXX', f)), ('U+XXXX families as one', lambda f: re.sub(r'U\+[0-9A-F]{4,6}/.*', 'U+XXXX', f))]:
        groups_of = collections.defaultdict(lambda: [0, 0, 0])
        for r in kept:
            g = groups_of[name_of(r['family'])]
            g[0] += 1
            g[1] += main_right(r)
            g[2] += r['rebuild']['lineCount'] == 'pass'
        print(f'  every family counting once, {label} ({len(groups_of)} families): main {pct(sum(g[1] / g[0] for g in groups_of.values()), len(groups_of))}; rebuild lineCount {pct(sum(g[2] / g[0] for g in groups_of.values()), len(groups_of))}')
    no_long = [r for r in kept if r['chunk'].startswith('chunk')]
    heads(f'without the long paragraphs ({len(kept) - len(no_long)} cases over 1,000 units)', no_long)

    # Main's own history, on the cases that ran three times with the same native view.
    same = [i for i in forward if i not in found]
    trio = collections.Counter((main_right(by_id[i]), main_right(forward[i]), main_right(reverse[i])) for i in same)
    moved = sum(n for k, n in trio.items() if len(set(k)) > 1)
    print(f'  main\'s own history: of {len(same)} rerun cases with one native view in all three documents, main\'s line-count status differs between the documents on {moved}: (long, file order, reversed) {dict(trio)}')

    if browser == 'webkit-host':
        heads('page history: the set-aside kept as observed', records)
        for name, fresh in [('file order', forward), ('reversed', reverse)]:
            heads(f'page history: the rerun cases replaced by their fresh records, {name}', [fresh.get(r['id'], r) if r['id'] in found else r for r in records])
        best = [(forward[r['id']] if not wrong(forward[r['id']]) else reverse[r['id']]) if r['id'] in found else r for r in records]
        heads('page history: replaced by the fresh record of the order the rebuild does better in (the most favourable reading)', best)
        failing = sum(1 for r in records if wrong(r))
        print(f'  selection: reruns were made of the rebuild\'s {failing} wrong-lines cases only; {len(found)} of them ({pct(len(found), failing)}) are page history. Of the {len(records) - failing} cases with right lines, none ran again.')
