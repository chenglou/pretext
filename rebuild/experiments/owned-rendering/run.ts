// Native-browser validation driver. Run under the canonical exclusive lock with --validate-only --foreground.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { CHROME_PIN_ARGS, FIREFOX_PIN_PREFS, labApp, readBuild, userAgentMatches } from '../../lab/browser-build.ts'
import { buildChat, buildMessages } from '../../bench/cases.ts'
import type { Plan, Input, PostedResult } from './browser.ts'

const REPO = resolve(import.meta.dir, '../../..')
const MAIN = resolve(REPO, '../pretext')
const PROFILES_DIR = join(REPO, '.artifacts/profiles')
const LOCK_ROOT = '/private/tmp/pretext-eng-20260912'
const runId = randomUUID()
const arg = (key: string): string | undefined => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3)
const browser = arg('browser') ?? 'chrome'
if (browser !== 'chrome' && browser !== 'firefox' && browser !== 'safari') throw new Error('--browser=chrome|firefox|safari required')
const foreground = process.argv.includes('--foreground')
const validateOnly = process.argv.includes('--validate-only')
if (!validateOnly) throw new Error('Timing mode is disabled for this fixed-word prototype: required wrapping, padding, soft-hyphen and styled-boundary capability checks fail. Use --validate-only. See rebuild/experiments/owned-rendering/README.md and rebuild/experiments/owned-rendering/capability-check.ts.')
const smoke = process.argv.includes('--smoke')
if (!foreground) throw new Error('This experiment only runs visible foreground browsers; pass --foreground')
const scaleFactor = arg('device-scale-factor') ?? null
if (scaleFactor !== null && browser === 'safari') throw new Error('Safari uses the display DPR')
const validationHoldMs=Number(arg('validation-hold-ms')??'0')
if(!Number.isSafeInteger(validationHoldMs)||validationHoldMs<0||validationHoldMs>300000)throw new Error('validation-hold-ms must be0..300000')
const samples = Number(arg('samples') ?? (smoke ? '3' : '8'))
const messages = Number(arg('messages') ?? (smoke ? '20' : '120'))
if (!Number.isSafeInteger(samples) || samples < 1 || !Number.isSafeInteger(messages) || messages < 1) throw new Error('samples/messages must be positive integers')
const outDir = resolve(arg('out') ?? join(REPO, '.artifacts/owned-rendering', `${Date.now()}-${browser}`))
const startedAt = new Date().toISOString()
const CHROME_APP = (): string => labApp('chrome')!.path
const FIREFOX_APP = (): string => labApp('firefox')!.path
const message = (error: unknown): string => error instanceof Error ? error.stack ?? error.message : String(error)
const sh = (cmd: string, args: string[]): string => {
  try { return execFileSync(cmd, args, {encoding: 'utf8', timeout: 15000}).trim() }
  catch (error) { return `unavailable: ${message(error).split('\n')[0]}` }
}
function lock(): {owner: unknown; ours: boolean} {
  let owner: unknown = null
  try { owner = JSON.parse(readFileSync(`${LOCK_ROOT}/browser-lock.owner`, 'utf8')) } catch {}
  return {owner, ours: typeof owner === 'object' && owner !== null && 'pid' in owner && Number(owner.pid) === process.ppid}
}
const lockStart = lock()
if (!lockStart.ours) throw new Error('Run under python3 .artifacts/session/with-browser-lock.py owned-rendering --exclusive -- bun rebuild/experiments/owned-rendering/run.ts ... (exclusive lock)')
function machine() {
  return {at: new Date().toISOString(), power: sh('pmset', ['-g','batt']), cpu: sh('sysctl',['-n','machdep.cpu.brand_string']), load: sh('sysctl',['-n','vm.loadavg']), processes: sh('ps',['-Ao','pcpu=,pid=,comm=','-r']).split('\n').slice(0,8)}
}
const machineStart = machine()
if (!machineStart.power.includes("'AC Power'") && !process.argv.includes('--allow-battery')) throw new Error('Native timing requires AC power; use --allow-battery only to record explicit battery caveat')
function hash(dir: string): string {
  const h = new Bun.CryptoHasher('sha256')
  const files = readdirSync(dir, {recursive:true}).map(String).sort()
  for (let i=0;i<files.length;i++) { const p=join(dir,files[i]!); if (!statSync(p).isFile()) continue; h.update(files[i]!); h.update('\0'); h.update(readFileSync(p)); h.update('\0') }
  return h.digest('hex')
}
function source() { return {mainHead:sh('git',['-C',MAIN,'rev-parse','HEAD']), redoHead:sh('git',['-C',REPO,'rev-parse','HEAD']), mainSrc:hash(join(MAIN,'src')), redoSrc:hash(join(REPO,'rebuild/src')), experiment:hash(import.meta.dir), experimentStatus:sh('git',['-C',REPO,'status','--short','--',relative(REPO,import.meta.dir)])} }
const sourceStart = source()
const textFont = '16px "Helvetica Neue", "PingFang TC", "Geeza Pro", "Kohinoor Devanagari", sans-serif'
const inputs: Input[] = []
for (const set of ['latin','mix','real'] as const) {
  const chat = buildChat(set,messages)
  for (let i=0;i<chat.length;i++) inputs.push({id:`${set}/${i}`,cohort:set,direction:'ltr',lang:'en',items:chat[i]!.parts.map(part=>({kind:'text',text:part.text,font:part.code?'14px Menlo':textFont,extraWidth:part.code?12:0,atomic:part.code}))})
}
for (const script of ['arabic','cjk','mixed'] as const) {
  const texts = buildMessages(script, Math.max(12,Math.floor(messages/3)))
  for(let i=0;i<texts.length;i++) inputs.push({id:`${script}/${i}`,cohort:script,direction:script==='arabic'?'rtl':'ltr',lang:script==='arabic'?'ar':script==='cjk'?'zh-Hant':'en',items:[{kind:'text',text:texts[i]!,font:textFont}]})
}
const difficult = [
  'AVATAR office affinity fi ffi fl To WA '.repeat(10),
  'https://example.com/'+ 'VeryLongMixedCaseIdentifier'.repeat(15),
  'مرحبا بالعالم لا تتوقف اللغة العربية عند حدود التنسيق '.repeat(5),
  'कर्म क्षत्रिय स्त्री हिन्दी अक्षर देवनागरी '.repeat(6),
  'עברית (123) [abc] العربية ٤٥٦ — x+y = 7. Hello! '.repeat(5),
  '👨‍👩‍👧‍👦 é 👩🏽‍💻 🇺🇸 1️⃣ 👍🏽 '.repeat(8),
  '漢字かなカナ「句読点、括弧。」한국어 '.repeat(10),
  'A\u2067אבג (123) العربية\u2069 B\u202eABC\u202c C'.repeat(8),
]
for(let i=0;i<difficult.length;i++) inputs.push({id:`difficult/${i}`,cohort:'difficult',direction:i===2?'rtl':'ltr',lang:i===2?'ar':i===3?'hi':'en',items:[{kind:'text',text:difficult[i]!,font:textFont}]})
const plan: Plan = {runId,samples,smoke,validateOnly,inputs,widths:[320,173.375,389.125,541.625],validationHoldMs,forcedDpr:scaleFactor===null?null:Number(scaleFactor)}
const build = readBuild(browser)
let baseUrl=''
let lastActivity=Date.now()
let posted: PostedResult|null=null
let doneResolve:()=>void=()=>{}
let doneReject:(error:Error)=>void=()=>{}
const done=new Promise<void>((res,rej)=>{doneResolve=res;doneReject=rej})
done.catch(()=>{})
function stopRun(error:Error):void {doneReject(error)}
type Session = { close: () => Promise<void> }

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

async function stopProcess(pid: number): Promise<void> {
  const signal = (name: NodeJS.Signals): void => {
    try { process.kill(pid, name) } catch { /* already gone */ }
  }
  signal('SIGTERM')
  const start = Date.now()
  let killed = false
  while (isAlive(pid)) {
    if (Date.now() - start > 8_000) throw new Error(`Browser process ${pid} did not exit`)
    if (!killed && Date.now() - start > 4_000) {
      killed = true
      signal('SIGKILL')
    }
    await Bun.sleep(100)
  }
}

function findPid(executable: string, marker: string): number | null {
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+) (.*)$/.exec(lines[i]!)
    if (match !== null && match[2]!.startsWith(`${executable} `) && match[2]!.includes(marker)) return Number(match[1])
  }
  return null
}

function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (error) {
    console.error(`[bench] could not remove ${path}: ${message(error)}`)
  }
}

// Chrome and Firefox start through LaunchServices, each in its own profile under .artifacts/profiles (macOS 27 blocks
// shell-spawned Firefox from its data folders). Background sessions pass -g and never activate; foreground ones activate.
// One attempt only: a failed launch can show the user a dialog.
async function launchApp(app: string, executable: string, marker: string, profile: string, appArgs: string[]): Promise<Session> {
  execFileSync('open', ['-n', ...(foreground ? [] : ['-g']), '-a', app, '--args', ...appArgs], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15_000 })
  let pid: number | null = null
  for (let i = 0; i < 100 && pid === null; i++) {
    pid = findPid(executable, marker)
    if (pid === null) await Bun.sleep(100)
  }
  if (pid === null) throw new Error(`Could not find the launched ${app} process`)
  const owned = pid
  return {
    async close() {
      await stopProcess(owned)
      await Bun.sleep(1_000)
      remove(profile)
    },
  }
}

// Foreground: a normal startup window at the page, which activates Chrome. Background: no startup window, and one inactive
// window opened through the DevTools protocol, as rebuild/lab/run.ts does (Chrome activates itself for normal windows).
// --enable-precise-memory-info makes performance.memory exact, so heap drops across samples show collections.
async function launchChrome(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `bench-chrome-${runId}`)
  mkdirSync(profile, { recursive: true })
  const app = CHROME_APP()
  // CHROME_PIN_ARGS keeps the copy out of Chrome's updater (lab README, "Pinned browsers").
  const common = [`--user-data-dir=${profile}`, ...CHROME_PIN_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-update', '--enable-precise-memory-info', '--window-size=1200,900', ...(scaleFactor === null ? [] : [`--force-device-scale-factor=${scaleFactor}`])]
  if (foreground) return await launchApp(app, `${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [...common, '--new-window', url])
  const session = await launchApp(app, `${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [
    ...common, '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--no-startup-window', '--remote-debugging-port=0',
  ])
  try {
    await openBackgroundChromeWindow(profile, url)
  } catch (error) {
    await session.close()
    throw error
  }
  return session
}

async function openBackgroundChromeWindow(profile: string, url: string): Promise<void> {
  const portFile = join(profile, 'DevToolsActivePort')
  let endpoint: string | null = null
  for (let i = 0; i < 150 && endpoint === null; i++) {
    try {
      const match = /^(\d+)\n(\/devtools\/browser\/[0-9a-f-]+)\n?$/.exec(readFileSync(portFile, 'utf8'))
      if (match !== null) endpoint = `ws://127.0.0.1:${match[1]}${match[2]}`
    } catch {
      // Not written yet.
    }
    if (endpoint === null) await Bun.sleep(100)
  }
  if (endpoint === null) throw new Error('Chrome did not write DevToolsActivePort')
  const socket = new WebSocket(endpoint)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Target.createTarget did not answer in 15s')), 15_000)
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('DevTools socket error'))
      }
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true, background: true } }))
      socket.onmessage = event => {
        const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string } }
        if (reply.id !== 1) return
        clearTimeout(timer)
        if (reply.error === undefined) resolve()
        else reject(new Error(`Target.createTarget: ${reply.error.message}`))
      }
    })
  } finally {
    socket.close()
  }
}

// dom.max_script_run_time 0: the page runs long synchronous rounds, and Firefox's slow-script warning would otherwise
// interrupt them.
function launchFirefox(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `bench-firefox-${runId}`)
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string | number]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false], ['dom.max_script_run_time', 0],
    // Firefox updates the bundle it runs from; these keep the pinned copy at its build.
    ...FIREFOX_PIN_PREFS,
  ]
  if (scaleFactor !== null) prefs.push(['layout.css.devPixelsPerPx', scaleFactor])
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  const app = FIREFOX_APP()
  return launchApp(app, `${app}/Contents/MacOS/firefox`, ` --profile ${profile} `, profile, ['--new-instance', '--profile', profile, url])
}

function appleScript(lines: string[]): string {
  return execFileSync('osascript', lines.flatMap(line => ['-e', line]), { encoding: 'utf8', timeout: 15_000 }).trim()
}

// Foreground only: the user's Safari, activated, with one new window at the page. Closing closes that window's tab only
// when it still shows this run's page.
function launchSafari(url: string): Session {
  const windowId = Number.parseInt(appleScript([
    'tell application "Safari"',
    'activate',
    `make new document with properties {URL:${JSON.stringify(url)}}`,
    'return id of front window as string',
    'end tell',
  ]), 10)
  if (!Number.isFinite(windowId)) throw new Error('Could not find the Safari bench window')
  return {
    async close() {
      try {
        appleScript([
          'tell application "Safari"',
          `set targetWindow to first window whose id is ${windowId}`,
          `set ownedTabs to tabs of targetWindow whose URL starts with ${JSON.stringify(`${baseUrl}/experiment?run=${runId}`)}`,
          'if (count of ownedTabs) is 1 then close item 1 of ownedTabs',
          'end tell',
        ])
      } catch {
        // The window may already be gone.
      }
    },
  }
}


let session: Session|null=null
let server: ReturnType<typeof Bun.serve>|null=null
const errors:string[]=[]
const progress:unknown[]=[]
let bundle=''
process.on('SIGINT',()=>stopRun(new Error('Interrupted')))
process.on('SIGTERM',()=>stopRun(new Error('Terminated')))
try {
  const built=await Bun.build({entrypoints:[join(import.meta.dir,'browser.ts')],target:'browser',format:'esm',minify:false})
  if(!built.success) throw new Error(built.logs.map(String).join('\n'))
  bundle=await built.outputs[0]!.text()
  const headers={'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin','cache-control':'no-store'}
  server=Bun.serve({hostname:'127.0.0.1',port:0,maxRequestBodySize:64*1024*1024,async fetch(request) {
    lastActivity=Date.now()
    const url=new URL(request.url)
    if(url.pathname==='/experiment') return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Owned text experiment</title><style>body{background:white;color:black;margin:16px;font:14px sans-serif}#status{position:sticky;top:0;background:#fff;z-index:99}h2{font-size:14px;margin:10px 0}</style><p id="status">Keep this page visible and focused. Running…</p><div id="results"></div><script type="module" src="/page.js"></script>',{headers:{...headers,'content-type':'text/html;charset=utf-8'}})
    if(url.pathname==='/page.js') return new Response(bundle,{headers:{...headers,'content-type':'text/javascript;charset=utf-8'}})
    if(url.pathname==='/api/plan') return new Response(JSON.stringify(plan).replace(/[\u007f-\uffff]/g,ch=>`\\u${ch.charCodeAt(0).toString(16).padStart(4,'0')}`),{headers:{...headers,'content-type':'application/json;charset=utf-8'}})
    if(url.pathname==='/api/progress') {const p=await request.json();progress.push(p);console.log(`[owned] ${browser} ${JSON.stringify(p)}`);return Response.json({ok:true})}
    if(url.pathname==='/api/done') {posted=await request.json() as PostedResult;doneResolve();return Response.json({ok:true})}
    if(url.pathname==='/api/fatal') {const p=await request.json() as {message:string};stopRun(new Error(p.message));return Response.json({ok:true})}
    return new Response('',{status:404})
  }})
  baseUrl=`http://127.0.0.1:${server.port}`
  const url=`${baseUrl}/experiment?run=${runId}`
  console.log(`[owned] ${browser} ${build.appVersion}, ${inputs.length} inputs, ${samples} samples, foreground; ${url}; ${outDir}`)
  if(browser==='chrome') session=await launchChrome(url)
  else if(browser==='firefox') session=await launchFirefox(url)
  else session=launchSafari(url)
  const watchdog=setInterval(()=>{if(Date.now()-lastActivity>Number(arg('stall-ms')??'600000')) stopRun(new Error('No page activity before timeout'))},1000)
  try {await done;if(validationHoldMs>0){console.log(`[owned] Holding native page${validationHoldMs}ms for screenshots / browser-zoom recheck`);await Bun.sleep(validationHoldMs)}} finally {clearInterval(watchdog)}
  if(posted===null) throw new Error('No posted result')
  const result=posted as PostedResult
  if(result.runId!==runId) errors.push('Wrong run ID')
  if(!userAgentMatches(browser,build,result.environment.userAgent)) errors.push('User agent does not match launched build')
  if(result.environmentViolations.length>0) errors.push(`${result.environmentViolations.length} focus/visibility/DPR violations`)
} catch(error) {errors.push(message(error))}
finally {
  if(session!==null) try {await session.close()} catch(error) {errors.push(`Browser close: ${message(error)}`)}
  server?.stop(true)
  const sourceEnd=source()
  if(JSON.stringify(sourceStart)!==JSON.stringify(sourceEnd)) errors.push('Source changed during run')
  const report={schema:'owned-rendering-experiment-1',status:errors.length===0?'ok':'error',errors,runId,browser,build,app:labApp(browser),mode:'foreground',smoke,startedAt,finishedAt:new Date().toISOString(),machine:{start:machineStart,end:machine()},lock:{start:lockStart,end:lock()},source:{before:sourceStart,after:sourceEnd},bundleBytes:bundle.length,plan,result:posted,progress}
  mkdirSync(outDir,{recursive:true})
  writeFileSync(join(outDir,`${browser}.json`),JSON.stringify(report,null,2)+'\n')
  const result=posted as PostedResult|null
  if(result!==null)writeFileSync(join(outDir,`${browser}-gallery.html`),'<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Owned text painting observations</title><style>body{background:white;color:black;margin:16px;font:14px sans-serif}h2{font-size:14px;margin:10px 0}section{margin-bottom:16px}</style>'+result.galleryHtml)
  const lines=[`# Owned rendering experiment: ${browser}`,`Status: ${report.status}. Foreground; smoke=${smoke}.`, 'Preparation and layout use native Canvas. DOM painting observations are separate from timing. Native-paragraph wrap equality is not a requirement.', '| cohort | phase | prototype ms | main ms | ratio | prototype Canvas calls | main Canvas calls |','|---|---|---:|---:|---:|---:|---:|']
  if(result!==null) for(const r of result.rows) lines.push(`| ${r.cohort} | ${r.phase} / ${r.mode} | ${r.prototype.medianMs.toFixed(4)} | ${r.main.medianMs.toFixed(4)} | ${(r.prototype.medianMs/r.main.medianMs).toFixed(3)} | ${r.prototype.canvasCalls} | ${r.main.canvasCalls} |`)
  if(result!==null) lines.push('',`Painting observations: ${result.validation.length}; inspect JSON for geometry, logical-order copying, bidi positions, and zoom.`,...result.limitations.map(s=>`- ${s}`))
  lines.push('',...errors.map(s=>`Error: ${s}`))
  writeFileSync(join(outDir,`${browser}.md`),lines.join('\n')+'\n')
  console.log(`[owned] ${browser}: ${report.status}; ${join(outDir,`${browser}.json`)}`)
}
process.exit(errors.length===0?0:1)
