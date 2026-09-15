import { layout, prepare } from '../../src/layout.ts'

type AccordionItem = {
  id: string
  title: string
  text: string
}

type AccordionItemDom = {
  root: HTMLElement
  toggle: HTMLButtonElement
  title: HTMLSpanElement
  meta: HTMLSpanElement
  glyph: HTMLSpanElement
  body: HTMLDivElement
  inner: HTMLDivElement
  copy: HTMLParagraphElement
}

type State = {
  openItemId: string | null
  events: {
    clickedItemId: string | null
  }
}

type DomCache = {
  page: HTMLElement
  list: HTMLElement
  items: AccordionItemDom[]
}

// Every value a panel's height depends on. The painter writes them inline, and CSS doesn't restate them.
const COPY_FONT = '16px "Helvetica Neue", Helvetica, Arial, sans-serif'
const COPY_LINE_HEIGHT = 26
const COPY_PADDING_X = 20
const COPY_PADDING_BOTTOM = 18
const PAGE_MAX_WIDTH = 780
const PAGE_MARGIN_X = 16
const NARROW_PAGE_MARGIN_X = 10
// At this width and below, the page takes the narrow margins and sets data-narrow for its other narrow styles.
const NARROW_MAX_VIEWPORT_WIDTH = 640

const items: AccordionItem[] = [
  {
    id: 'shipping',
    title: 'Section 1',
    text:
      'Mina cut the release note to three crisp lines, then realized the support caveat still needed one more sentence before it could ship without surprises.',
  },
  {
    id: 'ops',
    title: 'Section 2',
    text:
      'The handoff doc now reads like a proper morning checklist instead of a diary entry. Restart the worker, verify the queue drains, and only then mark the incident quiet. If the backlog grows again, page the same owner instead of opening a new thread.',
  },
  {
    id: 'research',
    title: 'Section 3',
    text:
      'We learned the hard way that a giant native scroll range can dominate everything else. The bug looked like DOM churn, then like pooling, then like rendering pressure, until the repros were stripped down enough to show the real limit. That changed the fix completely: simplify the DOM, keep virtualization honest, and stop hiding the worst-case path behind caches that only make the common frame look cheaper.',
  },
  {
    id: 'mixed',
    title: 'Section 4',
    text:
      'AGI 春天到了. بدأت الرحلة 🚀 and the long URL is https://example.com/reports/q3?lang=ar&mode=full. Nora wrote “please keep 10\u202F000 rows visible,” Mina replied “trans\u00ADatlantic labels are still weird.”',
  },
]

const preparedItems = items.map(item => prepare(item.text, COPY_FONT))

const st: State = {
  openItemId: 'shipping',
  events: {
    clickedItemId: null,
  },
}

let domCache: DomCache | null = null

let scheduledRaf: number | null = null

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}

function getRequiredElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredChild<T extends Element>(
  parent: Element,
  selector: string,
  ctor: { new (): T },
): T {
  const element = parent.querySelector(selector)
  if (!(element instanceof ctor)) throw new Error(`${selector} not found`)
  return element
}

function getAccordionItemNodes(list: HTMLElement): AccordionItemDom[] {
  const roots = Array.from(list.querySelectorAll<HTMLElement>('.accordion-item'))
  if (roots.length !== items.length) throw new Error('accordion item count mismatch')

  return roots.map(root => ({
    root,
    toggle: getRequiredChild(root, '.accordion-toggle', HTMLButtonElement),
    title: getRequiredChild(root, '.accordion-title', HTMLSpanElement),
    meta: getRequiredChild(root, '.accordion-meta', HTMLSpanElement),
    glyph: getRequiredChild(root, '.accordion-glyph', HTMLSpanElement),
    body: getRequiredChild(root, '.accordion-body', HTMLDivElement),
    inner: getRequiredChild(root, '.accordion-inner', HTMLDivElement),
    copy: getRequiredChild(root, '.accordion-copy', HTMLParagraphElement),
  }))
}

function initializeStaticContent(): void {
  if (domCache === null) return
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const itemDom = domCache.items[index]!
    itemDom.root.dataset['id'] = item.id
    itemDom.toggle.dataset['id'] = item.id
    itemDom.title.textContent = item.title
    itemDom.inner.style.padding = `0 ${COPY_PADDING_X}px ${COPY_PADDING_BOTTOM}px`
    itemDom.copy.style.font = COPY_FONT
    itemDom.copy.style.lineHeight = `${COPY_LINE_HEIGHT}px`
    itemDom.copy.textContent = item.text
  }
}

function scheduleRender(): void {
  if (domCache === null) return
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderAccordionFrame(now) {
    scheduledRaf = null
    if (render(now)) scheduleRender()
  })
}

function boot(): void {
  const list = getRequiredElement('list')
  domCache = {
    page: getRequiredChild(document.body, '.page', HTMLElement),
    list,
    items: getAccordionItemNodes(list),
  }

  initializeStaticContent()

  domCache.list.addEventListener('click', event => {
    const target = event.target
    if (!(target instanceof Element)) return
    const toggle = target.closest<HTMLButtonElement>('.accordion-toggle')
    if (toggle === null) return

    const id = toggle.dataset['id']
    if (id === undefined) return

    st.events.clickedItemId = id
    scheduleRender()
  })

  document.fonts.ready.then(() => {
    scheduleRender()
  })

  window.addEventListener('resize', () => {
    scheduleRender()
  })

  scheduleRender()
}

function render(_now: number): boolean {
  if (domCache === null) return false

  // DOM reads
  // body.clientWidth leaves out the scrollbar gutter. Chrome's documentElement.clientWidth includes
  // the gutter while the page doesn't overflow.
  const viewportWidth = document.body.clientWidth

  let openItemId = st.openItemId
  if (st.events.clickedItemId !== null) {
    openItemId = openItemId === st.events.clickedItemId ? null : st.events.clickedItemId
  }

  // Layout
  const narrow = viewportWidth <= NARROW_MAX_VIEWPORT_WIDTH
  const pageWidth = Math.min(PAGE_MAX_WIDTH, viewportWidth - (narrow ? NARROW_PAGE_MARGIN_X : PAGE_MARGIN_X) * 2)
  const copyWidth = pageWidth - COPY_PADDING_X * 2

  const panelHeights: number[] = []
  const panelMeta: string[] = []
  for (let index = 0; index < items.length; index++) {
    const metrics = layout(preparedItems[index]!, copyWidth, COPY_LINE_HEIGHT)
    panelHeights.push(metrics.height + COPY_PADDING_BOTTOM)
    panelMeta.push(`Measurement: ${metrics.lineCount} lines · ${Math.round(metrics.height)}px`)
  }

  st.openItemId = openItemId
  st.events.clickedItemId = null

  // DOM writes
  domCache.page.style.width = `${pageWidth}px`
  domCache.page.toggleAttribute('data-narrow', narrow)
  domCache.page.toggleAttribute('data-ready', true)
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const itemDom = domCache.items[index]!
    const expanded = openItemId === item.id

    itemDom.meta.textContent = panelMeta[index]!
    itemDom.body.style.height = expanded ? `${panelHeights[index]}px` : '0px'
    itemDom.glyph.style.transform = expanded ? 'rotate(90deg)' : 'rotate(0deg)'
    itemDom.toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  }

  return false
}
