// A document that records what a painter builds, for the painter differential (painter-diff.ts): every element with the
// properties and attributes set on it and its style declarations in the order they were set, every text node with the
// string it was made from and the edits made to it, in tree order. Two painters that serialize the same built the same DOM
// the same way; one that sets another property, another value, or the same ones in another order (a shorthand after its
// longhand wins) doesn't. How a text node was made is kept because WebKit's string storage follows it (src/paint.ts
// textNode: a node made with a wide character and cut keeps 16 bits).
//
// It models the DOM a painter writes, not one it reads: reading a property that was never set, or calling a method this
// file doesn't have, throws and names it, so a painter that starts using more of the DOM fails here instead of going
// unrecorded.

export type RecordedNode =
  | { node: 'element'; tag: string; set: Array<[string, string | null]>; style: Array<[string, string | null]>; children: RecordedNode[] }
  | { node: 'text'; made: string; edits: string[]; data: string }

const cssName = (property: string): string => (property === 'cssFloat' ? 'float' : property.startsWith('--') ? property : property.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`))

// A painter that uses more of the DOM than this file models. Never a painter's own error: the differential lets it end
// the run instead of comparing it.
export class UnmodelledDom extends Error {}

// A node's parent, kept beside the nodes: an element is handed out as a proxy that records every property set on it, so
// the document's own bookkeeping doesn't go through properties.
const parents = new WeakMap<RecordingNode, RecordingParent>()

abstract class RecordingNode {
  constructor(readonly ownerDocument: RecordingDocument) {}
  get parentNode(): RecordingParent | null { return parents.get(this) ?? null }
  get parentElement(): RecordingParent | null { return this.parentNode }
  get isConnected(): boolean { return false }
  remove(): void {
    const parent = this.parentNode
    if (parent === null) return
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1)
    parents.delete(this)
  }
  abstract recorded(): RecordedNode[]
}

class RecordingText extends RecordingNode {
  readonly nodeType = 3
  readonly nodeName = '#text'
  readonly edits: string[] = []
  data: string
  constructor(ownerDocument: RecordingDocument, readonly made: string) {
    super(ownerDocument)
    this.data = made
  }
  get length(): number { return this.data.length }
  get textContent(): string { return this.data }
  get nodeValue(): string { return this.data }
  private edit(name: string, args: readonly (number | string)[], data: string): void {
    this.edits.push(`${name}(${args.map(arg => JSON.stringify(arg)).join(',')})`)
    this.data = data
  }
  appendData(text: string): void { this.edit('appendData', [text], this.data + text) }
  deleteData(offset: number, count: number): void { this.edit('deleteData', [offset, count], this.data.slice(0, offset) + this.data.slice(offset + count)) }
  insertData(offset: number, text: string): void { this.edit('insertData', [offset, text], this.data.slice(0, offset) + text + this.data.slice(offset)) }
  replaceData(offset: number, count: number, text: string): void { this.edit('replaceData', [offset, count, text], this.data.slice(0, offset) + text + this.data.slice(offset + count)) }
  recorded(): RecordedNode[] { return [{ node: 'text', made: this.made, edits: this.edits, data: this.data }] }
}

abstract class RecordingParent extends RecordingNode {
  readonly childNodes: RecordingNode[] = []
  get children(): RecordingNode[] { return this.childNodes.filter(child => child instanceof RecordingElement) }
  get firstChild(): RecordingNode | null { return this.childNodes[0] ?? null }
  get lastChild(): RecordingNode | null { return this.childNodes[this.childNodes.length - 1] ?? null }
  // A fragment gives its children; a string becomes a text node, as the DOM does.
  private adopted(values: readonly (RecordingNode | string)[]): RecordingNode[] {
    const out: RecordingNode[] = []
    for (const value of values) {
      if (typeof value === 'string') out.push(new RecordingText(this.ownerDocument, value))
      else if (value instanceof RecordingFragment) out.push(...value.childNodes.splice(0))
      else {
        value.remove()
        out.push(value)
      }
    }
    for (const node of out) parents.set(node, this)
    return out
  }
  append(...values: Array<RecordingNode | string>): void { this.childNodes.push(...this.adopted(values)) }
  prepend(...values: Array<RecordingNode | string>): void { this.childNodes.unshift(...this.adopted(values)) }
  appendChild<T extends RecordingNode>(node: T): T {
    this.append(node)
    return node
  }
  insertBefore<T extends RecordingNode>(node: T, before: RecordingNode | null): T {
    const adopted = this.adopted([node])
    if (before === null) this.childNodes.push(...adopted)
    else {
      const at = this.childNodes.indexOf(before)
      if (at === -1) throw new UnmodelledDom('insertBefore: the reference node is not a child')
      this.childNodes.splice(at, 0, ...adopted)
    }
    return node
  }
  removeChild<T extends RecordingNode>(node: T): T {
    if (node.parentNode !== this) throw new UnmodelledDom('removeChild: not a child')
    node.remove()
    return node
  }
  replaceChildren(...values: Array<RecordingNode | string>): void {
    for (const child of this.childNodes.splice(0)) parents.delete(child)
    this.append(...values)
  }
  recordedChildren(): RecordedNode[] { return this.childNodes.flatMap(child => child.recorded()) }
}

class RecordingFragment extends RecordingParent {
  readonly nodeType = 11
  readonly nodeName = '#document-fragment'
  recorded(): RecordedNode[] { return this.recordedChildren() }
}

// What the element class itself answers; every other property a painter sets is recorded, and one it reads without having
// set it throws.
const OWN = new Set<string | symbol>(['ownerDocument', 'parentNode', 'parentElement', 'isConnected', 'childNodes', 'children', 'firstChild', 'lastChild', 'nodeType', 'nodeName', 'tagName', 'localName', 'style',
  'remove', 'append', 'prepend', 'appendChild', 'insertBefore', 'removeChild', 'replaceChildren', 'setAttribute', 'getAttribute', 'hasAttribute', 'removeAttribute', 'recorded', 'recordedChildren', 'sets', 'declarations', 'adopted', 'constructor'])

class RecordingElement extends RecordingParent {
  readonly nodeType = 1
  readonly sets: Array<[string, string | null]> = []
  readonly declarations: Array<[string, string | null]> = []
  readonly style: unknown
  constructor(ownerDocument: RecordingDocument, readonly localName: string) {
    super(ownerDocument)
    const declarations = this.declarations
    const last = (name: string): string => {
      for (let i = declarations.length - 1; i >= 0; i--) if (declarations[i]![0] === name) return declarations[i]![1] ?? ''
      return ''
    }
    this.style = new Proxy({}, {
      get: (_target, key) => {
        switch (key) {
          case 'setProperty': return (name: string, value: string | null, priority = '') => { declarations.push([name, value === null || value === '' ? null : priority === '' ? String(value) : `${value} !${priority}`]) }
          case 'removeProperty': return (name: string) => { declarations.push([name, null]) }
          case 'getPropertyValue': return last
          default: return last(cssName(String(key)))
        }
      },
      set: (_target, key, value) => {
        declarations.push([cssName(String(key)), value === null || value === '' ? null : String(value)])
        return true
      },
    })
    return new Proxy(this, {
      get: (target, key, receiver) => {
        if (OWN.has(key) || typeof key === 'symbol') return Reflect.get(target, key, receiver) as unknown
        for (let i = target.sets.length - 1; i >= 0; i--) if (target.sets[i]![0] === key) return target.sets[i]![1]
        throw new UnmodelledDom(`the recording document doesn't model reading Element.${key} before it is set (rebuild/tools/recording-document.ts)`)
      },
      set: (target, key, value) => {
        if (typeof key === 'symbol' || OWN.has(key)) throw new UnmodelledDom(`the recording document doesn't model setting Element.${String(key)}`)
        target.sets.push([key, value === null ? null : String(value)])
        return true
      },
    })
  }
  get nodeName(): string { return this.localName.toUpperCase() }
  get tagName(): string { return this.localName.toUpperCase() }
  // An attribute is recorded under `@name`, apart from the property of the same name.
  setAttribute(name: string, value: string): void { this.sets.push([`@${name}`, String(value)]) }
  removeAttribute(name: string): void { this.sets.push([`@${name}`, null]) }
  getAttribute(name: string): string | null {
    for (let i = this.sets.length - 1; i >= 0; i--) if (this.sets[i]![0] === `@${name}`) return this.sets[i]![1]
    return null
  }
  hasAttribute(name: string): boolean { return this.getAttribute(name) !== null }
  recorded(): RecordedNode[] { return [{ node: 'element', tag: this.localName, set: this.sets, style: this.declarations, children: this.recordedChildren() }] }
}

export class RecordingDocument {
  createElement(tag: string): RecordingElement { return new RecordingElement(this, tag.toLowerCase()) }
  createTextNode(data: string): RecordingText { return new RecordingText(this, String(data)) }
  createDocumentFragment(): RecordingFragment { return new RecordingFragment(this) }
}

// What a painter returned, as the differential compares it: the recorded trees of its elements, or null.
export function recordedPainting(elements: readonly unknown[] | null): RecordedNode[][] | null {
  if (elements === null) return null
  return elements.map(element => {
    if (!(element instanceof RecordingNode)) throw new UnmodelledDom('the painter returned a node the recording document didn\'t make')
    return element.recorded()
  })
}
