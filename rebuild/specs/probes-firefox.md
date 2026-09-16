# Firefox 156.0 probe results for the Gecko specs

Measured 2026-09-16 in installed Firefox 156.0 (`rv:156.0`) on macOS 27, Retina display. The hypotheses come from
`gecko-lines.md` §10, `gecko-canvas.md` §5, `gecko-text.md` §18 and the Gecko items of `CRITIC.md` §6. Six
cross-cutting checks were added. The probes are `rebuild/probes/gecko-probes.ts`; the verdicts are computed by
`rebuild/probes/gecko-verdicts.ts`.

## Setup

- Firefox headed in the background with its own profile (runner `rebuild/probes/runner.ts`), window never focused,
  `devicePixelRatio` 2, `visualViewport.scale` 1, window 1280 CSS px wide.
- Every probe family resolves (Courier New, Georgia, Hoefler Text, Geeza Pro, Hiragino Sans, PingFang SC, Thonburi,
  Times New Roman, Helvetica Neue, Arial, Apple Color Emoji). Page `lang="en"` unless the probe is about language.
- Locales: macOS `AppleLocale` = `zh-Hans_US`, `AppleLanguages` = `zh-Hans-US, en-US`. Firefox's `navigator.languages`
  = `en-US, en`.
- Runs, one per locked job, all `status: ok`, 0 probe or observation errors:
  - `main`: 98 probes at DPR 2, 30 app units per device pixel (apd 30).
  - `apd60`, `apd40`, `apd27`, `apd23`: the 6 probes where apd matters (`GECKO_PROBE_SET=apd`), with
    `--firefox-prefs` setting `layout.css.devPixelsPerPx` to `1.0`, `1.5`, `2.2222222` and `2.6086957`. They give apd
    60 (DPR 1), 40 (DPR 1.5), 27 (the apd of 110% full zoom at DPR 2) and 23 (the apd of 133% full zoom at DPR 2).
    The pref reaches the same apd formula as a display scale (`nsDeviceContext.cpp:52-63`), but no run used the
    zoom UI.
  - `followup`: `gecko-canvas H3b`, added after the main run to test the explanation of H3.
- Outputs: `.artifacts/probes/gecko/{main,apd60,apd40,apd27,apd23,followup}/firefox-probes.json`, `verdicts.json`.

```sh
cd ~/github/pretext-rebuild
python3 .artifacts/session/with-browser-lock.py probes-gecko-firefox-main -- \
  bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-probes.ts --out=.artifacts/probes/gecko/main
GECKO_PROBE_SET=apd python3 .artifacts/session/with-browser-lock.py probes-gecko-firefox-apd60 -- \
  bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-probes.ts --out=.artifacts/probes/gecko/apd60 \
  --firefox-prefs=.artifacts/probes/gecko/prefs-apd60.json
bun rebuild/probes/gecko-verdicts.ts
```

## Method

- Each probe is one script. It builds its elements in the fixed host, awaits `document.fonts.ready` and two animation
  frames, and records checks (the hypothesis's claims) and preconditions. It runs twice in its document and keeps the
  second pass. All 99 probes measured the same values in both passes.
- Widths are compared as integer app units, `Math.round(px * 60)`, unless a hypothesis names a tolerance. Thresholds
  are computed in the page from Canvas or DOM measurements.
- Line starts come from `Range.getClientRects()` per grapheme cluster. Firefox gives the base of a base + mark
  cluster a zero-width rect and the mark the whole advance, so per-code-point starts land on the mark. The first run
  refuted gecko-text H20 and H25 for that reason alone.
- Verdicts: **confirmed** when every check holds in every run the probe took part in; **refuted** when a check
  failed; **inconclusive** when a precondition failed.
- Result: 95 confirmed, 4 refuted, 0 inconclusive, 1 not run (gecko-canvas H24 part a).

## Results

| id | verdict | measured | expected |
|---|---|---|---|
| gecko-lines H1 | confirmed | width 86.4px: {"starts":[0],"texts":["aaaa bbbb"]}; width 86.38px: {"starts":[0,5],"texts":["aaaa","bbbb"]} | 86.4px: 1 line; 86.38px: 2 lines (aaaa / bbbb) |
| gecko-lines H2 | confirmed | aaaa bbbb cccc at 86.4px: {"starts":[0,10],"texts":["aaaa bbbb","cccc"]} | aaaa bbbb cccc at 86.4px: 2 lines, aaaa bbbb / cccc |
| gecko-lines H3 | confirmed | Starts [0] at 72px and [0, 5] at 71.99px; DOM span 4320 au. Same at apd 30, 60, 40, 27 and 23 | 16px Georgia aaaa bbbb = 4320 au: 1 line at 72px, 2 lines at 71.99px, at every DPR and zoom |
| gecko-lines H4 | confirmed | DOM span au: 5193; width 86.55px: {"starts":[0],"texts":["aaaa bbbb"]}; width 86.5px: {"starts":[0,5],"texts":["aaaa","bbbb"]} | letter-spacing 0.01px: aaaa bbbb = 5193 au; 1 line at 86.55px, 2 lines at 86.5px |
| gecko-lines H5 | confirmed | DOM span au: 5724; width 95.4px: {"starts":[0],"texts":["aaaa bbbb"]}; width 95.35px: {"starts":[0,5],"texts":["aaaa","bbbb"]} | letter-spacing 1px: 5724 au; 1 line at 95.4px, 2 lines at 95.35px |
| gecko-lines H6 | confirmed | DOM span au: 5280; width 88px: {"starts":[0],"texts":["aaaa bbbb"]}; width 87.95px: {"starts":[0,5],"texts":["aaaa","bbbb"]} | word-spacing 10%: 5280 au; 1 line at 88px, 2 lines at 87.95px |
| gecko-lines H7 | confirmed | DOM span a NBSP b: 38.8; OC a NBSP b: 28.8; OC a b: 38.8 | DOM word-spacing 10px a NBSP b = 38.8px; OC wordSpacing 10px: a NBSP b 28.8px, a b 38.8px |
| gecko-lines H8 | confirmed | x aaaa-1111: {"starts":[0,2,7],"texts":["x","aaaa-","1111"]}; aaaa-1111: {"starts":[0,5],"texts":["aaaa-","1111"]}; aaaa-1111 nowrap: {"starts":[0],"texts":["aaaa-1111"]} | 57.6px: x / aaaa- / 1111; aaaa-1111: aaaa- / 1111; nowrap: 1 line |
| gecko-lines H9 | confirmed | anywhere: {"starts":[0,3,9],"texts":["aa","bbbbbb","bbbb"]}; break-word: {"starts":[0,3,9],"texts":["aa","bbbbbb","bbbb"]} | overflow-wrap anywhere and break-word, 57.6px, aa bbbbbbbbbb: starts 0, 3, 9 |
| gecko-lines H10 | confirmed | lines: {"starts":[0,3],"texts":["aa","bbbbbb"]} | aa b&lt;span&gt;bbbbb&lt;/span&gt; at 57.6px: aa / bbbbbb, line 2 starts at 3 |
| gecko-lines H11 | confirmed | lines: {"starts":[0],"texts":["foobar"]} | &lt;b&gt;foo&lt;/b&gt;bar at 28.8px: 1 overflowing line |
| gecko-lines H12 | refuted | At 57.6px without padding: starts [0, 4] (aaa / aaa b), the same as with padding. See correction 1 | padding-right 9.6px span: aaa / aaa b; control: aaa aaa / b |
| gecko-lines H12b | confirmed | with padding-right 9.6px at 67.2px: {"starts":[0,4],"texts":["aaa","aaa b"]}; without padding at 67.2px: {"starts":[0,8],"texts":["aaa aaa","b"]} | H12 at a discriminating width, 67.2px (4032 au = aaa aaa): with padding-right 9.6px aaa / aaa b; without aaa aaa / b |
| gecko-lines H13 | confirmed | lines: {"starts":[0,7],"texts":["aaaa  ","bb"]}; x of first a: 19.2 | pre-wrap right-aligned aaaa   bb at 57.6px: aaaa + 3 spaces / bb; first a at x = 19.2px |
| gecko-lines H14 | confirmed | lines: {"starts":[0,6],"texts":["aaaa  "," bb"]} | break-spaces aaaa   bb at 57.6px: line 2 starts with the space at index 6 |
| gecko-lines H15 | confirmed | a\tb: 76.8; aaaaaaa\tb: 76.8; aaaaaaaa\tb: 153.6; a\tb with text-indent 57.6px: 76.8 | pre tab stops: x of b 76.8, 76.8, 153.6, and 76.8 with text-indent 57.6px |
| gecko-lines H16 | confirmed | lines: {"starts":[0,5],"texts":["aaaa­","bbbb"]}; span first rect width: 52 | hyphens manual, letter-spacing 1px, 53px, &lt;span&gt;aaaa&amp;shy;bbbb&lt;/span&gt;: aaaa- / bbbb; span first rect 52px |
| gecko-lines H17 | confirmed | (A) lines: {"starts":[0,3],"texts":["ああ","いい"]}; (B) lines: {"starts":[0,3],"texts":["ああ　","いい"]}; (A) x of first あ: 16; (B) x of first あ: 0 | Hiragino Sans right-aligned at 48px: (A) 2 lines, first あ at x 16; (B) 2 lines, first あ at x 0 |
| gecko-lines H18 | confirmed | DOM a\rb: 19.2; DOM a\fb: 19.2; DOM a\vb: 19.2; OC a\rb: 28.8; OC a\fb: 28.8; OC a\vb: 28.8; DOM a \r b: 38.4; DOM a  b: 28.8 | DOM a\rb, a\fb, a\vb = 19.2px (OC 28.8px); a \r b = 38.4px; a  b = 28.8px |
| gecko-lines H19 | confirmed | Georgia x60: 4320; Courier New x60: 5184.0001 | OC widths x60: Georgia aaaa bbbb within 1e-3 of 4320; Courier New 5184 |
| gecko-lines H20 | confirmed | DOM lines at 64.7px: {"starts":[0,5],"texts":["aaaa","bbbb"]}; DOM span au: 3884; OC au: 3879.9998 | 14.4px Georgia aaaa bbbb at 64.7px: DOM 2 lines (DOM 3884 au); OC 3880 au |
| gecko-lines H21 | confirmed | DOM span == OC letterSpacing 0.001px: {"dom":24.5,"oc":24.5}; OC 2px - OC 0.001px: 8 | Geeza Pro letter-spacing 2px span بببب == OC with letterSpacing 0.001px; OC 2px is 8px wider |
| gecko-lines H22 | confirmed | with span: {"starts":[0,5],"texts":["aaaa­","bbbb"]}; without span: {"starts":[0,5],"texts":["aaaa­","bbbb"]}; right-aligned x of first a with span (9.6 when the hyphen counts, 19.2 without it): 9.6; right-aligned x of first a without span: 9.6 | aaaa&amp;shy;&lt;span&gt;bbbb&lt;/span&gt; at 57.6px: aaaa- / bbbb, same as without the span |
| gecko-lines H23 | confirmed | lines: {"starts":[0,9],"texts":["aaaaaaaa","bb"]}; line 1 right: 76.8 | aaaaaaaa bb at 57.6px: line 1 extends to 76.8px; line 2 bb |
| gecko-lines H24 | confirmed | lines: {"starts":[0,7],"texts":["aaaa","bb"]}; span first rect width: 38.4 | pre-line &lt;span&gt;aaaa \n bb&lt;/span&gt;: 2 lines; span first rect 38.4px |
| gecko-canvas H1 | confirmed | x60 = 13000.0003 at apd 30, 60, 40, 27 and 23 | OC 16px Georgia sentence width x60 is an integer within 1e-3 (at DPR 2 and DPR 1) |
| gecko-canvas H2 | confirmed | EC width x30 integer for every word: true; EC width x60 never odd: true; \|EC - OC\| &lt;= n/60 px: {"within":true,"maxExcess":0,"equalCount":13,"words":50} | EC 16px Georgia at DPR 2: width x30 integer, x60 never odd for 50 words; \|EC - OC\| &lt;= n/60 |
| gecko-canvas H3 | refuted | OC `13.375px Arial`; EC `13.3281px Arial` (13.3 → 13.2969, 12.1 → 12.0938, 16.8 → 16.8125, 1.2em → 19.1875) | OC font 13.33px Arial reads back 13.375px Arial; EC reads back 13.33px Arial |
| gecko-canvas H4 | confirmed | 13.375px DOM - OC: {"diff":0.3334,"dom":1080.7334,"oc":1080.4}; 13.5px DOM x60 == OC x60: {"dom":65407.998,"oc":65407.998} | 13.375px Georgia: DOM - OC in (0.3, 1.2) px; 13.5px: DOM x60 == OC x60 |
| gecko-canvas H5 | confirmed | OC 13, 16, 19, 21, 23, 25, 28; DOM at DPR 2: 11.5, 12.5, 14, 16, 20, 24, 28; DOM at apd 60 equals OC at every size | OC 😀 at 10..28px Helvetica Neue: 13,16,19,21,23,25,28; DOM at DPR 2: 11.5,12.5,14,16,20,24,28; DOM at DPR 1 == OC |
| gecko-canvas H6 | confirmed | OC 24px: 25; OC 24px / 2 == DOM 12px == 12.5: {"half":12.5,"dom":12.5}; OC 32px / 2 == DOM 16px == 16: {"half":16,"dom":16} | OC 24px 😀 = 25, /2 = 12.5 = DOM 12px at DPR 2; OC 32px / 2 = 16 = DOM 16px |
| gecko-canvas H7 | confirmed | EC 12px: 16 | EC 12px 😀 at DPR 2 gives 16, not 12.5 |
| gecko-canvas H8 | confirmed | OC &lt; DOM &lt; EC: {"oc":251.7167,"dom":289.15,"ec":310.7}; DOM font-optical-sizing none == OC: {"dom":251.7167,"oc":251.7167} | 14px -apple-system pangram: OC &lt; DOM &lt; EC; DOM with font-optical-sizing none x60 == OC x60 |
| gecko-canvas H9 | confirmed | 直直直 is 48px everywhere (doesn't discriminate). abc直: OC in the ja page 44.7833 == DOM without lang 44.7833; after root lang=zh-CN the same context gives 41.8 == DOM lang=zh-CN 41.8; back in ja 44.7833; ctx.lang zh-CN 41.8 | ja page: OC sans-serif == DOM span without lang; after root lang=zh-CN the next OC == DOM lang=zh-CN; span zh-CN not followed unless ctx.lang |
| gecko-canvas H10 | confirmed | Worker [width, bbox left, bbox right]: 直 [16, 0.088, 16.104], abc直 [41.8, 0.422, 41.904], 骨直 [32, -0.488, 32.104]. All equal ctx.lang zh-CN; zh-TW and en each differ on one string; page ja: [16, -0.264, 16.12], [44.783, 0.136, 44.903], [32, -0.312, 32.12] | Worker OC without ctx.lang, 16px sans-serif 直 follows the OS locale (zh-Hans here), not the page (ja) |
| gecko-canvas H11 | confirmed | each == a b: {"base":20.9,"widths":{"\\t":20.9,"\\n":20.9,"\\v":20.9,"\\f":20.9,"\\r":20.9,"U+0085":20.…; a  b == a b + space: {"two":24.7667,"base":20.9,"space":3.8667} | OC 16px Georgia: a\tb, a\nb, a\vb, a\fb, a\rb, a U+0085 b, a U+2029 b all == a b; a  b == a b + space |
| gecko-canvas H12 | confirmed | OC hexbox wider: {"withControl":30.0333,"ab":17.0333}; EC equal: {"withControl":17.0333,"ab":17.0333}; DOM equal: {"withControl":17.0333,"ab":17.0333} | OC a U+0001 b &gt; ab; EC a U+0001 b == ab; DOM textContent a U+0001 b == ab |
| gecko-canvas H13 | confirmed | OC A LRM V == A + V: {"ALV":24,"sum":24}; EC A LRM V == EC AV: {"ALV":22.6667,"AV":22.6667}; DOM A&amp;lrm;V == DOM AV: {"ALV":22.6667,"AV":22.6667} | 18px Arial: OC A LRM V == OC A + OC V; EC A LRM V == EC AV; DOM A&amp;lrm;V == DOM AV |
| gecko-canvas H14 | confirmed | OC 0.001px &gt; 0px: {"ls0":13.65,"ls001":14.0167}; DOM 0.001px == 0: {"ls0":13.65,"ls001":13.65} | 24px Hoefler Text fi: OC letterSpacing 0.001px wider than 0px; DOM letter-spacing 0.001px == 0 |
| gecko-canvas H15 | confirmed | OC 2px - 0.001px: 6; DOM 2px - 0: 0 | 24px Geeza Pro بيت: OC letterSpacing 2px - 0.001px = 6px; DOM letter-spacing 2px - 0 = 0 |
| gecko-canvas H16 | confirmed | OC NBSP +0: 0; OC U+3000 +10: 10; DOM NBSP +10: 10; DOM U+3000 +0: 0 | 16px Georgia: OC wordSpacing 10px: a NBSP b +0, a U+3000 b +10; DOM word-spacing 10px: NBSP +10, U+3000 +0 |
| gecko-canvas H17 | confirmed | identical: {"optimizeSpeed":62.3667,"geometricPrecision":62.3667} | OC 12px Georgia Hello world: textRendering optimizeSpeed == geometricPrecision |
| gecko-canvas H18 | confirmed | normal != auto: {"normal":40,"auto":64}; none == auto: {"none":64,"auto":64} | 16px Hiragino Sans 「直」。: OC fontKerning normal != auto; none == auto |
| gecko-canvas H19 | confirmed | A V: {"whole":1740,"sum":1740}; A NBSP V: {"whole":1740,"sum":1740} | 18px Arial OC: A V == A + space + V and A NBSP V == A + NBSP + V in x60 integers |
| gecko-canvas H20 | confirmed | whole == sum of runs: {"whole":5468,"parts":[2042,1624,1802]} | OC direction ltr 18px Arial: abc אבג def == abc  + אבג +  def in x60 integers |
| gecko-canvas H21 | confirmed | EC widths x apd are integers at apd 30, 60, 40, 27 and 23; OC widths 216.6667, 72, 80.2667, 46.4, 38.6667 in every run | EC at 110% zoom on DPR 2 (apd 27): widths x27 integers; OC unchanged from 100% (compared across runs) |
| gecko-canvas H22 | confirmed | OC AV &lt;= A SHY V &lt;= A + V: {"shy":1360,"AV":1360,"sum":1440}; DOM A&amp;shy;V == AV: {"shy":22.6667,"AV":22.6667} | 18px Arial: OC AV &lt;= OC A SHY V &lt;= OC A + OC V; DOM A&amp;shy;V == DOM AV |
| gecko-canvas H23 | confirmed | DOM au == OC au share of distinct words: {"words":9565,"zero":9565,"share":1,"tokens":48151,"zeroTokenShare":1}; \|DOM - OC\| &lt;= glyph count: 0 | 10,000 corpus words at 16px Georgia: DOM x60 - OC x60 == 0 for &gt;= 99.9%, never beyond +-glyph count |
| gecko-canvas H24b | confirmed | line-break normal: {"starts":[0,1,2,3],"texts":["ぁ","ぁ","ぁ","ぁ"]}; line-break auto: {"starts":[0],"texts":["ぁぁぁぁ"]} | lang zh, Hiragino Sans, width 1px, ぁぁぁぁ: line-break normal breaks between small kana; auto does not |
| gecko-canvas H24a | not run | Offline oracle replay over the tests/wrapping Firefox rows; not a browser probe | Every Firefox 156 line start in tests/wrapping rows is a break position of the groundwork oracle built against 156 data |
| gecko-canvas H25 | confirmed | Break at the SHY; line width 38.25px (span rect and right alignment) == OC aaaa- 38.25. Georgia's cmap has no U+2010; OC U+2010 = 5.9833 = `-` with either fallback, so OC aaaa + U+2010 is 38.25 too | 16px Georgia aaaa&amp;shy;bbbb broken at the SHY: line width == OC aaaa + OC U+2010 if Georgia has U+2010, else OC aaaa- |
| gecko-text H1 | confirmed | lines: {"starts":[0],"texts":["foobar"]} | &lt;b&gt;foo&lt;/b&gt;bar at 1px: 1 line |
| gecko-text H2 | confirmed | lines: {"starts":[0,4],"texts":["foo","bar"]} | foo&lt;b&gt; &lt;/b&gt;bar at 1px: 2 lines |
| gecko-text H3 | confirmed | color span == AV: {"colorSpan":40.3167,"AV":40.3167}; AV &lt; A + V: {"AV":40.3167,"sum":42.7} | 32px Arial: &lt;span&gt;A&lt;span color&gt;V&lt;/span&gt;&lt;/span&gt; == &lt;span&gt;AV&lt;/span&gt; &lt; A + V |
| gecko-text H4 | confirmed | vertical-align:1px: {"width":2562,"sum":2562}; padding-left:0.001px: {"width":2419,"AV":2419}; padding-left:0.01px: {"width":2563,"sum":2562} | 32px Arial: vertical-align 1px == A + V; padding-left 0.001px == kerned AV; padding-left 0.01px == A + V + 1/60 |
| gecko-text H5 | confirmed | A&lt;b&gt;V&lt;/b&gt; == A + bold V: {"width":2562,"sum":2562} | 32px Arial: A&lt;b&gt;V&lt;/b&gt; == A regular + V bold |
| gecko-text H6 | confirmed | letter-spacing:0.001px: {"width":2419,"AV":2419}; letter-spacing:0.01px: {"width":2563,"sum":2562} | 32px Arial: letter-spacing 0.001px on V == kerned AV; 0.01px == A + V + 1/60 |
| gecko-text H7 | confirmed | NBSP: {"starts":[0],"texts":["foo bar"]}; ZWSP: {"starts":[0,4],"texts":["foo","bar"]} | width 1px: foo NBSP bar 1 line; foo ZWSP bar 2 lines |
| gecko-text H8 | confirmed | ( word: {"starts":[0,2],"texts":["(","word"]}; « word: {"starts":[0,2],"texts":["«","word"]} | width 1px: ( word and « word give 2 lines, the first ( or « |
| gecko-text H9 | confirmed | a\fb at 1px: {"starts":[0,2],"texts":["a","b"]}; a\fb at 500px: {"starts":[0],"texts":["a\fb"]}; a\fb width == ab: {"width":18.0833,"ab":18.0833}; a\vb at 1px: {"starts":[0,2],"texts":["a","b"]}; a\vb at 500px: {"starts":[0],"texts":["a\u000bb"]}; a\vb width == ab: {"width":18.0833,"ab":18.0833}; a\rb at 1px: {"starts":[0,2],"texts":["a","b"]}; a\rb at 500px: {"starts":[0],"texts":["a\rb"]}; a\rb width == ab: {"width":18.0833,"ab":18.0833} | a\fb, a\vb, a\rb: 2 lines at 1px; 1 line at 500px with width == ab |
| gecko-text H10 | confirmed | a \r b == pre a  b: {"width":26.9833,"pre":26.9833}; pre a  b == a + 2 space + b: {"pre":1619,"sum":1619} | a \r b at 500px: width == pre a  b == a + 2 spaces + b |
| gecko-text H11 | confirmed | DOM equal: {"withControl":18.0833,"ab":18.0833}; OC greater: {"withControl":31.0833,"ab":18.0833}; EC equal: {"withControl":18.1,"ab":18.1} | DOM a U+0001 b == ab; OC a U+0001 b &gt; ab; EC equal |
| gecko-text H12 | confirmed | 日本\n語 == 日本語: {"width":48,"noSpace":48,"space":53.3333}; abc\n日本 == abc 日本: {"width":64.4167,"space":64.4167,"noSpace":59.0833} | PingFang SC: &lt;span&gt;日本\n語&lt;/span&gt; == 日本語; &lt;span&gt;abc\n日本&lt;/span&gt; == abc 日本 |
| gecko-text H13 | confirmed | 日本\n&lt;span&gt;語&lt;/span&gt;: {"width":53.3333,"space":53.3333,"noSpace":48}; &lt;span&gt;日本&lt;/span&gt;\n語: {"width":53.3333,"space":53.3333,"noSpace":48} | PingFang SC: &lt;span&gt;日本\n&lt;span&gt;語&lt;/span&gt;&lt;/span&gt; == 日本 語; &lt;span&gt;&lt;span&gt;日本&lt;/span&gt;\n語&lt;/span&gt; == 日本 語 |
| gecko-text H14 | confirmed | lang ja: {"width":24.6,"noSpace":24.6,"space":29.05}; lang en: {"width":29.05,"noSpace":24.6,"space":29.05} | p lang=ja: 。\na == 。a; p lang=en: 。\na == 。 a |
| gecko-text H15 | confirmed | no lang: equals the ja result (no space): {"width":24.6,"noSpace":24.6,"space":29.05} | page without lang: &lt;p&gt;。\na&lt;/p&gt; == the lang=ja result iff the regional-prefs locale starts with zh or ja (this Mac: zh-Hans_US, so no space) |
| gecko-text H16 | confirmed | auto: {"starts":[0,2],"texts":["アァ","ア"]}; normal: {"starts":[0,1,2],"texts":["ア","ァ","ア"]}; loose: {"starts":[0,1,2],"texts":["ア","ァ","ア"]} | lang ja, PingFang SC, 1px, アァア: auto 2 lines (アァ, ア); normal 3; loose 3 |
| gecko-text H17 | confirmed | ja あ〜い: {"starts":[0,1,2],"texts":["あ","〜","い"]}; en あ〜い: {"starts":[0,2],"texts":["あ〜","い"]}; ja あ〜い う: {"starts":[0,2,4],"texts":["あ〜","い","う"]} | line-break normal, 1px: ja あ〜い 3 lines; en あ〜い 2 lines; ja あ〜い う 3 lines (あ〜, い, う) |
| gecko-text H18 | confirmed | 日本語 テキスト keep-all: {"starts":[0,4],"texts":["日本語","テキスト"]}; 한국어 텍스트 normal: {"starts":[0,1,2,4,5,6],"texts":["한","국","어","텍","스","트"]}; 한국어 텍스트 keep-all: {"starts":[0,4],"texts":["한국어","텍스트"]} | keep-all at 1px: 日本語 テキスト 2 lines; 한국어 텍스트 normal 6 lines, keep-all 2 |
| gecko-text H19 | confirmed | break-all span then def: {"starts":[0,1,2,3],"texts":["a","b","c","def"]}; abc then break-all span: {"starts":[0,3,4,5],"texts":["abc","d","e","f"]} | 1px: &lt;span break-all&gt;abc&lt;/span&gt;def → a, b, c, def; abc&lt;span break-all&gt;def&lt;/span&gt; → abc, d, e, f |
| gecko-text H20 | confirmed | lines: {"starts":[0,2],"texts":["é","é"]} | line-break anywhere, 1px, e U+0301 e U+0301: 2 lines |
| gecko-text H21 | confirmed | hyphens manual: {"starts":[0,3],"texts":["co­","op"]}; first line ends with a visible hyphen: {"firstRect":24,"co":17.7833}; hyphens none: {"starts":[0],"texts":["co­op"]}; "Hoefler Text" f SHY i == fi: {"fShyI":9.1667,"fi":9.1667} | co SHY op at 1px: 2 lines, first ends with a hyphen; hyphens none: 1 line; f SHY i == fi where fi is a ligature |
| gecko-text H22 | confirmed | lines: {"starts":[0,8],"texts":["a","b"]}; line widths: {"lines":[8.6,9.4833],"a":8.6,"b":9.4833} | pre-line a   \n   b at 500px: 2 lines, widths a and b |
| gecko-text H23 | confirmed | second span == Courier bar: {"second":28.8,"bar":28.8} | Georgia foo  then Courier New  bar: the second span width == Courier bar |
| gecko-text H24 | confirmed | color span == بب: {"width":44.9833,"bb":44.9833}; vertical-align span == 2 x ب: {"width":61.4,"twice":61.4} | 48px Geeza Pro: ب&lt;span color&gt;ب&lt;/span&gt; == بب; ب&lt;span vertical-align 1px&gt;ب&lt;/span&gt; == 2 x ب |
| gecko-text H25 | confirmed | ไทย): {"starts":[0,3],"texts":["ไทย",")"]}; (ไทย): {"starts":[0,4],"texts":["(ไทย",")"]}; ภาษาไทยง่ายนิดเดียว: {"starts":[0,4,7,11],"texts":["ภาษา","ไทย","ง่าย","นิดเดียว"]} | lang th Thonburi 1px: ไทย) → ไทย / ); (ไทย) → (ไทย / ); ภาษาไทยง่ายนิดเดียว starts 0, 4, 7, 11 |
| gecko-text H26 | confirmed | 1-2: {"starts":[0,2],"texts":["1-","2"]}; 12: {"starts":[0],"texts":["12"]} | 1px: 1-2 → 1- / 2; 12 → 1 line |
| gecko-text H27 | confirmed | width == Foo&lt;b&gt;bar&lt;/b&gt; Baz, != Foo&lt;b&gt;Bar&lt;/b&gt; Baz: {"capitalize":84.4333,"Foobar":84.4333,"FooBar":85.9167,"innerText":"Foobar Baz"} | text-transform capitalize foo&lt;b&gt;bar&lt;/b&gt; baz renders Foobar Baz |
| gecko-text H28 | confirmed | lines (hypothesis: 3): {"starts":[0,4,8],"texts":["foo","bar","baz"]} | nowrap p, 1px, two white-space normal spans foo  / bar baz: source reading 3 lines (foo, bar, baz); CSS reading 2 |
| gecko-text H29 | confirmed | OC a\fb == a b: {"ff":22.5333,"space":22.5333}; DOM a\fb == ab: {"ff":18.0833,"ab":18.0833} | OC a\fb == a b; DOM a\fb == ab |
| gecko-text H30 | confirmed | OC 0.001px + 6 == DOM 1px: {"oc":80.0167,"dom":80.0167} | 32px Times New Roman: OC letterSpacing 0.001px office + 6 == DOM letter-spacing 1px office |
| gecko-text H31 | confirmed | NBSP +10: 10; U+3000 +0: 0 | word-spacing 10px: a NBSP b +10px; a U+3000 b +0 |
| gecko-text H32 | confirmed | x of x == advance of U+3000 (&gt; 0): {"x":16,"rectWidth":16,"preSpanWidth":16} | U+3000 x: x left edge == one ideographic-space advance |
| gecko-text H33 | confirmed | abcאבג at 1px: {"starts":[0],"texts":["abcאבג"]}; DOM == OC runs: {"dom":3089,"sum":3089} | abcאבג at 1px: 1 line; abc אבג DOM width == OC abc  + OC אבג (direction rtl) |
| CRITIC C8 | confirmed | bbb: 26.9; bbbbbbbbbb (snapped: 5400): 5380; aaaaaaaaaa (snapped: 4800): 4840 | DPR 2 16px Georgia span bbb: 26.9px (1614 au) without device-pixel snapping |
| CRITIC C9 | confirmed | across a text node: space kept: {"width":53.3333,"space":53.3333,"noSpace":48}; inside one text node: removed: {"width":48,"space":53.3333,"noSpace":48} | PingFang SC: &lt;span&gt;日本\n&lt;span&gt;語&lt;/span&gt;&lt;/span&gt; == 日本 語; &lt;span&gt;日本\n語&lt;/span&gt; == 日本語 |
| CRITIC C12 | confirmed | all === a b: {"base":22.25,"m":{"ff":22.25,"vt":22.25,"cr":22.25}} | fresh OC 16px Arial: a\fb, a\vb, a\rb === a b |
| CRITIC C13 | confirmed | letterSpacing 1px fi == f + i + 2: {"fi":25.1333,"sum":25.1333} | OC 40px Hoefler Text letterSpacing 1px fi == W(f) + W(i) + 2 |
| CRITIC C14 | confirmed | lines: {"starts":[0],"texts":["ab"]} | text-transform full-width, 1px, Hiragino Sans, ab: Firefox 1 line |
| CRITIC W3 | refuted | Starts [0, 6]; VT rect at x 48 on line 1, width 0, nothing on line 2. Right-aligned copy: first a at x 9.6 (line 1 is 48px, the space kept) | Courier New normal 57.6px, aaaa \vbbbbb: VT kept at the start of line 2 with zero width |
| cross-cutting 1 emoji | refuted | Exact for both emoji at 8-32px at apd 30, 60, 40 and 23 (DPR 2 DOM: 10.5, 11.5, 12.5, 14, 16, 20, 24, 32). At apd 27, for both emoji: 20px DOM 19.8 vs OC(44.44px)/2.2222 = 20.25; 24px DOM 23.85 vs 24.3 | Apple Color Emoji 😀 and a ZWJ family at 8..32px: OC at size x DPR / DPR == DOM span width |
| cross-cutting 2 controls | confirmed | DOM normal a\rb: 19.2; DOM normal a\fb: 19.2; DOM normal a\vb: 19.2; DOM normal a\tb: 28.8; DOM pre a\rb: 19.2; DOM pre a\fb: 19.2; DOM pre a\vb: 19.2; DOM pre a\tb: 86.4; OC a\rb: 28.8; OC a\fb: 28.8; OC a\vb: 28.8; OC a\tb: 28.8 | Courier New: DOM a\rb, a\fb, a\vb, a\tb in normal and pre vs OC (spec: CR/FF/VT 19.2 in both; TAB 28.8 normal, 86.4 pre; OC all 28.8) |
| cross-cutting 3 ligatures | confirmed | au at letter-spacing 0 / 0.001px / 1px: Hoefler 16px DOM 1610/1610/2029, OC 1610/1669/2029; Hoefler 32px DOM 3200/3200/3644, OC 3200/3284/3644; Helvetica Neue 16px DOM 1531/1531/1889, OC 1531/1529/1889; 32px DOM 3063/3063/3416, OC 3063/3056/3416. Every textRendering and text-rendering value gives the same width | ffi fl in Hoefler Text and Helvetica Neue at 16 and 32px: DOM letter-spacing 0 / 0.001px / 1px and text-rendering vs OC letterSpacing and textRendering |
| cross-cutting 4 lang=ja | confirmed | 永骨: OC == DOM: {"oc":32,"dom":32,"ec":32,"ocBox":[0.392,31.736]}; Aa永骨: OC == DOM: {"oc":53.2,"dom":53.2,"ec":53.2,"ocBox":[0.776,52.936]} | &lt;html lang=ja&gt;: OffscreenCanvas 16px sans-serif 永骨 == DOM span; glyph boxes show which font resolved |
| cross-cutting 4 lang=zh-Hans | confirmed | 永骨: OC == DOM: {"oc":32,"dom":32,"ec":32,"ocBox":[0.328,31.512]}; Aa永骨: OC == DOM: {"oc":51.5667,"dom":51.5667,"ec":51.5667,"ocBox":[1.0234,51.0787]} | &lt;html lang=zh-Hans&gt;: OffscreenCanvas 16px sans-serif 永骨 == DOM span; glyph boxes show which font resolved |
| cross-cutting 4 lang=ko | confirmed | 永骨: OC == DOM: {"oc":27.6667,"dom":27.6667,"ec":27.6667,"ocBox":[0.344,27.6653]}; Aa永骨: OC == DOM: {"oc":44.9,"dom":44.9,"ec":44.9,"ocBox":[0.696,44.8987]} | &lt;html lang=ko&gt;: OffscreenCanvas 16px sans-serif 永骨 == DOM span; glyph boxes show which font resolved |
| cross-cutting 4 lang=en | confirmed | 永骨: OC == DOM: {"oc":32,"dom":32,"ec":32,"ocBox":[0.328,31.512]}; Aa永骨: OC == DOM: {"oc":51.5667,"dom":51.5667,"ec":51.5667,"ocBox":[0.7656,51.0787]} | &lt;html lang=en&gt;: OffscreenCanvas 16px sans-serif 永骨 == DOM span; glyph boxes show which font resolved |
| cross-cutting 5 system-ui | confirmed | system-ui == -apple-system. OC / DOM / DOM opsz none / EC: 13px 235.7333 / 270.4333 / 235.7333 / 289.9333; 14px 251.7167 / 289.15 / 251.7167 / 310.7; 16px 282.75 / 325.3833 / 282.75 / 350.5333; 20px 351.35 / 392.2167 / 351.35 / 428.9333 | system-ui and -apple-system at 13, 14, 16, 20px: OC, EC, DOM, DOM with font-optical-sizing none |
| cross-cutting 6 environment and line-fit grid | confirmed | DPR 2, visualViewport.scale 1. Smallest one-line width over 65 widths in 1/1024px steps: Georgia ab ab (2276 au) 37.9258, Courier New aaaa bbbb (5184 au) 86.3926, Arial Hello world (4748 au) 79.125; each is the app-unit model at apd 30, 60, 40, 27 and 23. The 1/64-device-px model at DPR 2 predicts 37.9297, 86.3984, 79.1328. Rect x on the 1/60 grid | DPR, visual viewport scale; line fit follows the app-unit grid (round(width x 60) vs text au), not 1/64 device px |
| gecko-canvas H3b | confirmed | Computed font-size: 13.33 → 13.3281, 16.8 → 16.8125, 16.81 → 16.8125, 16.8166667 → 16.8125, 16.79 → 16.7813, 14.4 → 14.4063, 10.01 → 10.0156, 100.33 → 100.375, 6.665 → 6.66406, all equal to the 10-bit value. 60 m in Georgia: 53340 au at 16.8, 16.81 and 16.8166667px; 53220 au at 16.79px | DOM font-size is Servo quantize_font_size (10 significant bits) before app units, so 16.8px lays out at 16.8125px (1009 au) |

## Spec corrections for refuted hypotheses

1. **gecko-lines H12: the control's expected lines are wrong; the padding claim holds.**
   - At 57.6px (3456 au), Courier New `aaa aaa` is 7 × 576 = 4032 au and can't fit. Both elements, with and
     without padding, give `aaa` / `aaa b`, so this width tests nothing.
   - At 67.2px (4032 au), H12b separates them:
     - with padding, the span's end padding (576 au) comes off the children's space on every line
       (`nsInlineFrame.cpp:514-521`, gecko-lines §4.2), so `aaa aaa` (4032 > 3456) breaks: `aaa` / `aaa b`;
     - without padding, `aaa aaa` fits exactly under `<=` (`gfxTextRun.cpp:1091-1092`): `aaa aaa` / `b`.
   - Fix the probe width to 67.2px.
2. **gecko-canvas H3: a connected canvas does not read back the specified size.**
   - `13.33px Arial` reads back `13.3281px Arial`. More readbacks: 13.3 → 13.2969, 12.1 → 12.0938,
     10.01 → 10.0156, 16.8 → 16.8125, 14.4 → 14.4063, 6.665 → 6.66406, 100.33 → 100.375, and `1.2em` or `120%` under
     a 16px parent → 19.1875. These are the sizes kept to 10 significant bits.
   - Source: the getter returns `resolvedFont`. That is `Servo_SerializeFontValueForCanvas` of the declarations,
     after `font-size` was overwritten with the computed size (`CanvasRenderingContext2D.cpp:2883-2893, :4358-4359`).
     Servo computes every font size through `quantize_font_size` with `BITS_TO_DROP = 14`, which keeps 10 significant
     bits (`servo/components/style/values/specified/font.rs:993-1022`).
   - The OffscreenCanvas readback (`13.375px`, 7 bits) is as stated.
   - The same quantization reaches DOM text, so gecko-canvas §1.2 C2 and gecko-lines §2.2-§2.3 need a change (H3b,
     confirmed):
     - every tested DOM element's computed `font-size` equals the 10-bit value;
     - 60 × `m` in Georgia measures 53340 au at 16.8px, 16.81px and 16.8166667px, and 53220 au at 16.79px. So
       `16.8px` lays out at 16.8125px = 1009 au, not at 1008 au.
     - The DOM size is `NSToIntRound(fround(q10(s)) * 60) / 60` with `q10(x) = d - (d - x)`, `d = fround(x * 16385)`,
       all float32.
     - C2's equality condition becomes `quantize7(s) === round(q10(s) * 60) / 60`.
     - Integers, halves, quarters and odd eighths keep their old results; 16.8px does not.
   - gecko-canvas §1.2 C1b should add that the connected canvas's `mSize` is already 10-bit quantized before
     `QuantizeFontSize(size / DPR)`.
3. **CRITIC §6 item 10 (W3): VT stays at the end of line 1, not at the start of line 2.**
   - Measured, `aaaa \vbbbbb` at 57.6px: line starts [0, 6]; VT's rect is on line 1 at x = 48 with width 0; nothing of
     it is on line 2.
   - Source: VT is line-break class BK (gecko-text §6.4 row U+000B, "BK → break after"). UAX #14 forbids a break
     before BK and requires one after it, so the only opportunity is after the VT (offset 6).
   - The trailing space before the VT is not trimmed. `IsTrimmableSpace` excludes VT (`nsTextFrame.cpp:904-919`), so
     trimming stops at the VT: right-aligned, line 1 starts at x = 9.6 (line width 48 = `aaaa` plus the space).
   - The critic's source point (VT is not trimmable) stands; its expected outcome should be "VT zero-width at the end
     of line 1, the preceding space kept in the line width".
4. **Cross-cutting 1 and gecko-canvas §1.9: "measure the emoji at `size·DPR`, divide by DPR" is not always exact.**
   - Exact for U+1F600 and the ZWJ family 👨‍👩‍👧‍👦 at 8, 10, 12, 14, 16, 20, 24 and 32px at apd 30, 60, 40 and 23.
   - Not exact at apd 27 (DPR 2.2222) for 20px and 24px, for both emoji: DOM 19.8px and 23.85px; recipe 20.25px and
     24.3px.
   - Source:
     - DOM text asks Core Text at `round(q10(s) * 60) / apd` device px: 1200/27 = 44.44px and 1440/27 = 53.33px
       (`nsFontMetrics.cpp:133-134`, `gfxMacFont.cpp:448-462`). Whole-pixel advances there are 44 and 53: 44 × 27/60
       = 19.8px, 53 × 27/60 = 23.85px.
     - OffscreenCanvas quantizes `s·DPR` to 7 significant bits (`CanvasRenderingContext2D.cpp:4207-4217, :4492`): it
       reads back `44.5px` and `53.5px`, where Core Text gives 45 and 54 (45/2.2222 = 20.25px, 54/2.2222 = 24.3px).
   - Correct statement: the recipe is exact when `quantize7(s·DPR)` and `round(q10(s)·60)/apd` get the same
     whole-pixel Core Text advance. That holds whenever `s·DPR` is itself on the 7-bit grid and equals the DOM device
     size, as for integer sizes at DPR 1 and 2. At fractional apd it can miss by one device pixel near an advance
     step, and Canvas can't measure at the exact device size.

## Other corrections and findings

5. **U+2010 (gecko-lines §2.5, §4.6, §9 "Not obtainable" item 6; gecko-canvas H25).**
   - Georgia and Courier New have no U+2010 (format 4 cmap subtable, read offline), as gecko-lines §2.5 says.
   - But Gecko's HarfBuzz nominal-glyph callback substitutes `-` for U+2010 and U+2011 when the font lacks them
     (`gfxHarfBuzzShaper.cpp:119-124`), and font matching falls back to `-` in the primary font
     (`gfxTextRun.cpp:3227-3229`).
   - So an OffscreenCanvas measuring `'‐'` doesn't fall back to another font. In Georgia it measures 5.9833px =
     359 au = `-`, whichever generic follows Georgia.
   - With `MakeHyphenTextRun` (`gfxTextRun.cpp:2461-2475`), OC `'‐'` equals the hyphen run's advance in both
     cases, provided the first font has U+2010 or `-`. §9 item 6 should say the hyphen width is obtainable.
   - H25 is confirmed but can't discriminate for Georgia: both branches give 38.25px.
6. **CRITIC §6 item 2 (C8): the proposed discriminator can't discriminate.**
   - 26.9px = 807/30 is itself a multiple of 1/30.
   - Device-pixel snapping would round each glyph to 30 au: 10 × `b` 5400 au, 10 × `a` 4800 au. Measured: 5380 and
     4840, and `bbb` = 1614 au.
   - DOM glyph advances are not snapped at DPR 2. C8 is settled in favour of gecko-lines §2.5.
7. **CRITIC C9 settled for gecko-text.**
   - `<span>日本\n<span>語</span></span>` keeps the space (53.3333px); `<span>日本\n語</span>` removes it (48px).
   - East Asian segment-break removal looks only inside the text node. gecko-lines §3.3 "those neighbors must be inside
     the same run" should say the same mapped flow.
8. **gecko-canvas H9 and H10: the stated strings don't discriminate.**
   - `直直直` and `直` measure 48px and 16px under ja, zh-CN, zh-TW and en.
   - H9 was decided with `abc直`: 44.7833px in the ja page, 41.8px under zh-CN.
   - H10 was decided with widths and `actualBoundingBox` of three strings. The worker matches `ctx.lang = 'zh-CN'` on
     all three and every other language on at most two, so it follows the macOS locale (zh-Hans), not
     `navigator.languages` (en-US) and not the page (ja).
9. **gecko-text H21 and cross-cutting 3 (ligatures).**
   - Helvetica Neue shaped by HarfBuzz has no `fi` ligature (fi = f + i = 8.2833px at 16px), so only Hoefler Text
     tests the soft-hyphen claim.
   - Still, `ctx.letterSpacing = '0.001px'` changes Helvetica Neue `ffi fl` by −2 au at 16px and −7 au at 32px. Some
     other optional ligature or GSUB lookup turns off; which one is unidentified.
   - The DOM keeps ligatures at `letter-spacing: 0.001px` (0 au) in both fonts. OC turns them off at any non-zero
     float. `textRendering` and `text-rendering` change no width.
10. **Harness notes for the other browsers' probes.** Use grapheme clusters for Firefox line starts (§ Method). In
    Firefox `document.fonts.check` is true for a nonexistent family; `resolves` is the reliable test.
11. **gecko-canvas H24 part a** (every Firefox 156 line start in the `tests/wrapping` rows is a break position of
    the groundwork oracle) is an offline replay of the oracle, not a browser probe. It was not run here. Part b (small
    kana under `line-break: normal` vs `auto`) is confirmed.
