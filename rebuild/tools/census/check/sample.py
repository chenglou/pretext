# A random sample of the census's cases run again in a fresh process, both orders, to see what the census's reruns could
# not: they took the rebuild's wrong-lines cases alone, so a pass that depends on page history was never looked for.
#   python3 rebuild/tools/census/check/sample.py cases <browser> <n> <seed> <out.ndjson>
#   python3 rebuild/tools/census/check/sample.py compare <browser> <sample folder>
# `cases` draws n of the browser's scored cases of at most 1,000 units (chunk00 to chunk11), every case equally likely, and
# writes them in file order. sample-run.sh runs them; `compare` reads <sample folder>/<browser>/{file,reverse}/cases.ndjson
# beside the census's records of the same cases, and writes <sample folder>/<browser>-unsettled.ids: the cases only a run of
# each case alone (lab/sharded.ts --isolate) would settle. Run it from the worktree's top folder.
import collections, glob, json, random, sys

OUT = '.artifacts/census-20260919'
THEN = '.artifacts/research-20260916/census'


def read(path):
    with open(path, encoding='utf8') as f:
        return [json.loads(line) for line in f if line.strip()]


def pct(n, d):
    return 'n/a' if d == 0 else f'{100 * n / d:.2f}%'


wrong = lambda r: r['rebuild']['lineCount'] == 'fail' or r['rebuild']['breaks'] == 'fail'
main_right = lambda r: r['main']['lineCount'] == 'pass'


def heads(label, records):
    fails = [r for r in records if not main_right(r)]
    rights = [r for r in records if main_right(r)]
    h1 = sum(1 for r in fails if r['rebuild']['lineCount'] == 'pass')
    h2 = sum(1 for r in rights if r['rebuild']['lineCount'] != 'pass')
    h2b = sum(1 for r in rights if wrong(r))
    line_count = sum(1 for r in records if r['rebuild']['lineCount'] == 'pass')
    print(f'  {label}: main {pct(len(rights), len(records))}; rebuild lineCount {pct(line_count, len(records))}, wrong lines {sum(1 for r in records if wrong(r))}; H1 {pct(h1, len(fails))} ({h1} of {len(fails)}); H2 {pct(h2, len(rights))} ({h2} of {len(rights)}); H2 with wrong breaks {pct(h2b, len(rights))} ({h2b})')


mode, browser = sys.argv[1], sys.argv[2]
long_records = {}
for path in sorted(glob.glob(f'{OUT}/{browser}/chunk[0-9][0-9]/cases.ndjson')):
    for r in read(path):
        long_records[r['id']] = r

if mode == 'cases':
    n, seed, out = int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
    chosen = set(random.Random(seed).sample(sorted(long_records), n))
    with open(out, 'w', encoding='utf8') as f:
        for path in sorted(glob.glob(f'{THEN}/cases/chunks/chunk*.ndjson')):
            with open(path, encoding='utf8') as lines:
                for line in lines:
                    if line.strip() and json.loads(line)['id'] in chosen:
                        f.write(line)
    print(f'{n} of {len(long_records)} {browser} cases, seed {seed}: {out}')

if mode == 'compare':
    folder = sys.argv[3]
    forward = {r['id']: r for r in read(f'{folder}/{browser}/file/cases.ndjson')}
    reverse = {r['id']: r for r in read(f'{folder}/{browser}/reverse/cases.ndjson')}
    ids = [i for i in forward if i in reverse and i in long_records]
    print(f'== {browser}: {len(ids)} sampled cases (file order {len(forward)}, reversed {len(reverse)})')
    heads('the long documents', [long_records[i] for i in ids])
    heads('fresh process, file order', [forward[i] for i in ids])
    heads('fresh process, reversed', [reverse[i] for i in ids])
    differs = [i for i in ids if forward[i]['native']['key'] != long_records[i]['native']['key'] or reverse[i]['native']['key'] != long_records[i]['native']['key']]
    lines_differ = [i for i in differs if forward[i]['native']['lines'] != long_records[i]['native']['lines'] or reverse[i]['native']['lines'] != long_records[i]['native']['lines']]
    differing = set(differs)
    orders_differ = sum(1 for i in ids if forward[i]['native']['key'] != reverse[i]['native']['key'])
    print(f'  native view differs from the long document\'s in either order: {len(differs)} ({pct(len(differs), len(ids))}), {len(lines_differ)} of them in the number of lines; the two fresh orders differ from each other on {orders_differ}')
    kinds = collections.Counter()
    for i in differs:
        was = 'wrong' if wrong(long_records[i]) else 'right'
        fresh = (not wrong(forward[i])) + (not wrong(reverse[i]))
        kinds[f'rebuild {was} in the long document, right in {fresh} of 2 fresh orders'] += 1
    for kind in sorted(kinds):
        print(f'    {kind}: {kinds[kind]}')
    passes = [i for i in ids if not wrong(long_records[i])]
    lucky = [i for i in passes if wrong(forward[i]) or wrong(reverse[i])]
    print(f'  of {len(passes)} cases with right lines in the long document: native view differs on {sum(1 for i in passes if i in differing)}; the rebuild has wrong lines in a fresh order on {len(lucky)}, in both on {sum(1 for i in lucky if wrong(forward[i]) and wrong(reverse[i]))}')
    failures = [i for i in ids if wrong(long_records[i])]
    print(f'  of {len(failures)} cases with wrong lines in the long document: native view differs on {sum(1 for i in failures if i in differing)}; right in both fresh orders {sum(1 for i in failures if not wrong(forward[i]) and not wrong(reverse[i]))}, in one {sum(1 for i in failures if wrong(forward[i]) != wrong(reverse[i]))}')
    # The census's set-aside took the rebuild's failures alone. Two rules on the same sample, long-document records:
    # the census's own (its reruns' verdicts and the 09-17 list), and a symmetric one (any case whose native view differs
    # among the three documents, whatever the rebuild did).
    census_forward = {r['id']: r for r in read(f'{OUT}/{browser}/rerun-file/cases.ndjson')}
    census_reverse = {r['id']: r for r in read(f'{OUT}/{browser}/rerun-reverse/cases.ndjson')}
    listed = {h['id'] for h in json.load(open(f'{THEN}/history/webkit-host/history.json'))['historyDependent']} if browser == 'webkit-host' else set()
    census_aside = {i for i in ids if i in listed or (i in census_forward and (census_forward[i]['native']['key'] != long_records[i]['native']['key'] or census_reverse[i]['native']['key'] != long_records[i]['native']['key']))}
    heads(f'the long documents, the census\'s set-aside left out ({len(census_aside)} cases)', [long_records[i] for i in ids if i not in census_aside])
    heads(f'the long documents, every case whose native view differs among the three documents left out ({len(differing)} cases)', [long_records[i] for i in ids if i not in differing])
    unsettled = [i for i in failures if i not in differing and i in census_aside] + [i for i in passes if wrong(forward[i]) and wrong(reverse[i])]
    print(f'  only a run of each case alone would settle: {sum(1 for i in failures if i not in differing and i in census_aside)} failures with one native view in all three documents that the census\'s reruns set aside, and {sum(1 for i in passes if wrong(forward[i]) and wrong(reverse[i]))} long-document passes with wrong lines in both fresh orders')
    with open(f'{folder}/{browser}-unsettled.ids', 'w') as f:
        f.write('\n'.join(unsettled) + '\n')
    main_moves = collections.Counter((main_right(long_records[i]), main_right(forward[i]), main_right(reverse[i])) for i in ids)
    same_native = [i for i in ids if i not in differing]
    main_own = sum(1 for i in same_native if len({main_right(long_records[i]), main_right(forward[i]), main_right(reverse[i])}) > 1)
    print(f'  main\'s line-count status (long, file order, reversed): {dict(main_moves)}')
    print(f'  main\'s own history: on the {len(same_native)} cases with one native view in all three, main\'s status differs between the documents on {main_own}')
    rebuild_own = sum(1 for i in same_native if len({json.dumps(long_records[i]['rebuild']), json.dumps(forward[i]['rebuild']), json.dumps(reverse[i]['rebuild'])}) > 1)
    print(f'  the rebuild\'s own history: on the same cases its four statuses differ between the documents on {rebuild_own}')
