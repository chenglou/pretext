// The engine a user agent names: the engine that lays the page out, not the browser's brand.
import { expect, test } from 'bun:test'
import { engineOfUserAgent } from './env.ts'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K)'
const KHTML = 'AppleWebKit/537.36 (KHTML, like Gecko)'
const IOS_WEBKIT = 'AppleWebKit/605.1.15 (KHTML, like Gecko)'

const AGENTS: Array<[string, string, 'blink' | 'webkit' | 'gecko']> = [
  ['Chrome on a Mac', `${MAC} ${KHTML} Chrome/153.0.0.0 Safari/537.36`, 'blink'],
  ['Edge on Windows', `${WINDOWS} ${KHTML} Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0`, 'blink'],
  ['Opera on Windows', `${WINDOWS} ${KHTML} Chrome/153.0.0.0 Safari/537.36 OPR/120.0.0.0`, 'blink'],
  ['Chrome on Android', `${ANDROID} ${KHTML} Chrome/153.0.0.0 Mobile Safari/537.36`, 'blink'],
  ['Samsung Internet', `${ANDROID} ${KHTML} SamsungBrowser/28.0 Chrome/153.0.0.0 Mobile Safari/537.36`, 'blink'],
  ['an Android WebView', `Mozilla/5.0 (Linux; Android 10; K; wv) ${KHTML} Version/4.0 Chrome/153.0.0.0 Mobile Safari/537.36`, 'blink'],
  ['Safari on a Mac', `${MAC} ${IOS_WEBKIT} Version/27.0 Safari/605.1.15`, 'webkit'],
  ['Safari on an iPhone', `${IPHONE} ${IOS_WEBKIT} Version/18.0 Mobile/15E148 Safari/604.1`, 'webkit'],
  ['Chrome on an iPhone', `${IPHONE} ${IOS_WEBKIT} CriOS/153.0.0.0 Mobile/15E148 Safari/604.1`, 'webkit'],
  ['Firefox on an iPhone', `${IPHONE} ${IOS_WEBKIT} FxiOS/156.0 Mobile/15E148 Safari/605.1.15`, 'webkit'],
  ['Edge on an iPhone', `${IPHONE} ${IOS_WEBKIT} Version/18.0 EdgiOS/153.0.0.0 Mobile/15E148 Safari/605.1.15`, 'webkit'],
  ['a WKWebView', `${MAC} ${IOS_WEBKIT}`, 'webkit'],
  ['Firefox on a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0', 'gecko'],
  ['Firefox on Android', 'Mozilla/5.0 (Android 14; Mobile; rv:156.0) Gecko/156.0 Firefox/156.0', 'gecko'],
]

test('a browser is its engine: every Chromium browser is Blink, every iOS browser is WebKit', () => {
  for (let i = 0; i < AGENTS.length; i++) {
    expect([AGENTS[i]![0], engineOfUserAgent(AGENTS[i]![1])]).toEqual([AGENTS[i]![0], { kind: 'supported', engine: AGENTS[i]![2] }])
  }
})

test('a user agent that names no engine is refused with the user agent in the answer', () => {
  expect(engineOfUserAgent('curl/8.7.1')).toEqual({ kind: 'unsupported', userAgent: 'curl/8.7.1', reason: 'unknown browser' })
})
