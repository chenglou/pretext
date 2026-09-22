// Bounded plaintext A/B probe: prior redo, current redo, and actual main in one foreground page.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { buildMessages, STYLES } from '../../bench/cases.ts'
import type { Probe } from '../../probes/types.ts'

const base = process.env['PLAINTEXT_BASE'] ?? '/private/tmp/pretext-stateless-round2-baseline-20260922'
const current = process.env['PLAINTEXT_CURRENT'] ?? resolve(import.meta.dir, '../../..')
const withoutCursor = process.env['PLAINTEXT_WITHOUT_CURSOR']
const main = process.env['PLAINTEXT_MAIN'] ?? '/Users/chenglou/github/pretext'
const samples = Number(process.env['PLAINTEXT_SAMPLES'] ?? '8')
const messages = Number(process.env['PLAINTEXT_MESSAGES'] ?? '120')
const sampleFloor = Number(process.env['PLAINTEXT_SAMPLE_MS'] ?? '20')
const phases = (process.env['PLAINTEXT_PHASES'] ?? 'prepare,prepare+count,new-widths,repeated-widths').split(',')
if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(messages) || messages < 1 || sampleFloor < 20 || !Number.isFinite(sampleFloor) || phases.some(p => !['prepare','prepare+count','new-widths','repeated-widths'].includes(p))) throw new Error('invalid plaintext performance configuration')

async function bundle(source: string): Promise<string> {
  const entry = join(mkdtempSync(join(tmpdir(), 'plaintext-perf-')), 'entry.ts')
  writeFileSync(entry, source)
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(built.logs.join('\n'))
  return await built.outputs[0]!.text()
}

function redo(tree: string, range: boolean): string {
  return `import * as core from ${JSON.stringify(join(tree, 'rebuild/src/index.ts'))};
  import {UNKNOWN_FONT_FACTS} from ${JSON.stringify(join(tree, 'rebuild/src/model.ts'))};
  const detected=core.detectEnvironment(/Firefox\\//.test(navigator.userAgent)?{engine:'gecko',build:null,contentLanguage:null,regionalPrefsLocale:null}:/Chrome\\//.test(navigator.userAgent)?{engine:'blink',build:null,contentLanguage:null,uiLanguage:null}:{engine:'webkit',build:null,contentLanguage:null,pageZoom:1,preferredLanguages:null,icuDefaultLocale:null});
  if(detected.kind==='unsupported')throw new Error(detected.reason);
  function input(text,style){return {font:{...style.font,facts:UNKNOWN_FONT_FACTS},content:[{kind:'text',text}],letterSpacing:0,wordSpacing:0,whiteSpace:'normal',wordBreak:'normal',overflowWrap:'break-word',lineBreak:'auto',tabSize:8,lineHeight:20,direction:style.direction,lang:style.lang,textIndent:0,textAlign:'start'};}
  function prepareAll(inputs){return inputs.map(p=>core.prepare(p,detected.env,false));}
  function fill(prepared,widths){let n=0;for(const width of widths)for(const p of prepared){for(let start=core.firstLine(p);start!==null;){const f=core.${range?'fillLineRange':'fillLine'}(p,start,{width,left:0,right:0});if(f.kind!=='line')throw new Error('unexpected refused slot');if(f.hasLineBox)n++;start=f.next;}}return n;}
  function cuts(prepared,widths){const out=[];for(const width of widths)for(const p of prepared){const row=[];for(let start=core.firstLine(p);start!==null;){const f=core.${range?'fillLineRange':'fillLine'}(p,start,{width,left:0,right:0});if(f.kind!=='line')throw new Error('unexpected refused slot');row.push({start:f.start,end:f.end,next:f.next,hasLineBox:f.hasLineBox});start=f.next;}out.push(row);}return out;}
  globalThis.plaintextLibrary={input,prepareAll,fill,cuts,reset(){}};`
}

const BODY = String.raw`
const pause=()=>new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();r()};c.port2.postMessage(0)});
const snap=()=>({visibility:document.visibilityState,focused:document.hasFocus(),dpr:devicePixelRatio,isolated:crossOriginIsolated});
if(!crossOriginIsolated)throw new Error('performance probe requires --isolated');
let timerStep=Infinity;for(let k=0;k<1000;k++){const a=performance.now();let b=a;while(b===a)b=performance.now();timerStep=Math.min(timerStep,b-a);}
const out={snapshot:snap(),samples:SAMPLES,phases:PHASES,sampleFloor:SAMPLE_FLOOR,messages:TEXTS.length,units:TEXTS.reduce((n,t)=>n+t.length,0),timerStep,rounds:[],counts:[],cutChecks:[]};let sink=0;
for(const e of LIBS){e.inputs=TEXTS.map(t=>e.lib.input(t,STYLE));e.kept=e.lib.prepareAll(e.inputs);sink+=e.lib.fill(e.kept,[320,...WIDTHS]);}
for(let round=-2;round<SAMPLES;round++){
 const rows=[];
 for(let k=0;k<LIBS.length;k++){
  const e=LIBS[(k+round+LIBS.length*2)%LIBS.length];
  for(const phase of PHASES){
   await pause();const before=snap();if(before.visibility!=='visible'||!before.focused)throw new Error('timing page is not foreground');
   // Calibration and sampling use the same operation. Each fresh-width handle is prepared and initially filled
   // outside the clock; each prepare batch resets main's JS cache outside the clock. Sum elapsed regions for setup
   // variants, as canonical bench/page.ts does, and batch retained widths in one region.
   function run(reps){let ms=0,lines=0;
    if(phase==='repeated-widths'){const t=performance.now();for(let r=0;r<reps;r++)lines+=e.lib.fill(e.kept,WIDTHS);ms=performance.now()-t;}
    else if(phase==='new-widths'){const chunk=Math.max(1,Math.floor(2000/TEXTS.length));for(let first=0;first<reps;first+=chunk){const batches=[];for(let r=first;r<Math.min(reps,first+chunk);r++){e.lib.reset();const p=e.lib.prepareAll(e.inputs);sink+=e.lib.fill(p,[320]);batches.push(p);}const t=performance.now();for(const p of batches)lines+=e.lib.fill(p,WIDTHS);ms+=performance.now()-t;}}
    else{for(let r=0;r<reps;r++){e.lib.reset();const t=performance.now();const p=e.lib.prepareAll(e.inputs);if(phase==='prepare')sink+=p.length;else lines+=e.lib.fill(p,[320]);ms+=performance.now()-t;}}
    sink+=lines;return{ms,lines};
   }
   const maxReps=phase==='repeated-widths'?65536:16384;e.reps??={};let reps=e.reps[phase]??1;
   if(e.reps[phase]===undefined){while(true){const trial=run(reps);if(trial.ms>=Math.max(SAMPLE_FLOOR,50*timerStep))break;if(reps>=maxReps)throw new Error('unresolved timer calibration');reps*=2;}e.reps[phase]=reps;}
   let timed=run(reps);while(timed.ms<Math.max(SAMPLE_FLOOR,50*timerStep)){if(reps>=maxReps)throw new Error('sample timer unresolved');reps*=2;timed=run(reps);}e.reps[phase]=reps;const ms=timed.ms/reps,lines=timed.lines;const after=snap();if(after.visibility!=='visible'||!after.focused)throw new Error('timing page lost focus');
   rows.push({library:e.label,phase,ms,lines:lines/reps,reps,totalMs:timed.ms,before,after});
  }
 }
 if(round>=0)out.rounds.push(rows);
}
// Instrument after timing only. Keep Canvas questions out of the clock measurements.
const restores=[];let calls=0,characters=0;
for(const C of [globalThis.OffscreenCanvasRenderingContext2D,globalThis.CanvasRenderingContext2D])if(C){const old=C.prototype.measureText;C.prototype.measureText=function(t){calls++;characters+=String(t).length;return old.call(this,t)};restores.push(()=>C.prototype.measureText=old);}
try{for(const e of LIBS){for(const phase of ['prepare+count','new-widths','repeated-widths']){e.lib.reset();calls=0;characters=0;const p=e.lib.prepareAll(e.inputs);const prepareCalls=calls,prepareCharacters=characters;if(phase!=='prepare+count')e.lib.fill(p,[320]);if(phase==='repeated-widths')e.lib.fill(p,WIDTHS);calls=0;characters=0;const lines=e.lib.fill(p,phase==='prepare+count'?[320]:WIDTHS);out.counts.push({library:e.label,phase,calls,characters,prepareCalls,prepareCharacters,lines});}}}finally{for(const restore of restores)restore();}
for(const phase of ['prepare+count','new-widths','repeated-widths']){const rows=out.counts.filter(r=>r.phase===phase&&r.library!=='main');if(rows.some(r=>r.lines!==rows[0].lines))throw new Error('redo count drift in '+phase);}
let expectedCuts=null;for(const e of LIBS)if(e.lib.cuts){const p=e.lib.prepareAll(e.inputs),cuts=e.lib.cuts(p,[320,...WIDTHS,...WIDTHS]),text=JSON.stringify(cuts);if(expectedCuts===null)expectedCuts=text;else if(text!==expectedCuts)throw new Error('complete redo source/continuation drift for '+e.label);out.cutChecks.push({library:e.label,records:cuts.reduce((n,row)=>n+row.length,0),equalToBase:true});}
out.sink=sink;out.end=snap();return out;
`

export default async function probes(): Promise<Probe[]> {
  let libraries='const LIBS=[];\n'
  const variants: Array<readonly [string,string,boolean]> = [['base',base,false],['base-range',base,true],['current-full',current,false],['current-range',current,true]]
  if (withoutCursor) variants.push(['without-cursor-full',withoutCursor,false],['without-cursor-range',withoutCursor,true])
  for(const [label,tree,range] of variants){
    libraries+=await bundle(redo(tree,range));libraries+=`\nLIBS.push({label:${JSON.stringify(label)},lib:globalThis.plaintextLibrary});\n`
  }
  libraries+=await bundle(`import {prepare,layout,clearCache} from ${JSON.stringify(join(main,'src/layout.ts'))};globalThis.plaintextLibrary={input(text,style){return {text,font:style.mainFont}},prepareAll(inputs){return inputs.map(p=>prepare(p.text,p.font))},fill(prepared,widths){let n=0;for(const width of widths)for(const p of prepared)n+=layout(p,width,20).lineCount;return n},reset:clearCache};`)
  libraries+='\nLIBS.push({label:"main",lib:globalThis.plaintextLibrary});\n'
  const cases=(['latin','cjk','arabic','mixed'] as const).map<Probe>(script=>({id:`plaintext ${script}`,spec:'Exact representation round; alternating baseline/current/main preparation, fresh and repeated widths',pageLang:STYLES[script].lang,html:'<div></div>',observe:[{kind:'script',source:`${libraries}\nconst STYLE=${JSON.stringify(STYLES[script])},TEXTS=${JSON.stringify(buildMessages(script,messages))},WIDTHS=[260,380,440],SAMPLES=${samples},PHASES=${JSON.stringify(phases)},SAMPLE_FLOOR=${sampleFloor};\n${BODY}`}]}))
  for(const n of [64,128,256,512]){const style={...STYLES.arabic,lang:'he',direction:'ltr',font:{...STYLES.arabic.font,family:'Arial'},mainFont:'16px Arial'};cases.push({id:`plaintext Hebrew ${n}`,spec:'Long single script run negative control: same Canvas measurements; own prefix bookkeeping should not rescan scripts',pageLang:'he',html:'<div></div>',observe:[{kind:'script',source:`${libraries}\nconst STYLE=${JSON.stringify(style)},TEXTS=${JSON.stringify(Array(8).fill('אבגד'.repeat(n/4)))},WIDTHS=[260,380,440],SAMPLES=${samples},PHASES=${JSON.stringify(phases)},SAMPLE_FLOOR=${sampleFloor};\n${BODY}`} ]});}
  for(const n of [64,128]){const style={...STYLES.mixed,font:{...STYLES.mixed.font,family:'Arial, sans-serif'},mainFont:'16px Arial, sans-serif'};cases.push({id:`plaintext alternating ${n}`,spec:'Many script runs negative control: primary table setup and ordinal traversal',pageLang:'en',html:'<div></div>',observe:[{kind:'script',source:`${libraries}\nconst STYLE=${JSON.stringify(style)},TEXTS=${JSON.stringify(Array(4).fill('aक'.repeat(n/2)))},WIDTHS=[260,380,440],SAMPLES=${samples},PHASES=${JSON.stringify(phases)},SAMPLE_FLOOR=${sampleFloor};\n${BODY}`} ]});}
  for(const n of [64,128,256,512]){const style=STYLES.latin;cases.push({id: 'plaintext unbroken ASCII '+n,spec:'Long unbroken ASCII with narrow retained widths: inspection-only suffix scans must not burden plain filling',pageLang:style.lang,html:'<div></div>',observe:[{kind:'script',source: libraries+'\nconst STYLE='+JSON.stringify(style)+',TEXTS='+JSON.stringify(Array(4).fill('abcd'.repeat(n/4)))+',WIDTHS=[24,36,48],SAMPLES='+samples+',PHASES='+JSON.stringify(phases)+',SAMPLE_FLOOR='+sampleFloor+';\n'+BODY}]});}
  // Each timed phase owns a document. Fresh-width setup must not precede another phase's timed samples.
  // Growth controls recapture initial/count and repeated work; the ordinary cohorts keep all four phases.
  return cases.flatMap(probe => phases.filter(phase => probe.id.startsWith('plaintext Hebrew') || probe.id.startsWith('plaintext alternating') || probe.id.startsWith('plaintext unbroken ASCII')
    ? phase === 'prepare+count' || phase === 'repeated-widths' : true).map(phase => ({
      ...probe, id: `${probe.id} / ${phase}`, observe: probe.observe.map(observation => typeof observation !== 'string' && observation.kind === 'script'
        ? { ...observation, source: observation.source.replace(`PHASES=${JSON.stringify(phases)}`, `PHASES=${JSON.stringify([phase])}`) }
        : observation),
    })))
}
