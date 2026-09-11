// Historical policy matrices, retained as candidate-independent width recipes.
// See INVENTORY.md for origins and the distinction between old splits and unseen tests.
export type Case = {
  id: string
  split: 'control' | 'discovery' | 'heldout'
  family: string
  context: string
  marker: string
  parts: string[]
  width: number
  widthRule: string
  font: string
  lineHeight: number
  whiteSpace: 'normal' | 'pre-wrap'
  wordBreak: 'normal' | 'keep-all'
  letterSpacing: number
  direction: 'ltr' | 'rtl'
  lang?: string
}
type Measure = (text: string, font: string) => number
export function generateCases(measure: Measure): Case[] {
  const cases: Case[] = []
  const add = (input: Omit<Case, 'id'>): void => { cases.push({ id: `case-${String(cases.length).padStart(5, '0')}`, ...input }) }
  const font = '16px Arial'
  const control = (family: string, parts: string[], width: number, spacing = 0, context = '', marker = '', widthRule = 'fixed'): void => {
    add({ split: 'control', family, context, marker, parts, width, widthRule, font, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', letterSpacing: spacing, direction: 'ltr' })
  }
  // Exact 700-case predecessor inputs/width recipes. Kept as controls, not promoted to expected results.
  const symbolText = ('{'.repeat(13) + ']'.repeat(13) + '\\'.repeat(13) + '|'.repeat(20) + '\\').repeat(5)
  for (const width of [50, 160, 320]) for (const spacing of [0, 1]) control('exact', [symbolText], width, spacing)
  for (const left of ['a','1','|','\\','$','+','%','.',']','}',':','!','/','(',"'",'"','😀']) for (const right of ['{','[','(','"','“']) {
    control('pair', [left.repeat(4) + right.repeat(3) + 'bbb'], measure(left.repeat(4) + right, font) + .1, 0, left, right, 'head + marker + .1')
  }
  for (const parts of [['\u200B','hello'],['\u200B',' hello'],['a\u200B','hello'],['a','\u200B','hello'],['\u200B','\u200B','hello'],['\u200B','abc def'],['a','hello'],['a ','hello'],['','\u200B','hello']]) for (const width of [1,30,60]) for (const spacing of [0,1,-1]) control('rich',parts,width,spacing)
  for (const left of Array.from({length:94},(_,i)=>String.fromCharCode(i+33)).filter(ch=>!/[A-Za-z0-9]/.test(ch))) for (const right of ['{','[','(','<','“','‘']) {
    const head=left.repeat(4), tail=right.repeat(2)+'aabb'
    for (const [width,widthRule] of [[measure(head+right,font)+.1,'head + marker + .1'],[measure(tail,font)+.1,'tail + .1']] as const) control('ascii-matrix',[head+tail],width,0,left,right,widthRule)
  }
  for (const left of ['é','中','あ','한','£','€','¥','😀','א','ا','“','’','−','℅']) for (const right of ['{','[','(']) {
    const head=left.repeat(4), tail=right.repeat(2)+'aabb'
    for (const [width,widthRule] of [[measure(head+right,font)+.1,'head + marker + .1'],[measure(tail,font)+.1,'tail + .1']] as const) control('non-ascii-control',[head+tail],width,0,left,right,widthRule)
  }
  for (const parts of [['\u200B','', 'hello'],['\u200B',' ', 'hello'],['\u200B','\u00AD', 'hello'],['a ','hello'],['a',' ', 'hello']]) for (const spacing of [-4,0,1]) for (const width of [1,12,30,100]) control('rich-more',parts,width,spacing)
  if (cases.length !== 700) throw new Error(`Inherited controls: expected 700, got ${cases.length}`)

  const contexts = [
    ['latin','ab','xyz'], ['numeric','12','739'], ['accented','é','ñø'], ['combining','e\u0301','a\u0308'],
    ['cjk','中文','漢字'], ['kana','あい','カナ'], ['hangul','가나','한글'], ['hebrew','אב','גד'],
    ['arabic','اب','تم'], ['arabic-mark','بِ','تُ'], ['pipe','||','|¦'], ['backslash','\\\\','\\/'],
    ['currency-dollar','$$','$$$'], ['currency-unicode','£€','¥₩'], ['minus','−−','−+'],
    ['closer',']]','})'], ['dot','..','.:'], ['emoji','😀','🙂'],
  ] as const
  const markers = [
    ['paren','(',')'], ['bracket','[',']'], ['brace','{','}'], ['angle','<','>'],
    ['straight-double','"','"'], ['straight-single',"'","'"], ['curly-double-open','“','”'],
    ['curly-double-close','”','“'], ['curly-single-open','‘','’'], ['curly-single-close','’','‘'],
    ['guillemet','«','»'], ['cjk-bracket','「','」'], ['fullwidth-paren','（','）'],
  ] as const
  const matrix = (split: Case['split'], family: string, context: string, marker: string, text: string, head: string, tail: string, whiteSpace: Case['whiteSpace'], wordBreak: Case['wordBreak'] = 'normal', letterSpacing = 0, direction: Case['direction'] = 'ltr'): void => {
    const widths = [
      [measure(head+marker,font)+.1,'head + marker + .1'],
      [measure(tail,font)+.1,'tail + .1'],
      [Math.max(1,measure(text,font)*.58),'58% natural width'],
    ] as const
    for (const [width,widthRule] of widths) add({ split, family, context, marker, parts: [text], width, widthRule, font, lineHeight: 20, whiteSpace, wordBreak, letterSpacing, direction })
  }
  // Discovery spans every representative marker x context, with both whitespace modes.
  for (const [family,marker] of markers) for (const [context,unit] of contexts) for (const whiteSpace of ['normal','pre-wrap'] as const) {
    const head=unit.repeat(2), tail=marker.repeat(2)+'tail'
    matrix('discovery',family,context,marker,head+tail,head,tail,whiteSpace)
  }
  // Held-out cases change lexical instances and mixed punctuation structure. Widths remain candidate-independent.
  // Balanced deterministic pair schedule: each marker sees six contexts, cycling by a coprime stride.
  for (let markerIndex=0; markerIndex<markers.length; markerIndex++) for (let slot=0; slot<6; slot++) {
    const [family,marker,closer]=markers[markerIndex]!, [context,,unit]=contexts[(markerIndex*5+slot*7)%contexts.length]!
    for (const whiteSpace of ['normal','pre-wrap'] as const) {
      const head=unit+'x', tail=marker+'value'+closer+'!'
      const text=slot%2===0 ? head+tail+' end' : 'go '+head+tail
      matrix('heldout',family,context,marker,text,head,tail,whiteSpace)
    }
  }
  // Orthogonal modes are sampled rather than multiplied across the entire matrix.
  for (const [family,marker] of markers) for (const [context,unit] of contexts.slice(4,7)) for (const whiteSpace of ['normal','pre-wrap'] as const) {
    const head=unit.repeat(2),tail=marker+'漢字kana'
    matrix('discovery','keep-all/'+family,context,marker,head+tail,head,tail,whiteSpace,'keep-all')
  }
  for (const [family,marker] of markers.slice(0,10)) for (const [context,unit] of [contexts[0]!,contexts[7]!,contexts[13]!]) for (const spacing of [-1,1.5]) {
    const head=unit.repeat(2),tail=marker+'item'
    matrix('heldout','spacing/'+family,context,marker,head+tail,head,tail,'normal','normal',spacing,context==='hebrew'?'rtl':'ltr')
  }
  for (const [context,unit] of [contexts[0]!,contexts[4]!,contexts[7]!,contexts[8]!]) for (const whiteSpace of ['normal','pre-wrap'] as const) {
    for (const separator of [' ','  ','\t','\n','\u00A0','\u200B','\u00AD']) {
      const head=unit+separator,tail='“'+unit+'”'
      matrix('heldout','whitespace',context,'“',head+tail,head,tail,whiteSpace,'normal',0,context==='hebrew'||context==='arabic'?'rtl':'ltr')
    }
  }
  return cases
}

export function generateLanguageCases(measure: Measure): Case[] {
  const rows: Case[] = [], font = '16px Arial'
  for (const [context,head] of [['latin','aaaa'],['numeric','1111'],['symbol','||||'],['cjk','中文中文']] as const) for (const marker of ['“','”','‘','’']) for (const lang of ['', 'en', 'zh-Hans', 'ja']) {
    const tail=marker.repeat(2)+'tail'
    for (const [width,widthRule] of [[measure(head+marker,font)+.1,'head + marker + .1'],[measure(tail,font)+.1,'tail + .1']] as const) {
      rows.push({id:`language-${String(rows.length).padStart(4,'0')}`,split:'discovery',family:'explicit-language',context,marker,parts:[head+tail],width,widthRule,font,lineHeight:20,whiteSpace:'normal',wordBreak:'normal',letterSpacing:0,direction:'ltr',lang})
    }
  }
  return rows
}

export function generateSeamCases(measure: Measure): Case[] {
  const rows: Case[] = [], font='16px Arial'
  const groups = [
    ['numeric', ['£-100','£(100)','£[100]','£.100','£😀','😀%','$-73','$−73','€(12)','¥[42]','€12.5%','12,345.67€','(12.5)%','[123]‰','££100','100%%','$$100%','€-١٢٣','١٢٣٪','−12%','12−34','£e\u0301','e\u0301%','£.','£(','£)','%.100','100)%','Ⅷ%','£١٢٣','🇺🇸%','€\u0301100','100\u0301%']],
    ['url', ['https://ex.com\tfoo','https://ex.com\u00ADfoo','www.ex.com?\tfoo','https://ex.com\u00A0foo','https://ex.com\u200Bfoo','https://ex.com\nfoo','www.ex.com?\u00ADfoo','https://ex.com?x=1\tfoo','https://ex.com?x=1\u00ADfoo']],
    ['context-width', ['بِبِ「「tail','بِبِ（（tail','「「t','（（t','««t','((t','““t','אב““tail']],
  ] as const
  for (const [family,texts] of groups) for (const text of texts) for (const whiteSpace of ['normal','pre-wrap'] as const) {
    for (const [width,widthRule] of [[12,'fixed12'],[measure(text,font)*.55,'55% natural width'],[measure(text,font)*.8,'80% natural width'],[measure(text,font)+1,'natural width +1']] as const) {
      rows.push({id:`seam-${String(rows.length).padStart(4,'0')}`,split:'discovery',family:'source-seam/'+family,context:'post-v2 source review',marker:'',parts:[text],width,widthRule,font,lineHeight:20,whiteSpace,wordBreak:'normal',letterSpacing:0,direction:'ltr'})
    }
  }
  return rows
}

export function generateAcceptanceCases(measure: Measure): Case[] {
  const rows: Case[] = [],font='16px Arial'
  for(const text of ['foo‼bar','x foo‼bar z','foo\u00a0世界','x foo\u00a0世界 z','foo-\u00a0bar','foo\u2010\u00a0bar','foo-\u00a0世界']){
    for(const wordBreak of (text.includes('世界')?['normal','keep-all']:['normal']) as Array<'normal'|'keep-all'>){
      for(const [width,widthRule] of [[20,'fixed20'],[38.5,'reported fake-canvas width (real font here)'],[49,'fixed49'],[measure('foo\u00a0',font)+.1,'foo-NBSP native width +.1'],[measure(text,font)*.65,'65% natural width']] as const){
        rows.push({id:`acceptance-${String(rows.length).padStart(3,'0')}`,split:'discovery',family:text.includes('‼')?'acceptance/NS':'acceptance/GL',context:'old test policy acceptance',marker:'',parts:[text],width,widthRule,font,lineHeight:20,whiteSpace:'normal',wordBreak,letterSpacing:0,direction:'ltr'})
      }
    }
  }
  return rows
}
