// Page timing uses actual Canvas; DOM observations are gathered separately.
import {prepare, count, layout, type Measure, type OwnedItem, type PreparedOwned, type OwnedLine} from './core.ts'
import {paint} from './paint.ts'
import {shapingCases, type ShapingCase} from './shaping-cases.ts'
import {createMeasure} from './measure.ts'
import {prepare as mainPrepare, prepareWithSegments, layout as mainCount, layoutWithLines, clearCache} from '../../../../pretext/src/layout.ts'
import {prepareRichInline, measureRichInlineStats, walkRichInlineLineRanges, materializeRichInlineLineRange, type RichInlineItem} from '../../../../pretext/src/rich-inline.ts'

export type Input = {id:string;cohort:string;direction:'ltr'|'rtl';lang:string;items:OwnedItem[]}
export type Plan = {runId:string;samples:number;smoke:boolean;validateOnly:boolean;inputs:Input[];widths:number[];forcedDpr:number|null;validationHoldMs:number}
type Snapshot = {visibility:string;focused:boolean;dpr:number;width:number;height:number}
type Timing = {samplesMs:number[];medianMs:number;minMs:number;maxMs:number;repeats:number;canvasCalls:number;checksum:number}
type Row = {cohort:string;api:'plain'|'rich';phase:string;mode:'fresh-each-text'|'batch'|'retained';messages:number;units:number;widths:number[];prototype:Timing;main:Timing;start:Snapshot;end:Snapshot}
type Validation = {id:string;width:number;placement:string;zoom:number;dpr:number;lines:number;fragments:number;canvasCalls:number;maxAdvanceDifference:number;maxXDifference:number;maxBaselineDifference:number;maxTextBaselineDifference:number;baselinePositions:unknown[];advanceDifferences:unknown[];positionDifferences:unknown[];logicalDomText:string;expectedLogicalText:string;sourceLogicalText:string;sourceCopyMatches:boolean;normalizedSourceCopyMatches:boolean;strippedSourceCopyMatches:boolean;rangeCopyText:string;logicalOrderMatches:boolean;rangeCopyMatches:boolean;overflowGroups:unknown[];characterPositions:unknown[];bidiVisualOrder?:string;nativeVisualOrder?:string;error?:string;expectation?:string;variant?:string;note?:string}
export type PostedResult = {runId:string;environment:{userAgent:string;dpr:number};environmentViolations:string[];rows:Row[];validation:Validation[];boundaries:unknown[];limitations:string[];galleryHtml:string;measurementDiagnostics:unknown[]}

const scope = document.querySelector<HTMLElement>('#results')!
const status = document.querySelector<HTMLElement>('#status')!
const frame = ():Promise<void>=>new Promise(resolve=>requestAnimationFrame(()=>resolve()))
const snap = ():Snapshot=>({visibility:document.visibilityState,focused:document.hasFocus(),dpr:devicePixelRatio,width:innerWidth,height:innerHeight})
const median=(values:number[]):number=>{const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]!}
let consumed=0

const makeMeasure=(lang:string,scale:number=devicePixelRatio):Measure=>createMeasure(lang,scale)

// Diagnostic interception only, restored before any timed round.
function canvasCalls(fn:()=>number):{calls:number;checksum:number} {
  let calls=0
  const protos:Array<{measureText:(text:string)=>TextMetrics}>=[]
  if(typeof CanvasRenderingContext2D!=='undefined') protos.push(CanvasRenderingContext2D.prototype)
  if(typeof OffscreenCanvasRenderingContext2D!=='undefined') protos.push(OffscreenCanvasRenderingContext2D.prototype)
  const originals=protos.map(p=>p.measureText)
  for(let i=0;i<protos.length;i++) {
    const original=originals[i]!
    protos[i]!.measureText=function(this:CanvasRenderingContext2D,text:string):TextMetrics {calls++;return original.call(this,text)}
  }
  try{return {calls,checksum:fn()}} finally {for(let i=0;i<protos.length;i++) protos[i]!.measureText=originals[i]!}
}
function richItems(input:Input):RichInlineItem[] {
  return input.items.map(item=>item.kind==='atomic'?{text:item.label,font:'16px "Helvetica Neue"',break:'never',extraWidth:item.width}:{text:item.text,font:item.font,letterSpacing:item.letterSpacing??0,extraWidth:item.extraWidth??0,break:item.atomic?'never':'normal'})
}
function ownPrepare(input:Input,measure:ReturnType<typeof makeMeasure>):PreparedOwned {return prepare(input.items,{direction:input.direction,lang:input.lang,boundaryPolicy:'strict'},measure)}

async function timedPair(fnA:()=>number,fnB:()=>number,samples:number,first:boolean):Promise<[Timing,Timing]> {
  fnA();fnB()
  let repeats=1
  for(let attempts=0;attempts<8;attempts++) {
    const start=performance.now();for(let n=0;n<repeats;n++) consumed+=fnA();const elapsed=performance.now()-start
    if(elapsed>=4) break
    repeats*=2
  }
  // Common repeat count keeps paired operations equally weighted.
  const a:number[]=[],b:number[]=[]
  const run=(fn:()=>number,values:number[]):void=>{let c=0;const start=performance.now();for(let n=0;n<repeats;n++)c+=fn();values.push((performance.now()-start)/repeats);consumed+=c}
  for(let sample=0;sample<samples;sample++) {
    await frame()
    if((sample%2===0)===first){run(fnA,a);run(fnB,b)} else {run(fnB,b);run(fnA,a)}
  }
  const aa=canvasCalls(fnA),bb=canvasCalls(fnB)
  const result=(times:number[],c:{calls:number;checksum:number}):Timing=>({samplesMs:times,medianMs:median(times),minMs:Math.min(...times),maxMs:Math.max(...times),repeats,canvasCalls:c.calls,checksum:c.checksum})
  return [result(a,aa),result(b,bb)]
}

function charPositions(container:HTMLElement):Array<{offset:number;char:string;x:number;width:number;line:number}> {
  const result:Array<{offset:number;char:string;x:number;width:number;line:number}>=[]
  const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT)
  let offset=0
  let node:Node|null=walker.nextNode()
  const rootRect=container.getBoundingClientRect()
  while(node!==null) {
    const text=node.textContent??''
    for(let j=0;j<text.length;) {
      const char=String.fromCodePoint(text.codePointAt(j)!)
      const range=document.createRange();range.setStart(node,j);range.setEnd(node,j+char.length)
      const rect=range.getBoundingClientRect()
      result.push({offset:offset+j,char,x:rect.left-rootRect.left,width:rect.width,line:rect.top-rootRect.top})
      j+=char.length
    }
    offset+=text.length;node=walker.nextNode()
  }
  return result
}

async function validate(input:Input,width:number,placement:'left'|'transform',zoom:number,policy:'strict'|'independent'='strict'):Promise<Validation> {
  document.documentElement.lang=input.lang
  const measure=makeMeasure(input.lang,devicePixelRatio*zoom)
  let prepared:PreparedOwned|null=null
  let lines:OwnedLine[]=[]
  const work=canvasCalls(()=>{prepared=prepare(input.items,{direction:input.direction,lang:input.lang,boundaryPolicy:policy},measure);lines=layout(prepared,width);return lines.length})
  const element=paint(prepared!,lines,{lineHeight:28,placement})
  const section=document.createElement('section');section.lang=input.lang;section.style.zoom=String(zoom);section.id=`${input.id}-${width}-${placement}-${zoom}`.replace(/[^a-z0-9-]/gi,'_')
  const label=document.createElement('h2');label.textContent=`${input.id} width ${width}, ${placement}, CSS zoom ${zoom}`
  section.append(label,element);scope.append(section)
  await frame()
  const advanceDifferences:unknown[]=[],positionDifferences:unknown[]=[],overflowGroups:unknown[]=[],baselinePositions:Array<{line:number;item:number;font:string;baseline:number;kind:'text'|'atomic'}>=[]
  let maxAdvanceDifference=0,maxXDifference=0,fragments=0
  const expectedLines:string[]=[]
    const rows=element.querySelectorAll<HTMLElement>('.owned-line')
  for(let li=0;li<lines.length;li++) {
    const line=lines[li]!,row=rows[li]!
    if(row===undefined) throw new Error('Painter did not emit .owned-line')
    const logical=line.fragments.slice().sort((a,b)=>a.start-b.start||a.end-b.end)
    expectedLines.push(logical.map(f=>f.text).join('')+line.separator)
    const rowRect=row.getBoundingClientRect()
    for(let fi=0;fi<line.fragments.length;fi++) {
      const f=line.fragments[fi]!
      const span=row.querySelector<HTMLElement>(`[data-item="${f.itemIndex}"][data-start="${f.start}"][data-end="${f.end}"]`)
      if(span===null) throw new Error('Missing painted fragment')
      fragments++
      const ink=span.querySelector<HTMLElement>('.owned-ink')??span
      const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';ink.append(marker)
      const baseline=(marker.getBoundingClientRect().top-rowRect.top)/zoom;marker.remove()
      baselinePositions.push({line:li,item:f.itemIndex,font:f.font,baseline,kind:f.kind})
      if(f.kind==='text') {
        // Independent DOM width, no assigned model width. Clone the painter's shaping styles.
        const intrinsic=span.cloneNode(true) as HTMLElement
        intrinsic.style.width='max-content';intrinsic.style.minWidth='0';intrinsic.style.maxWidth='none';intrinsic.style.transform='none';intrinsic.style.left='0';intrinsic.style.top='0'
        intrinsic.style.position='absolute';intrinsic.style.visibility='hidden'
        row.append(intrinsic)
        const actualAdvance=intrinsic.getBoundingClientRect().width/zoom
        intrinsic.remove()
        const delta=actualAdvance-f.width
        maxAdvanceDifference=Math.max(maxAdvanceDifference,Math.abs(delta))
        if(Math.abs(delta)>0.035) advanceDifferences.push({line:li,item:f.itemIndex,start:f.start,end:f.end,text:f.text,expected:f.width,actual:actualAdvance,delta,font:f.font,direction:f.direction})
      }
      const actualX=(span.getBoundingClientRect().left-rowRect.left)/zoom
      const xDelta=actualX-f.x
      maxXDifference=Math.max(maxXDifference,Math.abs(xDelta))
      if(Math.abs(xDelta)>0.035) positionDifferences.push({line:li,item:f.itemIndex,start:f.start,end:f.end,expected:f.x,actual:actualX,delta:xDelta})
      if(f.width>width) overflowGroups.push({line:li,text:f.text,width:f.width,available:width})
    }
  }
  const range=document.createRange();range.selectNodeContents(element)
  const rangeCopyText=range.toString()
  const expectedLogicalText=((prepared as PreparedOwned|null)?.text.startsWith(' ')?' ':'')+expectedLines.join('')
  const logicalDomText=element.textContent??''
  const sourceLogicalText=input.items.map(item=>item.kind==='text'?item.text:item.label).join('')
  const normalizedSource=sourceLogicalText.replace(/[\t\r\n\f ]+/g,' ')
  const positions=charPositions(element)
  let maxBaselineDifference=0,maxTextBaselineDifference=0
  for(let li=0;li<lines.length;li++){const values=baselinePositions.filter(p=>p.line===li).map(p=>p.baseline);if(values.length>0)maxBaselineDifference=Math.max(maxBaselineDifference,Math.max(...values)-Math.min(...values))}
  for(let li=0;li<lines.length;li++){const values=baselinePositions.filter(p=>p.line===li&&p.kind==='text').map(p=>p.baseline);if(values.length>0)maxTextBaselineDifference=Math.max(maxTextBaselineDifference,Math.max(...values)-Math.min(...values))}
  const result:Validation={id:input.id,width,placement,zoom,dpr:devicePixelRatio,lines:lines.length,fragments,canvasCalls:work.calls,maxAdvanceDifference,maxXDifference,maxBaselineDifference,maxTextBaselineDifference,baselinePositions,advanceDifferences,positionDifferences,logicalDomText,expectedLogicalText,sourceLogicalText,sourceCopyMatches:rangeCopyText===sourceLogicalText,normalizedSourceCopyMatches:rangeCopyText===normalizedSource,strippedSourceCopyMatches:rangeCopyText===normalizedSource.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,''),rangeCopyText,logicalOrderMatches:logicalDomText===expectedLogicalText,rangeCopyMatches:rangeCopyText===expectedLogicalText,overflowGroups,characterPositions:positions.slice(0,160)}
  if(width===10000) {
    const reference=document.createElement('div');reference.dir=input.direction;reference.lang=input.lang;reference.style.cssText=`font:${input.items[0]!.kind==='text'?input.items[0]!.font:'16px "Helvetica Neue"'};white-space:pre;position:relative;height:28px`
    reference.textContent=input.items.map(item=>item.kind==='text'?item.text:item.label).join('');section.append(reference)
    const visual=(positions:ReturnType<typeof charPositions>):string=>positions.filter(p=>!/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(p.char)).sort((a,b)=>a.x-b.x).map(p=>p.char).join('')
    result.bidiVisualOrder=visual(positions)
    result.nativeVisualOrder=visual(charPositions(reference))
  }
  return result
}

async function main():Promise<void> {
  const plan=await (await fetch('/api/plan')).json() as Plan
  const rows:Row[]=[],validation:Validation[]=[],measurementDiagnostics:unknown[]=[],boundaries:unknown[]=[],environmentViolations:string[]=[]
  const check=(id:string,s:Snapshot):void=>{if(s.visibility!=='visible'||!s.focused)environmentViolations.push(`${id}: ${s.visibility}, focused=${s.focused}`);if(plan.forcedDpr!==null&&s.dpr!==plan.forcedDpr)environmentViolations.push(`${id}: DPR ${s.dpr}, expected ${plan.forcedDpr}`)}
  await document.fonts.ready
  for(let n=0;n<120&&(!document.hasFocus()||document.visibilityState!=='visible');n++){await frame()}
  const cohorts=Array.from(new Set(plan.inputs.map(input=>input.cohort)))
  if(!plan.validateOnly) for(let ci=0;ci<cohorts.length;ci++) {
    const cohort=cohorts[ci]!
    const inputs=plan.inputs.filter(input=>input.cohort===cohort)
    // Each cohort uses one document language so main and Canvas see the same environment.
    const language=cohort==='arabic'?'ar':cohort==='cjk'?'zh-Hant':'en'
    document.documentElement.lang=language
    for(const input of inputs)input.lang=language
    const plain=cohort==='arabic'||cohort==='cjk'||cohort==='mixed'||cohort==='difficult'
    const api=plain?'plain':'rich'
    const measure=makeMeasure(language)
    const ownRetained=inputs.map(input=>ownPrepare(input,measure))
    clearCache()
    const mainRetained=plain?inputs.map(input=>prepareWithSegments((input.items[0] as Extract<OwnedItem,{kind:'text'}>).text,(input.items[0] as Extract<OwnedItem,{kind:'text'}>).font)):inputs.map(input=>prepareRichInline(richItems(input)))
    const mainRich=mainRetained as ReturnType<typeof prepareRichInline>[]
    const mainPlain=mainRetained as ReturnType<typeof prepareWithSegments>[]
    for(const mode of ['fresh-each-text','batch'] as const) for(const phase of ['prepare','first-count']) {
      const a=():number=>{let total=0;for(const input of inputs){const p=ownPrepare(input,measure);total+=phase==='prepare'?1:count(p,plan.widths[0]!)}return total}
      const b=():number=>{let total=0;clearCache();for(const input of inputs){if(mode==='fresh-each-text')clearCache();if(plain){const item=input.items[0] as Extract<OwnedItem,{kind:'text'}>;const p=mainPrepare(item.text,item.font);total+=phase==='prepare'?1:mainCount(p,plan.widths[0]!,28).lineCount}else{const p=prepareRichInline(richItems(input));total+=phase==='prepare'?1:measureRichInlineStats(p,plan.widths[0]!).lineCount}}return total}
      const start=snap();check(`${cohort}/${phase}/start`,start)
      const [prototype,main]=await timedPair(a,b,plan.samples,ci%2===0)
      const end=snap();check(`${cohort}/${phase}/end`,end)
      const row:Row={cohort,api,phase,mode,messages:inputs.length,units:inputs.reduce((n,i)=>n+i.items.reduce((sum,item)=>sum+(item.kind==='text'?item.text.length:item.label.length),0),0),widths:[plan.widths[0]!],prototype,main,start,end}
      rows.push(row);await fetch('/api/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cohort,phase,mode,ratio:prototype.medianMs/main.medianMs})})
    }
    for(const phase of ['new-width-count','same-width-count','new-width-layout','same-width-layout']) {
      const widths=phase.startsWith('new')?plan.widths.slice(1):[plan.widths[0]!,plan.widths[0]!,plan.widths[0]!]
      const full=phase.endsWith('layout')
      const a=():number=>{let total=0;for(let i=0;i<inputs.length;i++)for(const width of widths){if(full)total+=layout(ownRetained[i]!,width).length;else total+=count(ownRetained[i]!,width)}return total}
      const b=():number=>{let total=0;for(let i=0;i<inputs.length;i++)for(const width of widths){if(plain)total+=full?layoutWithLines(mainPlain[i]!,width,28).lineCount:mainCount(mainPlain[i]!,width,28).lineCount;else if(full)total+=walkRichInlineLineRanges(mainRich[i]!,width,line=>{consumed+=materializeRichInlineLineRange(mainRich[i]!,line).fragments.length});else total+=measureRichInlineStats(mainRich[i]!,width).lineCount}return total}
      const start=snap();check(`${cohort}/${phase}/start`,start)
      const [prototype,main]=await timedPair(a,b,plan.samples,ci%2===0)
      const end=snap();check(`${cohort}/${phase}/end`,end)
      const row:Row={cohort,api,phase,mode:'retained',messages:inputs.length,units:inputs.reduce((n,i)=>n+i.items.reduce((sum,item)=>sum+(item.kind==='text'?item.text.length:item.label.length),0),0),widths,prototype,main,start,end}
      rows.push(row);await fetch('/api/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cohort,phase,mode:'retained',ratio:prototype.medianMs/main.medianMs})})
    }
  }
  status.textContent='Checking actual DOM painting…'
  const font='24px "Helvetica Neue", "Geeza Pro", "Kohinoor Devanagari", "PingFang TC", sans-serif'
  const cases:Input[]=[
    {id:'AV-separate-items',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'A',font},{kind:'text',text:'V office affinity',font}]},
    {id:'mixed-bidi',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'a (אבג) 123 [مرحبا] b ٤٥٦ + c',font}]},
    {id:'rtl-bidi',cohort:'validation',lang:'ar',direction:'rtl',items:[{kind:'text',text:'مرحبا (123) ABC עברית [٤٥٦] نهاية',font}]},
    {id:'bidi-controls',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'a \u2067אבג (123) العربية\u2069 b \u202eXYZ\u202c c',font}]},
    {id:'arabic-joining',cohort:'validation',lang:'ar',direction:'rtl',items:[{kind:'text',text:'السَّلام عليكم العربية لا تتوقف مرحبا بالعالم',font:'26px "Geeza Pro"'}]},
    {id:'indic-clusters',cohort:'validation',lang:'hi',direction:'ltr',items:[{kind:'text',text:'कर्म क्षत्रिय स्त्री हिन्दी अक्षर देवनागरी',font:'26px "Kohinoor Devanagari"'}]},
    {id:'emoji-and-overhang',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'é 👩🏽‍💻 👨‍👩‍👧‍👦 ffi italic ',font:'italic 24px "Times New Roman"'}]},
    {id:'font-size-12-17-28',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'AV ffi ',font:'12px \"Helvetica Neue\"'},{kind:'text',text:'AV ffi ',font:'17px \"Helvetica Neue\"'},{kind:'text',text:'AV ffi',font:'28px \"Helvetica Neue\"'}]},
    {id:'mixed-font-baselines',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'small ',font:'14px "Helvetica Neue"'},{kind:'text',text:'large ',font:'28px "Times New Roman"'},{kind:'text',text:'code',font:'18px Menlo',extraWidth:12,atomic:true}]},
    {id:'whitespace',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'  A \t B\n C\u00a0D\u200bE  ',font}]},
    {id:'spacing',cohort:'validation',lang:'en',direction:'ltr',items:[{kind:'text',text:'AV office אבג 漢字',font,letterSpacing:1.25}]},
  ]
  for(const input of cases) for(const width of [173.375,320,10000]) for(const placement of ['transform','left'] as const) for(const zoom of [1,0.8,1.25]) {
    try {validation.push(await validate(input,width,placement,zoom))}
    catch(error){validation.push({id:input.id,width,placement,zoom,dpr:devicePixelRatio,lines:0,fragments:0,canvasCalls:0,maxAdvanceDifference:0,maxXDifference:0,maxBaselineDifference:0,maxTextBaselineDifference:0,baselinePositions:[],advanceDifferences:[],positionDifferences:[],logicalDomText:'',expectedLogicalText:'',sourceLogicalText:'',sourceCopyMatches:false,normalizedSourceCopyMatches:false,strippedSourceCopyMatches:false,rangeCopyText:'',logicalOrderMatches:false,rangeCopyMatches:false,overflowGroups:[],characterPositions:[],error:error instanceof Error?error.message:String(error)})}
  }
  for(const [id,items,policy] of [
    ['split-combining',[{kind:'text',text:'e',font},{kind:'text',text:'\u0301',font}],'strict'],
    ['split-emoji',[{kind:'text',text:'👩',font},{kind:'text',text:'\u200d💻',font}],'strict'],
    ['split-arabic',[{kind:'text',text:'مر',font},{kind:'text',text:'حبا',font}],'strict'],
    ['split-arabic-explicit',[{kind:'text',text:'مر',font},{kind:'text',text:'حبا',font}],'independent'],
    ['split-indic',[{kind:'text',text:'कर',font},{kind:'text',text:'्म',font}],'strict'],
  ] as const) {
    try {prepare(items as unknown as OwnedItem[],{direction:'ltr',lang:'en',boundaryPolicy:policy},makeMeasure('en'));boundaries.push({id,policy,accepted:true})}
    catch(error){boundaries.push({id,policy,accepted:false,error:error instanceof Error?error.message:String(error)})}
  }

  function merged(caseSpec:ShapingCase):OwnedItem[]|null {
    const items:OwnedItem[]=caseSpec.items.map(item=>({...item}))
    const groups=caseSpec.groups??[]
    for(let g=groups.length-1;g>=0;g--) {
      const indices=groups[g]!,first=items[indices[0]!]!
      if(first.kind!=='text')return null
      let text=''
      for(let i=0;i<indices.length;i++) {
        const item=items[indices[i]!]!
        if(indices[i]!==indices[0]!+i||item.kind!=='text'||item.font!==first.font||(item.letterSpacing??0)!==(first.letterSpacing??0))return null
        text+=item.text
      }
      items.splice(indices[0]!,indices.length,{...first,text})
    }
    return items
  }
  for(const caseSpec of shapingCases) {
    const input:Input={id:`shaping-${caseSpec.id}`,cohort:'shaping',direction:caseSpec.direction,lang:caseSpec.lang,items:caseSpec.items}
    let accepted=false,error=''
    try{prepare(input.items,{direction:input.direction,lang:input.lang,boundaryPolicy:'strict'},makeMeasure(input.lang));accepted=true}
    catch(problem){error=problem instanceof Error?problem.message:String(problem)}
    const outcome=caseSpec.expectation==='reject-grapheme'?!accepted&&error.includes('grapheme'):caseSpec.expectation==='group'?!accepted:accepted
    boundaries.push({id:caseSpec.id,expectation:caseSpec.expectation,note:caseSpec.note,policy:'strict',accepted,error,expectedOutcome:outcome})
    if(caseSpec.expectation==='reject-grapheme')continue
    const variants:Array<{input:Input;policy:'strict'|'independent';variant:string}>=[]
    if(accepted)variants.push({input,policy:'strict',variant:'strict'})
    else if(caseSpec.expectation==='independent') variants.push({input,policy:'independent',variant:'unexpected-strict-rejection-explicit-independent'})
    if(caseSpec.expectation==='group') {
      variants.push({input:{...input,id:input.id+'-independent'},policy:'independent',variant:'explicit-independent-may-break-required-shaping'})
      const grouped=merged(caseSpec)
      if(grouped!==null)variants.push({input:{...input,id:input.id+'-merged',items:grouped},policy:'strict',variant:'merged-compatible-font-group'})
      else boundaries.push({id:caseSpec.id,variant:'merged-compatible-font-group',available:false,reason:'The supplied group changes font or letter spacing'})
    }
    for(const variant of variants) {
      const matrices=caseSpec.widths.flatMap(width=>[{width,placement:'transform' as const,zoom:1},{width,placement:'left' as const,zoom:1}])
      if(/fractional|myanmar-syllable|arabic-marks|bidi-controls|baseline/.test(caseSpec.id)) matrices.push({width:caseSpec.widths[1]!,placement:'transform',zoom:0.8},{width:caseSpec.widths[1]!,placement:'transform',zoom:1.25})
      for(const matrix of matrices) {
        try {const result=await validate(variant.input,matrix.width,matrix.placement,matrix.zoom,variant.policy);validation.push({...result,expectation:caseSpec.expectation,variant:variant.variant,note:caseSpec.note})}
        catch(problem){boundaries.push({id:caseSpec.id,variant:variant.variant,...matrix,error:problem instanceof Error?problem.message:String(problem),unexpected:true})}
      }
    }
    await fetch('/api/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shaping:caseSpec.id,accepted,expectedOutcome:outcome,observations:validation.length})})
  }

  const diagnosticCases=[
    {id:'myanmar-kinzi',text:'င်္က',font:'24px "Myanmar MN"',direction:'ltr' as const,lang:'my',spacing:0},
    {id:'myanmar-orphan',text:'ာ်',font:'24px "Myanmar MN"',direction:'ltr' as const,lang:'my',spacing:0},
    {id:'arabic-tracking',text:'السلام',font:'24px "Geeza Pro"',direction:'rtl' as const,lang:'ar',spacing:-1.25},
    {id:'latin-ligature-tracking',text:'office ffi',font:'20px "Times New Roman"',direction:'ltr' as const,lang:'en',spacing:1.25},
    {id:'emoji-22',text:'👩🏽‍💻',font:'22px "Times New Roman"',direction:'ltr' as const,lang:'en',spacing:0},
    {id:'emoji-24',text:'👩🏽‍💻',font:'24px "Apple Color Emoji"',direction:'ltr' as const,lang:'en',spacing:0},
    {id:'fractional-font',text:'A V fi',font:'17.3px "Arial"',direction:'ltr' as const,lang:'en',spacing:0.15},
    {id:'forced-rtl-latin',text:'ABC (123)',font:'24px "Times New Roman"',direction:'rtl' as const,lang:'en',spacing:1.25},
    {id:'forced-ltr-arabic',text:'مرحبا (123)',font:'24px "Geeza Pro"',direction:'ltr' as const,lang:'ar',spacing:0},
    {id:'rtl-lone-bracket',text:'(',font:'24px "Times New Roman"',direction:'rtl' as const,lang:'en',spacing:1.25},
  ]
  async function diagnostics():Promise<void> {
    for(const item of diagnosticCases)for(const spacing of Array.from(new Set([0,item.spacing]))) {
      const section=document.createElement('section');section.lang=item.lang;section.id=`diagnostic-${item.id}-${spacing}-${devicePixelRatio}`
      const title=document.createElement('h2');title.textContent=`Diagnostic ${item.id}, tracking ${spacing}px, DPR ${devicePixelRatio}`;section.append(title)
      const canvas=document.createElement('canvas'),offscreen=new OffscreenCanvas(1,1)
      section.append(canvas);scope.append(section)
      const ctx=offscreen.getContext('2d')!
      if('lang' in ctx)ctx.lang=item.lang
      ctx.font=item.font;ctx.direction=item.direction;ctx.letterSpacing=`${spacing}px`;ctx.wordSpacing='0px';ctx.fontKerning='auto'
      const wrapped=(item.direction==='rtl'?'\u202e':'\u202d')+item.text+'\u202c'
      const raw=ctx.measureText(item.text).width,override=ctx.measureText(wrapped).width
      const controls=ctx.measureText((item.direction==='rtl'?'\u202e':'\u202d')+'\u202c').width
      const connected=canvas.getContext('2d')!;if('lang' in connected)connected.lang=item.lang
      connected.font=item.font;connected.direction=item.direction;connected.letterSpacing=`${spacing}px`;connected.wordSpacing='0px';connected.fontKerning='auto'
      const connectedRaw=connected.measureText(item.text).width,connectedOverride=connected.measureText(wrapped).width
      const htmlMeasurements:Record<string,number>={}
      for(const bidi of ['isolate','isolate-override']) {
        const span=document.createElement('span');span.dir=item.direction;span.style.cssText='display:inline-block;white-space:pre;word-spacing:0px;font-kerning:auto;text-rendering:auto;'
        span.style.font=item.font;span.style.letterSpacing=`${spacing}px`;span.style.unicodeBidi=bidi;span.textContent=item.text
        const label=document.createElement('div');label.textContent=`HTML ${bidi}: `;label.append(span);section.append(label)
        htmlMeasurements[bidi]=span.getBoundingClientRect().width
      }
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','600');svg.setAttribute('height','60')
      const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('x',item.direction==='rtl'?'550':'0');text.setAttribute('y','35');text.setAttribute('direction',item.direction)
      text.style.font=item.font;text.style.letterSpacing=`${spacing}px`;text.style.unicodeBidi='isolate-override';text.style.whiteSpace='pre';text.textContent=item.text;svg.append(text);section.append(svg)
      const svgLength=text.getComputedTextLength()
      const fixed=createMeasure(item.lang,devicePixelRatio),uncorrected=createMeasure(item.lang,devicePixelRatio,{corrections:false})
      const correctedRaw=fixed(item.text,item.font,item.direction,spacing),correctedOverride=fixed(wrapped,item.font,item.direction,spacing)
      const match=/(\d+(?:\.\d+)?)px/u.exec(item.font)!
      ctx.font=item.font.replace(match[0],`${Number(match[1])*devicePixelRatio}px`)
      const deviceRaw=ctx.measureText(item.text).width/devicePixelRatio,deviceOverride=ctx.measureText(wrapped).width/devicePixelRatio
      measurementDiagnostics.push({id:item.id,text:item.text,font:item.font,lang:item.lang,direction:item.direction,spacing,dpr:devicePixelRatio,canvas:{raw,override,controls,connectedRaw,connectedOverride,deviceRaw,deviceOverride,fontReadback:connected.font},html:htmlMeasurements,svgLength,corrected:{raw:correctedRaw,override:correctedOverride,info:fixed.info},ablation:{raw:uncorrected(item.text,item.font,item.direction,spacing),override:uncorrected(wrapped,item.font,item.direction,spacing)}})
      canvas.remove()
      await frame()
    }
  }
  await diagnostics()
  check('final',snap())
  const report:PostedResult={runId:plan.runId,environment:{userAgent:navigator.userAgent,dpr:devicePixelRatio},environmentViolations,rows,validation,boundaries,galleryHtml:scope.innerHTML,measurementDiagnostics,limitations:[
    'Independent fixed shaping groups intentionally lose kerning and ligatures across groups. Oversized unbreakable groups overflow; this prototype does not split them at emergency grapheme boundaries.',
    'Native-paragraph wrapping equality is not required. Main rich uses different painting semantics, so timing ratios compare costs rather than equivalent native appearance.',
    'CSS zoom 0.8/1.25 tests transformed DOM geometry; it is not browser zoom. Device scale is recorded separately.',
    'Range positions and measured advance do not prove glyph mirroring, script readability, accessibility behavior, or clipboard behavior of a real user copy command.',
    'DOM logical text and Range.toString are checked against both materialized fragments and author text. Source-copy differences expose stripped bidi controls, normalized whitespace, and discarded line-edge spaces; these are unresolved behavior, not accepted correctness.',
    'Font facts and DOM measurements are never fed back into core layout. Geometry discrepancies are observations, not fitted correction constants.',
    `Timing checksum ${consumed}. No diagnostic Canvas wrapper is active during timing.`,
  ]}
  status.textContent=`Done: ${rows.length} timing rows, ${validation.length} painting observations.`
  document.title='owned experiment done'
  const post=async():Promise<void>=>{report.galleryHtml=scope.innerHTML;await fetch('/api/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)})}
  await post()
  if(plan.validationHoldMs>0) {
    const button=document.createElement('button');button.textContent='Recheck painting at current browser zoom';status.append(' ',button)
    button.addEventListener('click',()=>{void(async()=>{button.disabled=true;try{await diagnostics();for(const input of cases.filter(input=>/bidi|arabic|emoji|baseline/.test(input.id))){const observation=await validate({...input,id:`${input.id}-native-zoom-${devicePixelRatio}`},320,'transform',1);validation.push({...observation,variant:'native-browser-zoom-manual-recheck'})}await post()}finally{button.disabled=false}})().catch(error=>{status.append(` Recheck failed: ${String(error)}`)})})
    await fetch('/api/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase:'validation-hold-ready',holdMs:plan.validationHoldMs,dpr:devicePixelRatio})})
  }
}
void main().catch(async error=>{status.textContent=`Failed: ${error instanceof Error?error.message:String(error)}`;await fetch('/api/fatal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:error instanceof Error?error.stack??error.message:String(error)})})})
