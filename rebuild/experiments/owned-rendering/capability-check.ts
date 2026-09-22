// Cheap capability comparison, not browser accuracy or performance evidence.
// Run: bun rebuild/experiments/owned-rendering/capability-check.ts --out=/private/tmp/pretext-owned-capability
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {prepare as ownedPrepare,count as ownedCount,layout as ownedLayout,type OwnedItem} from './core.ts'
import {graphemeBoundaries} from '../../src/unicode/grapheme.js'
import {webkitGraphemeRules} from '../../src/engines/webkit/data.js'

const FONT='10px Capability Sans'
const BOLD='700 10px Capability Sans'
const consumedControls=/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const mark=/\p{Mark}/u
const invisible=/\p{Default_Ignorable_Code_Point}/u
function stripConsumed(text:string):string{return text.replace(consumedControls,'')}
function visibleCount(text:string):number {
  let count=0
  for(const char of stripConsumed(text))if(!mark.test(char)&&!invisible.test(char))count++
  return count
}
function widthOf(text:string,spacing=0):number{return visibleCount(text)*(10+spacing)}
let canvasCalls=0
class CapabilityContext {
  font=FONT;direction='ltr';fontKerning='auto';fontStretch='normal';fontVariantCaps='normal';textRendering='auto';wordSpacing='0px';letterSpacing='0px';lang='en'
  measureText(text:string):{width:number;actualBoundingBoxLeft:number;actualBoundingBoxRight:number;actualBoundingBoxAscent:number;actualBoundingBoxDescent:number} {
    canvasCalls++
    const width=widthOf(text,Number.parseFloat(this.letterSpacing)||0)
    return {width,actualBoundingBoxLeft:0,actualBoundingBoxRight:width,actualBoundingBoxAscent:8,actualBoundingBoxDescent:2}
  }
}
class CapabilityCanvas {constructor(_width:number,_height:number){}getContext(_kind:string):CapabilityContext{return new CapabilityContext()}}
const globals=['OffscreenCanvas','navigator','document'] as const
const original=globals.map(key=>Object.getOwnPropertyDescriptor(globalThis,key))
Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,writable:true,value:CapabilityCanvas})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0 Chrome/153.0.0.0',vendor:'Google Inc.'}})
const root={lang:'en'}
Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:root}})

const text=(value:string,font=FONT,extraWidth?:number):OwnedItem=>extraWidth===undefined?{kind:'text',text:value,font}:{kind:'text',text:value,font,extraWidth}
type Case={id:string;lang:string;direction:'ltr'|'rtl';widths:number[];items:OwnedItem[];reason:string;category:string}
const cases:Case[]=[
  {id:'narrow-hello',lang:'en',direction:'ltr',widths:[0,9,10,20,49,50],items:[text('hello')],category:'required work: emergency wrapping',reason:'Ordinary Latin words must remain usable in narrow containers; an overflowing whole word is a meaningful loss of current capability.'},
  {id:'repeated-AV',lang:'en',direction:'ltr',widths:[15,20,25,40,60],items:[text('AVAVAV')],category:'required work: emergency wrapping',reason:'Uniform widths intentionally remove kerning. Differences here come from fitting/breaking, not cross-item shaping.'},
  {id:'AV-between-items',lang:'en',direction:'ltr',widths:[15,20,25,40],items:[text('A'),text('VAV')],category:'required work: emergency wrapping',reason:'The accepted loss of cross-item kerning is irrelevant in this additive backend.'},
  {id:'arabic-complete-word',lang:'ar',direction:'rtl',widths:[10,20,30,40],items:[text('سلام')],category:'boundary choice: preserving complex shaping',reason:'Main can split the word numerically. The owned prototype intentionally overflows it; this backend cannot prove either painting readable.'},
  {id:'arabic-safe-grapheme-weight-change',lang:'ar',direction:'rtl',widths:[20,40,80],items:[text('س'),text('لام',BOLD)],category:'meaningful restriction: valid styled boundary',reason:'The boundary is grapheme-safe. Rejecting it adds a whole-word style requirement absent from main; weight changes need native shaping evidence.'},
  {id:'arabic-explicit-non-joiner',lang:'fa',direction:'rtl',widths:[10,30,60],items:[text('می‌'),text('روم')],category:'meaningful restriction: explicit non-joining boundary',reason:'ZWNJ explicitly ends joining, so a whole-word boundary rule can reject a legitimate independent boundary.'},
  {id:'myanmar-safe-grapheme-edge',lang:'my',direction:'ltr',widths:[5,10,30],items:[text('ကျေ'),text('ာ်')],category:'boundary choice: shaping syllable exceeds grapheme',reason:'This is grapheme-safe but inside one shaping syllable. Rejection is understandable protection; independent painting still needs a documented restriction or grouping.'},
  {id:'thai-safe-grapheme-edge',lang:'th',direction:'ltr',widths:[10,20,30],items:[text('เ'),text('ริ่ม')],category:'boundary choice: word exceeds grapheme',reason:'A separate pre-base vowel is a valid grapheme; isolating and wrapping it independently can damage text. Numeric acceptance does not establish readability.'},
  {id:'sinhala-safe-grapheme-edge',lang:'si',direction:'ltr',widths:[10,20,30],items:[text('ක්‍'),text('ර')],category:'boundary choice: shaping syllable exceeds grapheme',reason:'The existing detector permits this edge; a font can require the two parts to shape together.'},
  {id:'whitespace-only',lang:'en',direction:'ltr',widths:[0,10,30],items:[text(' \t\n ')],category:'required work: whitespace-only materialization',reason:'Collapsed whitespace should not invent visible text or unstable count/materialization behavior.'},
  {id:'bidi-controls-only',lang:'en',direction:'ltr',widths:[0,10,30],items:[text('\u2067\u200f\u2069')],category:'required work: control-only materialization',reason:'The backend gives controls zero width in both implementations; retained controls must not count as painted glyphs.'},
  {id:'empty-item-extraWidth',lang:'en',direction:'ltr',widths:[0,10,30],items:[text('',FONT,12)],category:'shared omitted capability: empty text chrome',reason:'An empty text item is not an expressible fixed-width box in either text helper; use a distinct atomic item.'},
  {id:'ordinary-inline-padding',lang:'en',direction:'ltr',widths:[25,50,80,130],items:[text('hello world',FONT,12)],category:'meaningful regression: ignored inline padding',reason:'Main pays extraWidth on ordinary fragments; the current owned prototype only pays it on atomic text.'},
  {id:'single-padded-text',lang:'en',direction:'ltr',widths:[10,25,40],items:[text('a',FONT,12)],category:'meaningful regression: ignored inline padding',reason:'At ample width the occupied-width difference is unambiguous and unrelated to emergency wrapping.'},
  {id:'atomic-between-parentheses',lang:'en',direction:'ltr',widths:[15,20,30,40,60],items:[text('('),{kind:'atomic',width:20,height:10,label:'X'},text(')')],category:'shared capability: atomic widths',reason:'Main represents this label as a never-break item with extraWidth10, yielding the same explicit occupied width20.'},
  {id:'atomic-before-punctuation',lang:'en',direction:'ltr',widths:[15,20,30,40,60],items:[{kind:'atomic',width:20,height:10,label:'X'},text(',next')],category:'boundary choice: atomic punctuation',reason:'Both APIs permit breaks beside atomic items; remaining differences must be distinguished from the missing word-splitting behavior.'},
  {id:'soft-hyphen',lang:'en',direction:'ltr',widths:[20,30,40,80],items:[text('ab\u00adcd')],category:'required work: discretionary hyphen',reason:'A selected soft-hyphen break must materialize and pay for a visible hyphen; a zero-width invisible character is insufficient.'},
  {id:'zero-width-space',lang:'en',direction:'ltr',widths:[10,20,30,40],items:[text('ab\u200bcd')],category:'required work: zero-width break opportunity',reason:'ZWSP creates an opportunity without width; independent count, fitting and materialization must retain that distinction.'},
  {id:'non-breaking-space',lang:'en',direction:'ltr',widths:[10,20,30,40],items:[text('a\u00a0b')],category:'required work: glue and emergency policy',reason:'NBSP is glue for ordinary breaks; behavior below the whole run width also tests the chosen emergency policy.'},
  {id:'mixed-bidi',lang:'en',direction:'ltr',widths:[20,40,80,200],items:[text('abc אבג (12) مرحبا')],category:'shared capability: paragraph bidi',reason:'Main exposes line text in logical order, not visual x positions. Owned output can be checked for valid ranges/order but this backend cannot establish mirroring.'},
  {id:'grapheme-invalid-accent',lang:'en',direction:'ltr',widths:[10,20],items:[text('e'),text('\u0301')],category:'accepted API exclusion: invalid grapheme split',reason:'The user explicitly excludes boundaries inside a grapheme; rejection is not a regression against that agreed API.'},
]
const out=resolve(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'/private/tmp/pretext-owned-capability')
const sourceFiles=[resolve(import.meta.dir,'core.ts'),resolve(import.meta.dir,'bidi.ts'),'/Users/chenglou/github/pretext/src/layout.ts','/Users/chenglou/github/pretext/src/rich-inline.ts','/Users/chenglou/github/pretext/src/measurement.ts']
const hash=():string=>{const h=new Bun.CryptoHasher('sha256');for(const file of sourceFiles){h.update(file);h.update(readFileSync(file))}return h.digest('hex')}
const before=hash()
const backendChecks=[['hello',50],['\u202dhello\u202c',50],['\u202eAV\u202c',20],['\u2067\u200f\u2069',0],['e\u0301',10],['ab\u00adcd',40],['ab\u200bcd',40],['a\u00a0b',30]] as const
for(const [value,expected]of backendChecks)if(widthOf(value)!==expected)throw new Error(`Incorrect controlled backend for${JSON.stringify(value)}`)
const rows:unknown[]=[]
try {
  const main=await import('../../../../pretext/src/layout.ts')
  const rich=await import('../../../../pretext/src/rich-inline.ts')
  for(const spec of cases) {
    root.lang=spec.lang;main.clearCache();main.setLocale(spec.lang)
    const combined=spec.items.map(item=>item.kind==='text'?item.text:'\ufffc').join('')
    const boundaries=graphemeBoundaries(combined,webkitGraphemeRules)
    let edge=0
    const suppliedEdges=spec.items.map(item=>{edge+=item.kind==='text'?item.text.length:1;return{offset:edge,graphemeSafe:boundaries.includes(edge)}})
    const mainItems=spec.items.map(item=>item.kind==='text'?{text:item.text,font:item.font,extraWidth:item.extraWidth??0,letterSpacing:item.letterSpacing??0,break:item.atomic?'never' as const:'normal' as const}:{text:item.label,font:FONT,break:'never' as const,extraWidth:item.width-widthOf(item.label)})
    const mainRich=rich.prepareRichInline(mainItems)
    const onlyItem=spec.items.length===1?spec.items[0]!:null
    const plainItem=onlyItem?.kind==='text'?onlyItem:null
    const mainPlain=plainItem===null?null:main.prepareWithSegments(plainItem.text,plainItem.font)
    let own:ReturnType<typeof ownedPrepare>|null=null,prepareError:string|null=null
    let ownedBackendCalls=0
    try{own=ownedPrepare(spec.items,{lang:spec.lang,direction:spec.direction,boundaryPolicy:'strict'},(value,_font,_direction,spacing)=>{ownedBackendCalls++;return widthOf(value,spacing)})}catch(error){prepareError=error instanceof Error?error.message:String(error)}
    for(const width of spec.widths) {
      const mainLines:Array<{text:string;width:number;fragments:unknown[]}>=[]
      const mainCount=rich.measureRichInlineStats(mainRich,width)
      rich.walkRichInlineLineRanges(mainRich,width,line=>{const materialized=rich.materializeRichInlineLineRange(mainRich,line);mainLines.push({text:materialized.fragments.map(f=>(f.gapBefore!==0?' ':'')+f.text).join(''),width:materialized.width,fragments:materialized.fragments})})
      const ownLines=own===null?null:ownedLayout(own,width)
      const ownCount=own===null?null:ownedCount(own,width)
      const ownLogical=ownLines?.map(line=>line.fragments.slice().sort((a,b)=>a.start-b.start).map(fragment=>fragment.text).join(''))??null
      const ownVisible=ownLogical?.map(visibleCount)??null
      const mainPlainResult=mainPlain===null?null:main.layoutWithLines(mainPlain,width,10)
      rows.push({id:spec.id,category:spec.category,reason:spec.reason,source:combined,direction:spec.direction,lang:spec.lang,width,suppliedEdges,main:{count:mainCount.lineCount,maxWidth:mainCount.maxLineWidth,lines:mainLines,plain:mainPlainResult},owned:{prepareError,count:ownCount,lines:ownLines,logicalLines:ownLogical,visibleCharactersPerLine:ownVisible,countMatchesMaterializedLines:ownLines===null?null:ownCount===ownLines.length,units:own?.units??null},comparison:{countDifference:ownCount===null?null:ownCount-mainCount.lineCount,ownedOverflow:ownLines?.some(line=>line.width>width)??null,mainOverflow:mainLines.some(line=>line.width>width),maxWidthDifference:ownLines===null?null:Math.max(0,...ownLines.map(line=>line.width))-mainCount.maxLineWidth},backendShared:true,ownedBackendCalls})
    }
  }
}finally {
  for(let i=0;i<globals.length;i++){const descriptor=original[i];if(descriptor===undefined)Reflect.deleteProperty(globalThis,globals[i]!);else Object.defineProperty(globalThis,globals[i]!,descriptor)}
}
const after=hash()
type CapabilityRow={id:string;category:string;reason:string;source:string;width:number;main:{count:number;maxWidth:number};owned:{prepareError:string|null;count:number|null;lines:Array<{width:number;end:number}>|null;logicalLines:string[]|null};comparison:{ownedOverflow:boolean|null;maxWidthDifference:number|null}}
const typedRows=rows as CapabilityRow[]
function anchored(caseId:string,width:number):CapabilityRow {
  const row=typedRows.find(row=>row.id===caseId&&row.width===width)
  if(row===undefined)throw new Error(`Missing declared critical observation: ${caseId} at ${width}px`)
  return row
}
function accepted(row:CapabilityRow):boolean{return row.owned.prepareError===null&&row.owned.count!==null&&row.owned.lines!==null&&row.owned.logicalLines!==null}
function maxGraphemeWidth(source:string):number {
  const boundaries=graphemeBoundaries(source,webkitGraphemeRules)
  let max=0
  for(let i=1;i<boundaries.length;i++)max=Math.max(max,widthOf(source.slice(boundaries[i-1]!,boundaries[i]!)))
  return max
}
type CriticalCheck={id:string;caseId:string;width:number;requirement:string;passed:boolean;observed:unknown}
function fittingCheck(caseId:string):CriticalCheck {
  const row=anchored(caseId,20)
  const limit=Math.max(row.width,maxGraphemeWidth(row.source))
  return {id:`${caseId}-fits`,caseId,width:row.width,requirement:`Retain the source and keep every line within the container or one grapheme's width (${limit}px here). No exact line breaks are required.`,passed:accepted(row)&&(row.owned.lines?.length??0)>0&&row.owned.logicalLines?.join('')===stripConsumed(row.source)&&row.owned.lines!.every(line=>line.width<=limit),observed:{prepareError:row.owned.prepareError,text:row.owned.logicalLines,lineWidths:row.owned.lines?.map(line=>line.width)??null,allowedWidth:limit}}
}
const padded=anchored('single-padded-text',40)
const hyphen=anchored('soft-hyphen',30)
const styledArabic=anchored('arabic-safe-grapheme-weight-change',40)
const criticalChecks:CriticalCheck[]=[
  fittingCheck('narrow-hello'),
  fittingCheck('arabic-complete-word'),
  {id:'ordinary-padding-paid',caseId:padded.id,width:padded.width,requirement:'One nonempty ordinary item with a 10px glyph and extraWidth12 must occupy22px.',passed:accepted(padded)&&padded.owned.lines?.length===1&&padded.owned.lines[0]!.width===22,observed:{prepareError:padded.owned.prepareError,lineWidths:padded.owned.lines?.map(line=>line.width)??null}},
  {id:'selected-soft-hyphen-painted-and-paid',caseId:hyphen.id,width:hyphen.width,requirement:'Retain abcd, fit each line, and draw/pay a visible hyphen whenever a chosen line ends at the soft hyphen. Different chosen cuts are allowed.',passed:accepted(hyphen)&&hyphen.owned.logicalLines!.join('').replaceAll('\u00ad','').replaceAll('-','')===hyphen.source.replaceAll('\u00ad','')&&hyphen.owned.lines!.every((line,index)=>line.width<=hyphen.width&&(hyphen.source.charCodeAt(line.end-1)!==0xad||line.end===hyphen.source.length||(hyphen.owned.logicalLines![index]!.endsWith('-')&&line.width===widthOf(hyphen.owned.logicalLines![index]!)))),observed:{prepareError:hyphen.owned.prepareError,text:hyphen.owned.logicalLines,lineWidths:hyphen.owned.lines?.map(line=>line.width)??null}},
  {id:'valid-arabic-weight-edge-accepted',caseId:styledArabic.id,width:styledArabic.width,requirement:'The grapheme-safe Arabic weight-change boundary must be accepted; this check does not establish native joining correctness.',passed:accepted(styledArabic),observed:{prepareError:styledArabic.owned.prepareError,count:styledArabic.owned.count}}
]
const failures:Array<{id:string;requirement:string;observed:unknown}>=criticalChecks.filter(check=>!check.passed).map(check=>({id:check.id,requirement:check.requirement,observed:check.observed}))
if(before!==after)failures.push({id:'source-stability',requirement:'All measured source files must remain unchanged during the probe.',observed:{before,after}})
const result={outcome:failures.length===0?'critical-checks-passed':'rejected-replacement',criticalChecks,failures}
const report={schema:'owned-capability-check-2',kind:'deterministic algorithm counterexamples',nativeBrowserEvidence:false,performanceEvidence:false,methodologyLimitations:['The existing browser benchmark generator marks every code part atomic. Main Markdown/rich-note code generally breaks normally; only chips/image items use never-break behavior. These atomic-code inputs cannot establish realistic feature parity.','No per-font shaping or Arabic joining behavior is modeled by this additive backend. Accepting numeric layout here is not proof of native painting correctness.','Only the five declared anchored cases are critical checks. Other count differences are observations, not automatic failures. Passing these checks alone would not establish full replacement capability.'],source:{files:sourceFiles,before,after,stable:before===after},backend:{description:'10px per visible base code point (spaces included); combining marks, default ignorables and consumed bidi controls have zero advance. No kerning or font-dependent shaping. Font weight has no effect.',checks:backendChecks.map(([text,expected])=>({text,expected,actual:widthOf(text)})),calls:canvasCalls},result,cases:cases.length,rows}
mkdirSync(out,{recursive:true});writeFileSync(join(out,'capability.json'),JSON.stringify(report,null,2)+'\n')
const lines=['# Owned rendering capability comparison',`Outcome: **${result.outcome}**. ${failures.length} critical failures.`, 'This is a deterministic algorithm probe. It proves neither browser painting nor performance.',`Source stable: ${before===after}. ${cases.length} cases, ${rows.length} width observations.`, 'The backend strips consumed controls consistently for both implementations; each visible base character and space advances10px.', 'Benchmark caveat: the existing browser benchmark marks every code part atomic. Main demo code normally remains breakable; only chips/image items are never-break. Artificial atomic-code inputs cannot establish realistic feature parity.','','## Declared critical checks','Other count differences remain observations. Only these five anchored requirements and source stability determine this result.','']
for(const check of criticalChecks)lines.push(`- ${check.passed?'PASS':'FAIL'} ${check.id} (${check.caseId} at${check.width}px): ${check.requirement} Observed: ${JSON.stringify(check.observed)}`)
lines.push('','## Failures','')
if(failures.length===0)lines.push('None. Passing this small list would not establish full replacement capability.')
else for(const failure of failures)lines.push(`- ${failure.id}: ${failure.requirement} Observed: ${JSON.stringify(failure.observed)}`)
lines.push('','## Width observations','','| case | width | main lines / maxwidth | owned lines | owned text or rejection |','|---|---:|---:|---:|---|')
for(const r of typedRows)lines.push(`| ${r.id} | ${r.width} | ${r.main.count} / ${r.main.maxWidth} | ${r.owned.count??'rejected'} | ${r.owned.prepareError??JSON.stringify(r.owned.logicalLines)} |`)
lines.push('','## Interpretation')
for(const spec of cases)lines.push(`- ${spec.id}: ${spec.category}. ${spec.reason}`)
writeFileSync(join(out,'capability.md'),lines.join('\n')+'\n')
console.log(JSON.stringify({out,cases:cases.length,rows:rows.length,sourceStable:before===after,backendChecks:backendChecks.length,outcome:result.outcome,criticalFailures:failures.length}))
if(failures.length>0)process.exitCode=1
