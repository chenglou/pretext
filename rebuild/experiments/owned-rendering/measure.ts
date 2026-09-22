// Measurement rules for independent DOM fragments. This is outside the shared
// numeric layout core. Browser/font assumptions are exposed for the experiment.
import type {Measure} from './core.ts'
import {graphemeBoundaries} from '../../src/unicode/grapheme.js'
import {webkitGraphemeRules} from '../../src/engines/webkit/data.js'
import {isCursiveScript} from '../../src/engines/gecko/props.js'

export type MeasurementInfo = {geckoRounding:boolean;emojiMatches:number;cursiveAdjustments:number;wrapperAdjustments:number;assumptions:string[]}
export type NativeMeasure = Measure & {info:MeasurementInfo}
export function createMeasure(lang:string,scale:number=window.devicePixelRatio,options:{corrections?:boolean}={}):NativeMeasure {
  const corrections=options.corrections!==false
  const canvas=typeof OffscreenCanvas==='undefined'?document.createElement('canvas'):new OffscreenCanvas(1,1)
  const context=canvas.getContext('2d') as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D
  if(context===null)throw new Error('Canvas 2D unavailable')
  if('lang' in context)context.lang=lang
  if('fontKerning' in context)context.fontKerning='auto'
  if('textRendering' in context)context.textRendering='auto'
  if('wordSpacing' in context)context.wordSpacing='0px'
  context.font='16px serif'
  context.letterSpacing='0px'
  const unspaced=context.measureText('MMMMMMMMMMMMMMMM').width
  context.letterSpacing='0.001px'
  const geckoRounding='lang' in context&&context.measureText('MMMMMMMMMMMMMMMM').width===unspaced
  const info:MeasurementInfo={geckoRounding,emojiMatches:0,cursiveAdjustments:0,wrapperAdjustments:0,assumptions:[
    'Gecko is identified by existing Canvas feature checks: lang plus 0.001px tracking rounded to zero. The full production check remains separate.',
    'Emoji font identity is inferred from equal advance and ink bounds against Apple Color Emoji. Equal metrics are evidence, not proof of font identity.',
    'The device-size emoji recipe is restricted to one Unicode grapheme, no tracking, and equal emoji-reference metrics. CSS zoom scale remains a measured hypothesis.',
    'Whole-cursive tracking correction requires every Unicode grapheme base to have a source-defined cursive script. Mixed cursive/noncursive groups are not corrected by this helper.',
    'Fractional font-size quantization, optical-size axes and Safari optional-ligature differences remain documented gaps.',
  ]}
  let previousFont='',previousDirection='',previousSpacing=NaN
  const settings=(font:string,direction:'ltr'|'rtl',spacing:number):void=>{
    if(font!==previousFont){context.font=font;previousFont=font}
    if(direction!==previousDirection){context.direction=direction;previousDirection=direction}
    if(spacing!==previousSpacing){context.letterSpacing=`${spacing}px`;previousSpacing=spacing}
  }
  const widths=(text:string,font:string,direction:'ltr'|'rtl',spacing:number):TextMetrics=>{settings(font,direction,spacing);return context.measureText(text)}
  const sameMetrics=(a:TextMetrics,b:TextMetrics):boolean=>a.width===b.width&&a.actualBoundingBoxLeft===b.actualBoundingBoxLeft&&a.actualBoundingBoxRight===b.actualBoundingBoxRight&&a.actualBoundingBoxAscent===b.actualBoundingBoxAscent&&a.actualBoundingBoxDescent===b.actualBoundingBoxDescent
  const emojiPattern=/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u
  const fn:Measure=(text,font,direction,spacing)=>{
    const wrapped=(text.startsWith('\u202d')||text.startsWith('\u202e'))&&text.endsWith('\u202c')
    const clean=wrapped?text.slice(1,-1):text
    let effectiveSpacing=spacing
    if(corrections&&geckoRounding) {
      // nsTextFrame resolves CSS spacing with NS_lroundf, unlike Canvas floor+.5.
      const au=Math.fround(Math.fround(spacing)*60)
      effectiveSpacing=(au<0?-Math.floor(-au+0.5):Math.floor(au+0.5))/60
      if(effectiveSpacing!==0&&clean.length!==0) {
        const boundaries=graphemeBoundaries(clean,webkitGraphemeRules)
        let whollyCursive=true
        for(let i=0;i+1<boundaries.length;i++)if(!isCursiveScript(clean.codePointAt(boundaries[i]!)!)){whollyCursive=false;break}
        if(whollyCursive){effectiveSpacing=0.001;info.cursiveAdjustments++}
      }
    }
    const metrics=widths(text,font,direction,effectiveSpacing)
    let result=metrics.width
    if(corrections&&geckoRounding&&wrapped&&effectiveSpacing!==0) {
      // Offscreen keeps LRO/RLO and PDF as zero-glyph clusters. The Canvas
      // PropertyProvider adds the rounded tracking to both (§1.7).
      const contribution=Math.floor(Math.fround(effectiveSpacing*60)+0.5)/60
      result-=2*contribution;info.wrapperAdjustments++
    }
    if(corrections&&spacing===0&&scale!==1&&emojiPattern.test(clean)) {
      const boundaries=graphemeBoundaries(clean,webkitGraphemeRules)
      const sizeMatch=/(\d+(?:\.\d+)?)px/u.exec(font)
      if(boundaries.length===2&&sizeMatch!==null) {
        const size=Number(sizeMatch[1])
        const reference=widths(text,`${size}px "Apple Color Emoji"`,direction,0)
        if(sameMetrics(metrics,reference)) {
          const scaledFont=font.replace(sizeMatch[0],`${size*scale}px`)
          result=widths(text,scaledFont,direction,0).width/scale;info.emojiMatches++
        }
      }
    }
    return result
  }
  return Object.assign(fn,{info})
}
