#!/usr/bin/env python3
"""Split ICU RBBI binary rules (ubrk_getBinaryRules output) into sections, hash each, and extract the rule source.

Layout (icu4c/source/common/rbbidata.h, RBBIDataHeader, format version 6):
  uint32 fMagic (0xb1a0), uint8[4] fFormatVersion, uint32 fLength, uint32 fCatCount,
  uint32 fFTable, fFTableLen, fRTable, fRTableLen, fTrie, fTrieLen, fRuleSource, fRuleSourceLen,
  fStatusTable, fStatusTableLen, uint32[6] fReserved. Offsets are from the start of the header; since
  format version 6 the rule source is UTF-8.

Usage: rbbi_sections.py <manifest.tsv> <brk dir parent> [--rules-out DIR] [--compare other/manifest.tsv other/parent]
"""
import hashlib
import struct
import sys
import os


def sections(data):
    magic = struct.unpack_from('<I', data, 0)[0]
    assert magic == 0xB1A0, hex(magic)
    fmt = tuple(data[4:8])
    (length, cat_count, ftable, ftable_len, rtable, rtable_len, trie, trie_len, rule_source, rule_source_len,
     status_table, status_table_len) = struct.unpack_from('<12I', data, 8)
    assert length == len(data), (length, len(data))
    return {
        'format': '.'.join(map(str, fmt)),
        'catCount': cat_count,
        'ftable': data[ftable:ftable + ftable_len],
        'rtable': data[rtable:rtable + rtable_len],
        'trie': data[trie:trie + trie_len],
        'status': data[status_table:status_table + status_table_len],
        'source': data[rule_source:rule_source + rule_source_len].rstrip(b'\0').decode('utf-8'),
    }


def load_manifest(path):
    rows = []
    for line in open(path, encoding='utf-8'):
        if line.startswith('#') or line.startswith('type\t'):
            continue
        f = line.rstrip('\n').split('\t')
        rows.append({'type': f[0], 'locale': f[1], 'behavior': f[2], 'actual': f[6], 'valid': f[7], 'size': int(f[8]), 'sha': f[9], 'file': f[10]})
    return rows


def h(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode('utf-8')).hexdigest()[:16]


def main():
    args = sys.argv[1:]
    manifest, parent = args[0], args[1]
    rules_out = None
    compare = None
    if '--rules-out' in args:
        rules_out = args[args.index('--rules-out') + 1]
    if '--compare' in args:
        i = args.index('--compare')
        compare = (args[i + 1], args[i + 2])
    rows = load_manifest(manifest)
    unique = {}
    for r in rows:
        unique.setdefault(r['sha'], r)
    other = {}
    if compare:
        for r in load_manifest(compare[0]):
            other[(r['type'], r['locale'], r['behavior'])] = r
    print('sha16\tsize\tformat\tcats\tftable\trtable\ttrie\tstatus\tsource\tfirst rule-source line\texample config\tcompare: size ftable rtable trie status source')
    for sha, r in unique.items():
        data = open(os.path.join(parent, r['file']), 'rb').read()
        s = sections(data)
        first = next((l for l in s['source'].split('\n') if l.strip().startswith('#') and len(l.strip()) > 2), '')[:70]
        cmp = ''
        if compare:
            o = other.get((r['type'], r['locale'], r['behavior']))
            if o:
                od = open(os.path.join(compare[1], o['file']), 'rb').read()
                os_ = sections(od)
                cmp = ' '.join('%s=%s' % (k, 'same' if (s[k] == os_[k]) else 'DIFF') for k in ('ftable', 'rtable', 'trie', 'status', 'source')) + ' cats %d/%d size %d/%d' % (s['catCount'], os_['catCount'], len(data), len(od))
        print('\t'.join([sha[:16], str(len(data)), s['format'], str(s['catCount']), h(s['ftable']), h(s['rtable']), h(s['trie']), h(s['status']), h(s['source']), first, '%s|%s|%s' % (r['type'], r['locale'], r['behavior']), cmp]))
        if rules_out:
            os.makedirs(rules_out, exist_ok=True)
            with open(os.path.join(rules_out, sha + '.txt'), 'w', encoding='utf-8') as f:
                f.write(s['source'])
            if compare and o:
                with open(os.path.join(rules_out, sha + '.upstream.txt'), 'w', encoding='utf-8') as f:
                    f.write(os_['source'])


main()
