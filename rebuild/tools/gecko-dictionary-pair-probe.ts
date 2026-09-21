// No browser launch. Run through the existing exclusive-lock probe runner; see GECKO-DICTIONARY-PAIR.md.
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat, buildLanguages } from '../bench/cases.ts'

const BODY = String.raw`
const sets = Object.keys(SETS);
const entries = LIBS.map(entry => ({ ...entry, env: entry.lib.environment(), paragraphs: {} }));
for (const entry of entries) for (const set of sets) entry.paragraphs[set] = SETS[set].map(message => entry.lib.paragraphOf(message.parts));
const NativeCanvas = globalThis.OffscreenCanvas;
const NativeSegmenter = Intl.Segmenter;
const PROPS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontVariantCaps', 'fontStretch'];
const METRICS = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent', 'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline'];
const equal = (a, b, where) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('NATIVE PAIR MISMATCH: ' + where); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
equal(entries[0].env, entries[1].env, 'environment');
function capture(work) {
  const events = [];
  let contexts = 0, calls = 0, segmentCalls = 0;
  const constructors = [];
  globalThis.OffscreenCanvas = class {
    constructor(...args) { this.canvas = new NativeCanvas(...args); }
    getContext(...args) {
      const real = this.canvas.getContext(...args);
      const id = contexts++;
      return new Proxy(real, {
        set(target, key, value) { events.push(['set', id, String(key), value]); target[key] = value; return true; },
        get(target, key) {
          if (key === 'measureText') return text => {
            const result = target.measureText(text);
            calls++;
            events.push(['canvas', id, text, PROPS.map(p => target[p]), METRICS.map(p => result[p])]);
            return result;
          };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }
  };
  Intl.Segmenter = class extends NativeSegmenter {
    constructor(locale, options) { super(locale, options); this.requested = locale; constructors.push([locale, options]); }
    segment(text) {
      const result = super.segment(text), options = this.resolvedOptions();
      segmentCalls++;
      events.push(['segment', this.requested, options, text, [...result].map(p => [p.index, p.segment, p.isWordLike])]);
      return result;
    }
  };
  try { return { value: work(), events, contexts, calls, segmentCalls, constructors }; }
  finally { globalThis.OffscreenCanvas = NativeCanvas; Intl.Segmenter = NativeSegmenter; }
}
const verification = [];
// Full arrays, not hashes: compare context assignments, every ordered question/native answer,
// every ordered native segmentation/options/text/answer and complete ranges/pieces/break flags/gaps.
for (const set of sets) {
  let calls = 0, segments = 0, lines = 0, baseConstructors = 0, headConstructors = 0;
  for (let i = 0; i < entries[0].paragraphs[set].length; i++) {
    const a = capture(() => entries[0].lib.complete(entries[0].paragraphs[set][i], entries[0].env));
    const b = capture(() => entries[1].lib.complete(entries[1].paragraphs[set][i], entries[1].env));
    equal(a.value, b.value, set + '/' + i + '/complete line output');
    equal(a.events.length, b.events.length, set + '/' + i + '/event count');
    for (let n = 0; n < a.events.length; n++) equal(a.events[n], b.events[n], set + '/' + i + '/event/' + n + '/' + a.events[n][0]);
    calls += a.calls; segments += a.segmentCalls;
    lines += a.value.outputs.reduce((n, output) => n + output.lines, 0);
    baseConstructors += a.constructors.length; headConstructors += b.constructors.length;
  }
  // The headline path does not materialize pieces or inspection. Check it independently.
  const a = capture(() => entries[0].lib.scratch(entries[0].paragraphs[set], entries[0].env));
  const b = capture(() => entries[1].lib.scratch(entries[1].paragraphs[set], entries[1].env));
  equal(a.value, b.value, set + '/plain line count');
  equal(a.events.length, b.events.length, set + '/plain event count');
  for (let n = 0; n < a.events.length; n++) equal(a.events[n], b.events[n], set + '/plain event/' + n + '/' + a.events[n][0]);
  verification.push({ set, messages: entries[0].paragraphs[set].length, exact: true, detailedLines: lines, detailedCanvasCalls: calls, detailedSegmentationCalls: segments, baseConstructors, headConstructors, plainLines: a.value, plainCanvasCalls: a.calls, plainSegmentationCalls: a.segmentCalls });
  await pause();
}
const longVerification = [];
for (const item of LONG) for (const dictionary of [true, false]) {
  const a = capture(() => entries[0].lib.boundaries(item.text, dictionary));
  const b = capture(() => entries[1].lib.boundaries(item.text, dictionary));
  equal(a.value, b.value, item.language + '/long boundaries/dictionary=' + dictionary);
  equal(a.events, b.events, item.language + '/long segmentation/dictionary=' + dictionary);
  longVerification.push({ language: item.language, units: item.text.length, boundaries: a.value.length, dictionary, exact: true });
}
// All trace shims have been restored. Timings below use native Canvas and native Intl,
// fresh preparations at 320 px; no answer replay or trace/range materialization.
if (CONFIG.foreground) {
  const deadline = performance.now() + 30000;
  while (!document.hasFocus() || document.visibilityState !== 'visible') {
    if (performance.now() >= deadline) throw new Error('foreground Firefox focus not acquired within30s');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const focus = () => ({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState });
const requireFocus = (state, where) => {
  if (CONFIG.foreground && (!state.hasFocus || state.visibilityState !== 'visible')) throw new Error('foreground Firefox focus lost: ' + where);
};
for (const entry of entries) for (const set of sets) entry.lib.scratch(entry.paragraphs[set], entry.env);
await pause();
const rows = [];
let sink = 0;
const jobs = entries.flatMap(entry => sets.map(set => ({ entry, set })));
for (let round = 0; round < CONFIG.rounds; round++) {
  for (let k = 0; k < jobs.length; k++) {
    const index = round % 2 === 0 ? (k + round) % jobs.length : (jobs.length * CONFIG.rounds - k - round) % jobs.length;
    const { entry, set } = jobs[index];
    await pause();
    const focusBefore = focus(); requireFocus(focusBefore, 'scratch before');
    const start = performance.now();
    let lines = 0;
    for (let repeat = 0; repeat < CONFIG.repeats; repeat++) lines += entry.lib.scratch(entry.paragraphs[set], entry.env);
    const ms = performance.now() - start;
    const focusAfter = focus(); requireFocus(focusAfter, 'scratch after');
    sink += lines;
    rows.push({ round, label: entry.label, set, messages: entry.paragraphs[set].length, repeats: CONFIG.repeats, lines, ms, focusBefore, focusAfter, usPerMessage: ms * 1000 / (CONFIG.repeats * entry.paragraphs[set].length) });
  }
}
const longRows = [];
for (let round = 0; round < CONFIG.rounds; round++) for (const item of LONG) {
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[(k + round) % entries.length];
    await pause();
    const focusBefore = focus(); requireFocus(focusBefore, 'long before');
    const start = performance.now();
    for (let repeat = 0; repeat < 8; repeat++) sink += entry.lib.boundaries(item.text).length;
    const usPerCall = (performance.now() - start) * 1000 / 8;
    const focusAfter = focus(); requireFocus(focusAfter, 'long after');
    longRows.push({ round, label: entry.label, language: item.language, units: item.text.length, usPerCall, focusBefore, focusAfter });
  }
}
const median = values => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const paired = names => names.map(set => {
  const base = rows.filter(r => r.label === 'base' && r.set === set), head = rows.filter(r => r.label === 'head' && r.set === set);
  const savings = base.map(a => a.usPerMessage - head.find(b => b.round === a.round).usPerMessage);
  return { set, baseUs: median(base.map(r => r.usPerMessage)), headUs: median(head.map(r => r.usPerMessage)), pairedSavingUs: median(savings), pairedPositive: savings.filter(n => n > 0).length, pairs: savings.length, savings };
});
return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, environments: entries.map(e => ({ label: e.label, env: e.env })), config: CONFIG, verification, longVerification, rows, longRows, paired: paired(sets), sink };
`

export default async function nativeDictionaryPair(): Promise<Probe[]> {
  const trees = [process.env['GECKO_BASE_TREE'], process.env['GECKO_HEAD_TREE']]
  if (trees.some(path => path === undefined)) throw new Error('GECKO_BASE_TREE and GECKO_HEAD_TREE name the two frozen checkouts')
  const labels = ['base', 'head']
  let bundles = 'const LIBS = [];\n'
  for (let i = 0; i < trees.length; i++) {
    const src = join(trees[i]!, 'rebuild/src')
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, 'gecko-dictionary-pair-entry.ts')], target: 'browser', format: 'iife', minify: false,
      plugins: [{ name: 'pair-tree', setup(build) {
        build.onResolve({ filter: /^\.\.\/src\// }, found => found.importer.endsWith('gecko-dictionary-pair-entry.ts') ? { path: join(src, found.path.slice(7)) } : undefined)
      } }],
    })
    if (!built.success) throw new Error(`bundling ${src} failed: ${built.logs.map(String).join('\n')}`)
    bundles += `${await built.outputs[0]!.text()}\nLIBS.push({ label: ${JSON.stringify(labels[i])}, lib: globalThis.nativeDictionaryPairLib });\n`
  }
  const sets: Record<string, unknown> = { latin: buildChat('latin', Number(process.env['GECKO_CHAT_MESSAGES'] ?? 218)), mix: buildChat('mix', Number(process.env['GECKO_CHAT_MESSAGES'] ?? 218)) }
  const languages = buildLanguages(Number(process.env['GECKO_LANGUAGE_MESSAGES'] ?? 2400))
  for (const language of ['th', 'my', 'km']) sets[language] = languages.filter(m => m.language === language).map(m => ({ parts: [{ code: false, text: m.text }] }))
  const words = { th: 'ภาษาไทยเป็นภาษาที่น่าสนใจ', my: 'မြန်မာဘာသာစကား', km: 'ភាសាខ្មែរជាភាសា' }
  const long = Object.entries(words).map(([language, text]) => ({ language, text: text.repeat(Number(process.env['GECKO_LONG_REPEAT'] ?? 512)) }))
  const config = { rounds: Number(process.env['GECKO_PAIR_ROUNDS'] ?? 12), repeats: Number(process.env['GECKO_PAIR_REPEATS'] ?? 4), baseTree: trees[0], headTree: trees[1], widths: [37, 320, 440], foreground: process.env['GECKO_PAIR_FOREGROUND'] === '1' }
  return [{ id: 'gecko dictionary D1', spec: 'exact native questions, segmentation and full line output before paired fresh-preparation timings', pageLang: 'en', html: '<div></div>', browsers: ['firefox'],
    observe: [{ kind: 'script', source: `${bundles}\nconst SETS = ${JSON.stringify(sets)};\nconst LONG = ${JSON.stringify(long)};\nconst CONFIG = ${JSON.stringify(config)};\n${BODY}` }],
  }]
}
