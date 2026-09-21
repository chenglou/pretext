#!/usr/bin/env python3
"""Read-only inventory of imported required wrapping identities and frozen reference count states.

This checks membership and stored count status, not original height/extractor/API contract equivalence.
The imported origin can merge multiple original aliases into one case identity.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    artifacts, out = args.artifact_root.resolve(), args.out.resolve()
    if out.exists():
        parser.error('output directory already exists')
    source = artifacts / 'research-20260916/census/cases/suite-all.ndjson'
    roster = []
    with source.open() as stream:
        for number, line in enumerate(stream, 1):
            case = json.loads(line)
            aliases = [part for part in case['origin'].removeprefix('suite ').split('; ') if ' required=' in part]
            if aliases:
                roster.append({'id': case['id'], 'family': case['family'], 'sourceLine': number,
                               'aliases': aliases, 'browsers': case.get('browsers')})
    if not roster or len({entry['id'] for entry in roster}) != len(roster):
        raise ValueError('required imported case identities must be nonempty and unique')
    rows, reports, seals = [], [], [{'path': str(source), 'sha256': sha256(source)}]
    for browser, canonical in [('chrome', 'chrome'), ('firefox', 'firefox'), ('webkit-host', 'safari')]:
        ledger = artifacts / 'tests/reference' / f'{browser}-no-facts/ledger/entries.ndjson'
        states = collections.defaultdict(set)
        with ledger.open() as stream:
            for line in stream:
                value = json.loads(line)
                states[value['id']].add(value['status']['lineCount'])
        seals.append({'path': str(ledger), 'sha256': sha256(ledger)})
        applicable = [entry for entry in roster if entry['browsers'] is None or canonical in entry['browsers']]
        missing, nonpass, families = [], [], collections.Counter()
        for entry in applicable:
            status = sorted(states.get(entry['id'], []))
            row = {**entry, 'browser': browser, 'referenceLineCountStates': status}
            rows.append(row)
            families[(entry['family'], ','.join(status) or 'missing')] += 1
            if not status:
                missing.append(entry['id'])
            elif status != ['pass']:
                nonpass.append({'id': entry['id'], 'states': status})
        reports.append({'browser': browser, 'applicableImportedIdentities': len(applicable),
                        'applicableRequiredAliases': sum(len(entry['aliases']) for entry in applicable),
                        'missing': missing, 'nonpass': nonpass,
                        'families': [{'family': family, 'referenceLineCount': state, 'cases': count}
                                     for (family, state), count in sorted(families.items())]})
    out.mkdir(parents=True)
    summary = {'format': 'pretext-imported-required-roster/1',
               'importedIdentities': len(roster), 'requiredAliases': sum(len(entry['aliases']) for entry in roster),
               'meaning': 'membership and frozen count status of imported required cases; does not prove original native height, selected extractor, locale, rich API or source contracts',
               'sources': seals, 'browsers': reports}
    (out / 'manifest.json').write_text(json.dumps(summary, indent=2) + '\n')
    (out / 'roster.ndjson').write_text(''.join(json.dumps(row) + '\n' for row in sorted(rows, key=lambda value: (value['browser'], value['id']))))
    print(json.dumps({key: summary[key] for key in ['importedIdentities', 'requiredAliases']}))
    for report in reports:
        print(f"{report['browser']}: {report['applicableImportedIdentities']} imported identities, {len(report['missing'])} missing, {len(report['nonpass'])} nonpass")
    return 1 if any(report['missing'] or report['nonpass'] for report in reports) else 0


if __name__ == '__main__':
    raise SystemExit(main())
