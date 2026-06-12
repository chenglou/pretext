# Pretext

Pretext は複数行テキストの計測とレイアウトのための純粋な JavaScript/TypeScript ライブラリです。高速かつ正確で、存在すら知らなかったような言語も含めてあらゆる言語をサポートします。DOM、Canvas、SVG への描画に対応しており、近日中にサーバーサイドにも対応予定です。

Pretext は、ブラウザで最も高コストな処理のひとつであるレイアウトリフローを引き起こす DOM 計測 (例: `getBoundingClientRect`、`offsetHeight`) を回避します。ブラウザ自身のフォントエンジンを正解 (ground truth) とした独自のテキスト計測ロジックを実装しています (AI フレンドリーな反復手法でもあります)。

## インストール

```sh
npm install @chenglou/pretext
```

## デモ

リポジトリをクローンして `bun install` を実行し、続いて `bun start` を実行したうえで、ブラウザで `/demos/index` を開いてください。Windows では `bun run start:windows` を使用してください。
あるいは [chenglou.me/pretext](https://chenglou.me/pretext/) でライブ版を見ることもできます。さらに [somnai-dreams.github.io/pretext-demos](https://somnai-dreams.github.io/pretext-demos/) にも追加のデモがあります。

## API

Pretext は 2 つのユースケースに対応します:

### 1. _DOM に一切触れずに_ 段落の高さを計測する

```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀‎', '16px Inter')
const { height, lineCount } = layout(prepared, 320, 20) // pure arithmetic. No DOM layout & reflow!
```

`prepare()` は一度だけ行う作業を担当します。具体的には、空白の正規化、テキストのセグメント化、グルーのルール適用、Canvas によるセグメント計測を行い、不透明なハンドルを返します。`layout()` はその後の安価なホットパスで、キャッシュされた幅に対する純粋な算術処理だけを行います。同じテキストと設定に対して `prepare()` を再実行してはいけません。それでは事前計算の意味がなくなってしまいます。例えばリサイズ時には `layout()` のみを再実行してください。

通常のスペース、`\t` タブ、`\n` のハードブレークがそのまま表示される、textarea のようなテキストを扱いたい場合は、`prepare()` に `{ whiteSpace: 'pre-wrap' }` を渡してください:

```ts
const prepared = prepare(textareaValue, '16px Inter', { whiteSpace: 'pre-wrap' })
const { height } = layout(prepared, textareaWidth, 20)
```

`prepare()` のその他のオプションには、CSS の `word-break: keep-all` 相当である `{ wordBreak: 'keep-all' }` と、CSS の `letter-spacing` に対応する `{ letterSpacing: n }` (`n` は px 値として扱われます) があります。

返される高さは、Web UI を解き放つための極めて重要な最後のピースです:
- 推測やキャッシュに頼らない、適切な仮想化/オクルージョン
- 凝ったユーザーランドレイアウト: マソンリー (masonry)、JS 駆動の flexbox 風実装、CSS ハックなしで一部のレイアウト値を微調整する (想像してみてください) など
- _開発時_ における、例えばボタンのラベルが次の行にあふれていないかどうかの、ブラウザ不要での検証 (特に AI と組み合わせると有用)
- 新しいテキストが読み込まれてスクロール位置を再アンカーしたいときに、レイアウトシフトを防ぐ

### 2. 段落の各行を手動で自分でレイアウトする

`prepare` を `prepareWithSegments` に差し替えたうえで、以下を利用してください:

- `layoutWithLines()` は固定幅で全行を返します:

```ts
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments('AGI 春天到了. بدأت الرحلة 🚀', '18px "Helvetica Neue"')
const { lines } = layoutWithLines(prepared, 320, 26) // 320px max width, 26px line height
for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i].text, 0, i * 26)
```

- `measureLineStats()` および `walkLineRanges()` は、テキスト文字列を構築せずに行数、行の幅、カーソルを返します:

```ts
import { measureLineStats, walkLineRanges } from '@chenglou/pretext'

const { lineCount, maxLineWidth } = measureLineStats(prepared, 320)
let maxW = 0
walkLineRanges(prepared, 320, line => { if (line.width > maxW) maxW = line.width })
// maxW is now the widest line — the tightest container width that still fits the text! This multiline "shrink wrap" has been missing from web
```

- `layoutNextLineRange()` は、進むにつれて幅が変わる場合に、テキストを 1 行ずつ流し込むことを可能にします。実際の文字列も必要なら、`materializeLineRange()` でその 1 つのレンジを完全な行に戻せます:

```ts
import { layoutNextLineRange, materializeLineRange, prepareWithSegments, type LayoutCursor } from '@chenglou/pretext'

const prepared = prepareWithSegments(article, BODY_FONT)
let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

// Flow text around a floated image: lines beside the image are narrower
while (true) {
  const width = y < image.bottom ? columnWidth - image.width : columnWidth
  const range = layoutNextLineRange(prepared, cursor, width)
  if (range === null) break

  const line = materializeLineRange(prepared, range)
  ctx.fillText(line.text, 0, y)
  cursor = range.end
  y += 26
}
```

この使い方では Canvas、SVG、WebGL、そして (将来的には) サーバーサイドへの描画が可能です。より詳しい例は `/demos/dynamic-layout` デモを参照してください。

手動レイアウトでハイフネーションを行いたい場合は、`prepare()` / `prepareWithSegments()` を呼ぶ前にソフトハイフンを挿入してください。Pretext はそれらを任意の改行ポイントとして扱います。選択されなかったソフトハイフンは見えないままで、選択された改行は末尾の `-` として可視化されます。複数言語が混在するテキストやユーザー生成のアプリテキストでは、積極的なパターンベースのハイフネーションよりも、保守的かつロケールに応じた挿入を優先してください。自動ハイフネーションは現時点では組み込まれていません。

リッチテキストのインラインフロー、コードスパン、メンション、チップ、そしてブラウザライクな境界空白の畳み込みのために、手動レイアウトで小さなヘルパーが必要であれば、`@chenglou/pretext/rich-inline` にヘルパーがあります。これは意図的にインライン専用かつ `white-space: normal` 専用にとどめています:

```ts
import { materializeRichInlineLineRange, prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline'

const prepared = prepareRichInline([
  { text: 'Ship ', font: '500 17px Inter' },
  { text: '@maya', font: '700 12px Inter', break: 'never', extraWidth: 22 },
  { text: "'s rich-note", font: '500 17px Inter' },
])

walkRichInlineLineRanges(prepared, 320, range => {
  const line = materializeRichInlineLineRange(prepared, range)
  // each fragment keeps its source item index, text slice, gapBefore, and cursors
})
```

これは意図的に狭いスコープに絞っています:
- 境界の空白も含む生のインラインテキストを入力として受け取る
- pill (チップ風 UI) の装飾のために呼び出し側が所有する `extraWidth`
- チップやメンションのようにアトミックに保ちたい項目向けの `break: 'never'`
- `white-space: normal` のみ
- ネストしたマークアップツリーではなく、汎用の CSS インライン整形エンジンでもない

### API 用語集

ユースケース 1 の API:
```ts
prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedText // one-time text analysis + measurement pass, returns an opaque value to pass to `layout()`. Make sure `font` and `letterSpacing` are synced with your CSS for the text you're measuring. `font` is the same format as what you'd use for `myCanvasContext.font = ...`, e.g. `16px Inter`; `letterSpacing` is a CSS pixel value.
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number } // calculates text height given a max width and lineHeight. Make sure `lineHeight` is synced with your css `line-height` declaration for the text you're measuring.
```

ユースケース 2 の API:
```ts
prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedTextWithSegments // same as `prepare()`, but returns a richer structure for manual line layout needs
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): { height: number, lineCount: number, lines: LayoutLine[] } // high-level api for manual layout needs. Accepts a fixed max width for all lines. Similar to `layout()`'s return, but additionally returns the lines info
walkLineRanges(prepared: PreparedTextWithSegments, maxWidth: number, onLine: (line: LayoutLineRange) => void): number // low-level api for manual layout needs. Accepts a fixed max width for all lines. Calls `onLine` once per line with its actual calculated line width and start/end cursors, without building line text strings. Very useful for certain cases where you wanna speculatively test a few width and height boundaries (e.g. binary search a nice width value by repeatedly calling walkLineRanges and checking the line count, and therefore height, is "nice" too). You can have text messages shrinkwrap and balanced text layout this way. After walkLineRanges calls, you'd call layoutWithLines once, with your satisfying max width, to get the actual lines info.
measureLineStats(prepared: PreparedTextWithSegments, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids line/string allocations.
measureNaturalWidth(prepared: PreparedTextWithSegments): number // returns the widest forced line when width itself is not the thing causing wraps
layoutNextLine(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLine | null // iterator-like api for laying out each line with a different width! Returns the LayoutLine starting from `start`, or `null` when the paragraph's exhausted. Pass the previous line's `end` cursor as the next `start`.
layoutNextLineRange(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLineRange | null // same as layoutNextLine(), but without allocating line text strings. Useful for variable-width manual layout, occlusion, and virtualization measurements.
materializeLineRange(prepared: PreparedTextWithSegments, line: LayoutLineRange): LayoutLine // turns a LayoutLineRange from layoutNextLineRange() or walkLineRanges() into a full line with text
type LineStats = {
  lineCount: number // Number of wrapped lines, e.g. 3
  maxLineWidth: number // Widest wrapped line, e.g. 192.5
}
type LayoutLine = {
  text: string // Full text content of this line, e.g. 'hello world'
  width: number // Measured width of this line, e.g. 87.5
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}
type LayoutLineRange = {
  width: number // Measured width of this line, e.g. 87.5
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}
type LayoutCursor = {
  segmentIndex: number // Segment index in prepareWithSegments' prepared rich segment stream
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}
```

リッチテキストインラインフロー向けのヘルパー:
```ts
prepareRichInline(items: RichInlineItem[]): PreparedRichInline // compile raw inline items with their original text. The compiler owns cross-item collapsed whitespace and caches each item's natural width
layoutNextRichInlineLineRange(prepared: PreparedRichInline, maxWidth: number, start?: RichInlineCursor): RichInlineLineRange | null // stream one line of rich-text inline flow at a time without building fragment text strings
walkRichInlineLineRanges(prepared: PreparedRichInline, maxWidth: number, onLine: (line: RichInlineLineRange) => void): number // non-materializing line walker for rich-text inline flow shrinkwrap/stats work
materializeRichInlineLineRange(prepared: PreparedRichInline, line: RichInlineLineRange): RichInlineLine // turns one previously computed rich-inline line range back into full fragment text
measureRichInlineStats(prepared: PreparedRichInline, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids fragment-text allocations.
type RichInlineItem = {
  text: string // raw author text, including leading/trailing collapsible spaces
  font: string // canvas font shorthand for this item
  letterSpacing?: number // extra horizontal spacing between graphemes, in CSS px
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a chip
  extraWidth?: number // caller-owned horizontal chrome, e.g. padding + border width
}
type RichInlineCursor = {
  itemIndex: number // Which source RichInlineItem this cursor is currently in
  segmentIndex: number // Segment index within that item's prepared text
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}
type RichInlineFragment = {
  itemIndex: number // index back into the original RichInlineItem array
  text: string // Text slice for this fragment
  gapBefore: number // collapsed boundary gap paid before this fragment on this line
  occupiedWidth: number // text width plus extraWidth
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}
type RichInlineLine = {
  fragments: RichInlineFragment[] // Materialized fragments on this line
  width: number // Measured width of this line, including gapBefore/extraWidth
  end: RichInlineCursor // Exclusive end cursor for continuing the next line
}
type RichInlineFragmentRange = {
  itemIndex: number // index back into the original RichInlineItem array
  gapBefore: number // collapsed boundary gap paid before this fragment on this line
  occupiedWidth: number // text width plus extraWidth
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}
type RichInlineLineRange = {
  fragments: RichInlineFragmentRange[] // Non-materialized fragment ownership/ranges on this line
  width: number // Measured width of this line, including gapBefore/extraWidth
  end: RichInlineCursor // Exclusive end cursor for continuing the next line
}
type RichInlineStats = {
  lineCount: number // Number of wrapped lines, e.g. 3
  maxLineWidth: number // Widest wrapped line, e.g. 192.5
}
```

その他のヘルパー:
```ts
clearCache(): void // clears Pretext's shared internal caches used by prepare() and prepareWithSegments(). Useful if your app cycles through many different fonts or text variants and you want to release the accumulated cache
setLocale(locale?: string): void // optional (by default we use the current locale). Sets locale for future prepare() and prepareWithSegments(). Internally, it also calls clearCache(). Setting a new locale doesn't affect existing prepare() and prepareWithSegments() states (no mutations to them)
```

備考:
- `PreparedText` は不透明な高速パス用のハンドルです。`PreparedTextWithSegments` はより豊富な手動レイアウト用ハンドルです。
- `LayoutCursor` はセグメント/グラフェム単位のカーソルであり、生の文字列オフセットではありません。
- 空文字列に対する `layout()` は `{ lineCount: 0, height: 0 }` を返します。ブラウザは空のブロックでも 1 つの `line-height` 分のサイズを取るため、その挙動が必要な場合は `Math.max(1, lineCount) * lineHeight` でクランプしてください。
- リッチなハンドルにはカスタム bidi 対応レンダリング用の `segLevels` も含まれます。改行系の API はこれを読みません。
- セグメント幅は改行用のブラウザキャンバス幅であり、アラビア語や混在方向の x 座標を再構築するための厳密なグリフ位置データではありません。
- ソフトハイフンが選ばれて改行が決定した場合、materialize された行のテキストには末尾の `-` が可視化された形で含まれます。
- `measureNaturalWidth()` は最も幅広い強制改行行を返します。ハードブレークもカウントされます。
- `prepare()` と `prepareWithSegments()` は水平方向のみの処理を行います。`lineHeight` はレイアウト時の入力のままです。

## 制約事項

Pretext は (今のところ?) 完全なフォントレンダリングエンジンを目指していません。現時点では一般的なテキスト設定をターゲットにしています:
- `white-space: normal` および `pre-wrap`
- `word-break: normal` および `keep-all`
- `overflow-wrap: break-word`。非常に狭い幅では依然として単語内で改行することがありますが、グラフェム境界でのみ行われます。
- `line-break: auto`
- `prepare()` / `prepareWithSegments()` に数値のピクセル値として渡される `letter-spacing`
- タブはブラウザ既定の `tab-size: 8` に従います
- `{ wordBreak: 'keep-all' }` もサポートしています。CJK/ハングルや、空白を含まない混在 (ラテン/数字/CJK) テキストに対しては期待通りの挙動を示し、長すぎる連続文字に対しては `overflow-wrap: break-word` のフォールバックを維持します。
- `system-ui` は macOS における `layout()` の正確性の観点では安全ではありません。名前付きのフォントを使用してください。
- ランタイムは `Intl.Segmenter` と Canvas 2D テキスト計測を必要とします。`Intl.Segmenter` をサポートしないブラウザやランタイムは現在サポート外です。
- `font-optical-sizing`、`font-feature-settings`、独立した `font-variation-settings` といった、Canvas の `font` ショートハンドの外にある CSS テキスト機能は個別にはモデル化されていません。バリアブルフォントの軸は、アクティブな軸が Canvas のフォント文字列に (例えば weight を通じて) 反映されている場合に限り効きます。

## 開発

開発環境のセットアップとコマンドについては [DEVELOPMENT.md](https://github.com/chenglou/pretext/blob/main/DEVELOPMENT.md) を参照してください。

## クレジット

Sebastian Markbage は前の 10 年に [text-layout](https://github.com/chenglou/text-layout) で最初の種を蒔きました。彼の設計 — シェーピング用の Canvas `measureText`、pdf.js 由来の bidi、ストリーミング型の改行処理 — が、ここで我々が押し進めてきたアーキテクチャの礎となっています。
