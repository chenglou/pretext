#!/usr/bin/env python3
"""The word scan's premise in the fonts themselves: HarfBuzz (hb-shape, which Firefox 156 shapes every font with) over
every face of the font files listed, each word of words.json whose characters the face maps, cluster level 1 (Gecko's,
gfxHarfBuzzShaper.cpp:1233-1234). For each word: the glyph advances summed per grapheme cluster start, and the tail from
each inner cluster start to the word's end. A negative tail breaks the premise (no tail of a shaped word has a negative
advance). Also: faces with any negative glyph advance, and the smallest tail relative to the em where some glyph is
negative, whose sign per-glyph rounding at small sizes could flip (checked at 9 to 96 px, 60 au a px).
Variable faces are shaped at each axis's minimum and maximum (every corner up to 3 axes) and at their named instances.

Words come from tools/word-scan-hb-words.ts; files.txt lists font files, one a line. A face's word is shaped only where
the face maps each of its characters (default ignorables aside), as Firefox would fall back otherwise. Tails are taken at
grapheme starts, inside a ligature cluster too: Gecko's break scan counts a ligature's whole advance on its first
character (gfxTextRun.cpp:1139-1151), so the tail from a grapheme inside it is what the clusters after it hold.

  bun rebuild/tools/word-scan-hb-words.ts <words.json>
  python3 rebuild/tools/word-scan-hb-tails.py <files.txt> <words.json> <out.json> [--jobs=6]
"""
import json, math, os, re, subprocess, sys, tempfile
from multiprocessing import Pool

IGNORABLE = set([0x200c, 0x200d, 0x200b, 0x2060, 0xfeff, 0x34f, 0x180b, 0x180c, 0x180d, 0x180e, 0x180f, 0x20e3]) | set(range(0xfe00, 0xfe10)) | set(range(0xe0100, 0xe01f0)) | set(range(0x1f3fb, 0x1f400))


def run(args, stdin=None):
    return subprocess.run(args, capture_output=True, text=True, input=stdin)


def faces_of(path):
    r = run(['hb-info', '--show-face-count', path])
    m = re.search(r'(\d+)', r.stdout)
    return int(m.group(1)) if m else 1


def unicodes(path, index):
    r = run(['hb-info', '--list-unicodes', f'--face-index={index}', path])
    out = set()
    for m in re.finditer(r'U\+([0-9A-F]+)', r.stdout):
        out.add(int(m.group(1), 16))
    return out


def axes_of(path, index):
    r = run(['hb-info', '--list-variations', f'--face-index={index}', path])
    axes, named = [], []
    part = None
    for line in r.stdout.splitlines():
        if 'Varitation axes' in line or 'Variation axes' in line:
            part = 'axes'; continue
        if 'Named instances' in line:
            part = 'named'; continue
        cells = line.split('\t')
        if part == 'axes' and len(cells) >= 4 and re.match(r'^[A-Za-z0-9 ]{4}$', cells[0]):
            try:
                axes.append((cells[0], float(cells[1]), float(cells[2]), float(cells[3])))
            except ValueError:
                pass
        if part == 'named' and len(cells) >= 1 and cells[0].strip().isdigit():
            named.append(int(cells[0].strip()))
    return axes, named


def settings(path, index):
    axes, named = axes_of(path, index)
    out = [None]
    if not axes:
        return out
    use = axes[:3]
    corners = [[]]
    for tag, lo, default, hi in use:
        corners = [c + [f'{tag}={v}'] for c in corners for v in (lo, hi)]
    out += [('variations', ','.join(c)) for c in corners]
    out += [('named', str(k)) for k in named]
    return out


def shape(path, index, setting, words):
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf8') as f:
        f.write('\n'.join(words) + '\n')
        name = f.name
    args = ['hb-shape', f'--font-file={path}', f'--face-index={index}', f'--text-file={name}', '--output-format=json', '--no-glyph-names', '--cluster-level=1', '--language=und']
    if setting is not None:
        args.append(f'--variations={setting[1]}' if setting[0] == 'variations' else f'--named-instance={setting[1]}')
    r = run(args)
    os.unlink(name)
    lines = r.stdout.splitlines()
    return lines if len(lines) == len(words) else None


def upem_of(path, index):
    r = run(['hb-info', '--show-upem', f'--face-index={index}', path])
    m = re.search(r'(\d+)', r.stdout)
    return int(m.group(1)) if m else 1000


def scan_face(job):
    path, index, groups = job
    covered = unicodes(path, index)
    if not covered:
        return {'path': path, 'index': index, 'error': 'no cmap'}
    upem = upem_of(path, index)
    result = {'path': path, 'index': index, 'upem': upem, 'words': 0, 'settings': 0, 'negativeGlyphs': 0, 'negativeTails': [], 'nearZero': [], 'rounded': []}
    words, starts, names = [], [], []
    for g in groups:
        for item in g['words']:
            w = item['w']
            if all(ord(ch) in covered or ord(ch) in IGNORABLE for ch in w):
                words.append(w); starts.append(item['starts']); names.append(g['name'])
    if not words:
        return result
    for setting in settings(path, index):
        lines = shape(path, index, setting, words)
        if lines is None:
            result.setdefault('shapeErrors', []).append(str(setting))
            continue
        result['settings'] += 1
        for k, line in enumerate(lines):
            try:
                glyphs = json.loads(line)
            except json.JSONDecodeError:
                continue
            if any(gl['g'] == 0 for gl in glyphs):
                continue
            result['words'] += 1
            per = {}
            negative = False
            for gl in glyphs:
                per[gl['cl']] = per.get(gl['cl'], 0) + gl['ax']
                if gl['ax'] < 0:
                    negative = True
            if negative:
                result['negativeGlyphs'] += 1
            # Tails from each grapheme start after the first: advances of clusters at or after it.
            ws = starts[k]
            worst = None
            for s in ws[1:]:
                tail = sum(v for c, v in per.items() if c >= s)
                if worst is None or tail < worst[0]:
                    worst = (tail, s)
            if worst is None:
                continue
            record = {'group': names[k], 'word': words[k], 'setting': setting, 'tail': worst[0], 'at': worst[1], 'glyphs': [[gl['cl'], gl['ax']] for gl in glyphs]}
            if worst[0] < 0:
                if len(result['negativeTails']) < 400:
                    result['negativeTails'].append(record)
                result['negativeTailCount'] = result.get('negativeTailCount', 0) + 1
            elif negative and worst[0] < upem * 0.05:
                if len(result['nearZero']) < 50:
                    result['nearZero'].append(record)
                # Gecko rounds each glyph's advance to app units: round(ax * size * 60 / upem) (gfxHarfBuzzShaper.cpp:1699-1702).
                for size10 in range(90, 961):
                    size = size10 / 10
                    scale = size * 60 / upem
                    per_r = {}
                    for gl in glyphs:
                        per_r[gl['cl']] = per_r.get(gl['cl'], 0) + math.floor(gl['ax'] * scale + 0.5)
                    tail_r = min(sum(v for c, v in per_r.items() if c >= s) for s in ws[1:])
                    if tail_r < 0:
                        result['rounded'].append({**record, 'size': size, 'roundedTail': tail_r})
                        break
    return result


def main():
    files = [l.strip() for l in open(sys.argv[1]) if l.strip()]
    groups = json.load(open(sys.argv[2]))
    out = sys.argv[3]
    jobs_n = 6
    for a in sys.argv[4:]:
        if a.startswith('--jobs='):
            jobs_n = int(a.split('=')[1])
    jobs = []
    for path in files:
        for index in range(faces_of(path)):
            jobs.append((path, index, groups))
    print(f'{len(jobs)} faces', flush=True)
    results = []
    with Pool(jobs_n) as pool:
        for i, r in enumerate(pool.imap_unordered(scan_face, jobs)):
            results.append(r)
            if (i + 1) % 50 == 0:
                print(f'{i + 1}/{len(jobs)} faces', flush=True)
    summary = {
        'faces': len(results), 'wordShapings': sum(r.get('words', 0) for r in results),
        'facesWithNegativeGlyphs': sum(1 for r in results if r.get('negativeGlyphs', 0) > 0),
        'facesWithNegativeTails': sum(1 for r in results if r.get('negativeTailCount', 0) > 0),
        'negativeTails': sum(r.get('negativeTailCount', 0) for r in results),
        'facesWithRoundedNegativeTails': sum(1 for r in results if r.get('rounded')),
    }
    json.dump({'summary': summary, 'results': results}, open(out, 'w'), ensure_ascii=False)
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
