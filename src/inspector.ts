import type { DockClientScriptContext } from '@vitejs/devtools-kit/client'
import type { ComponentSource } from './protocol.js'
import { compareTrees, inferNodes, type InferenceReport } from './infer.js'
import type { ResolvedSection } from './sections.js'

export interface ComponentNode extends ComponentSource {
  start: Comment | null
  end: Comment | null
  roots: Element[]
  parent: ComponentNode | null
  children: ComponentNode[]
  occurrence: number
  shopifyId?: string
  /** Guessed from the theme source instead of read from markers. */
  inferred?: boolean
  label?: string
  instanceKey?: string
  instanceName?: string
  owner?: string
  ownerFilename?: string
  origin?: 'template' | 'section-group' | 'static'
}

export interface RpcCaller {
  call(name: string, input: unknown): Promise<unknown>
}

const decode = (value: string): ComponentSource => JSON.parse(atob(value))

function elementsInBoundary(start: Comment, end: Comment): Element[] {
  const range = document.createRange()
  try { range.setStartAfter(start); range.setEndBefore(end) } catch { return [] }
  const common = range.commonAncestorContainer
  const scope = common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement
  if (!scope) return []
  const candidates = [...scope.querySelectorAll('*')].filter((element) => {
    try { return range.intersectsNode(element) } catch { return false }
  })
  return candidates.filter((element) => !candidates.some((parent) => parent !== element && parent.contains(element)))
}

function nextElement(comment: Comment): Element | null {
  let node: Node | null = comment.nextSibling
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.nextSibling
  return node as Element | null
}

function fallbackRoot(node: ComponentNode, start: Comment): Element[] {
  const first = nextElement(start)
  if (!first) return node.parent?.roots ?? []
  if (node.kind === 'section') {
    const wrapper = first.closest('[id^="shopify-section-"]')
    if (wrapper) return [wrapper]
  }
  if (node.kind === 'block') {
    const wrapper = first.closest('[data-shopify-editor-block]')
    if (wrapper) return [wrapper]
  }
  return node.parent?.roots ?? [first]
}

export function componentTree(root: ParentNode = document): ComponentNode[] {
  const iterator = document.createNodeIterator(root, NodeFilter.SHOW_COMMENT)
  const roots: ComponentNode[] = []
  const stack: ComponentNode[] = []
  const occurrences = new Map<string, number>()
  let comment: Comment | null
  while ((comment = iterator.nextNode() as Comment | null)) {
    const value = comment.data.trim()
    const start = value.match(/^shopify-devtools:start:(.+)$/)
    if (start) {
      try {
        const source = decode(start[1])
        const occurrence = occurrences.get(source.id) ?? 0
        occurrences.set(source.id, occurrence + 1)
        const node: ComponentNode = { ...source, start: comment, end: null, roots: [], parent: stack.at(-1) ?? null, children: [], occurrence }
        if (node.parent) node.parent.children.push(node); else roots.push(node)
        stack.push(node)
      } catch { /* Ignore malformed comments from unrelated sources. */ }
    } else if (/^shopify-devtools:end:/.test(value)) {
      const node = stack.pop()
      const start = node?.start
      if (!node || !start) continue
      node.end = comment
      node.roots = elementsInBoundary(start, comment)
      if (!node.roots.length) node.roots = fallbackRoot(node, start)
      const identityRoot = node.kind === 'section'
        ? node.roots[0]?.closest('[id^="shopify-section-"]')
        : node.kind === 'block' ? node.roots[0]?.closest('[data-shopify-editor-block]') : node.roots[0]
      node.shopifyId = identityRoot?.id || identityRoot?.getAttribute('data-shopify-editor-block') || undefined
    }
  }
  for (const { node } of flatten(roots)) if (!node.roots.length && node.parent) node.roots = node.parent.roots
  return roots
}

type SectionLookup = Record<string, ResolvedSection>

/** Shopify wraps every section in `#shopify-section-*`; this is all a page without markers exposes. */
export function sectionWrappers(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[id^="shopify-section-"]')]
}

export function sectionTree(wrappers: HTMLElement[], resolved: SectionLookup): ComponentNode[] {
  const occurrences = new Map<string, number>()
  const occurrence = (id: string): number => {
    const next = occurrences.get(id) ?? 0
    occurrences.set(id, next + 1)
    return next
  }
  return wrappers.flatMap((wrapper): ComponentNode[] => {
    const source = resolved[wrapper.id]
    if (!source) return []
    const id = `section:${source.file}`
    const node: ComponentNode = { ...source, id, start: null, end: null, roots: [wrapper], parent: null, children: [], occurrence: occurrence(id), shopifyId: wrapper.id }
    node.children = inferNodes(wrapper, source.tree ?? [], { occurrence }, node)
    return [node]
  })
}

export function flatten(nodes: ComponentNode[], depth = 0): Array<{ node: ComponentNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])
}

export function deepestForTarget(nodes: ComponentNode[], target: Element): ComponentNode | undefined {
  return flatten(nodes).filter(({ node }) => node.roots.some((root) => root === target || root.contains(target))).sort((a, b) => b.depth - a.depth)[0]?.node
}

export function deepestAtPoint(nodes: ComponentNode[], x: number, y: number): ComponentNode | undefined {
  const target = document.elementFromPoint(x, y)
  if (target) return deepestForTarget(nodes, target)
  return flatten(nodes).reverse().find(({ node }) => node.roots.some((root) => {
    const rect = root.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }))?.node
}

type Listener = (state: InspectorController) => void
const watchedDocks = new WeakSet<object>()
export const INSPECT_ENTRY_ID = 'shopify-liquid:inspect'
const PANEL_ENTRY_ID = 'shopify-liquid'

function isDevtoolsEvent(event: Event): boolean {
  return event.composedPath().some((target) => {
    if (!(target instanceof Element)) return false
    const name = target.localName
    return name === 'devframes-dock-embedded'
      || name === 'shopify-liquid-devtools'
      || name.startsWith('devframes-')
      || name.startsWith('shopify-devtools-')
      || target.hasAttribute('data-vite-devtools-panel')
      || [...target.attributes].some(({ name: attribute }) => attribute.startsWith('data-shopify-devtools'))
  })
}

function isInspectorControlEvent(event: Event): boolean {
  return event.composedPath().some((target) => target instanceof Element
    && (target.id === 'inspect' || target.id === 'panel-inspect'))
}

export class InspectorController {
  active = false
  tree: ComponentNode[] = []
  selected?: ComponentNode
  error?: Error
  rpc?: RpcCaller
  mode: 'markers' | 'inferred' | 'none' = 'none'
  #sectionRun = 0
  #sectionCache = new Map<string, ResolvedSection | undefined>()
  #overlay = document.createElement('div')
  #listeners = new Set<Listener>()
  #highlighted?: ComponentNode
  #picking = false
  #pointerPicked = false
  #isBlocked: () => boolean = () => false

  constructor() {
    this.#overlay.dataset.shopifyDevtoolsHighlights = ''
    this.#overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646'
  }

  setRpc(rpc: unknown): void { this.rpc = rpc as RpcCaller }
  setNavigationGuard(isBlocked: () => boolean): void { this.#isBlocked = isBlocked }
  subscribe(listener: Listener): () => void { this.#listeners.add(listener); listener(this); return () => this.#listeners.delete(listener) }
  refresh(): void {
    const tree = componentTree()
    if (tree.length) { this.#show(tree, 'markers'); void this.#enrichMarkedSections(tree); return }
    void this.#refreshSections()
  }

  async #enrichMarkedSections(tree: ComponentNode[]): Promise<void> {
    const sections = flatten(tree).map(({ node }) => node).filter((node) => node.kind === 'section')
    const wrappers = sections.flatMap((node) => {
      const wrapper = node.roots[0]?.closest<HTMLElement>('[id^="shopify-section-"]')
      return wrapper ? [wrapper] : []
    })
    if (!wrappers.length || !this.rpc) return
    try {
      const resolved = await this.#resolveSections(wrappers)
      if (this.tree !== tree) return
      for (const node of sections) {
        const id = node.roots[0]?.closest<HTMLElement>('[id^="shopify-section-"]')?.id
        const source = id && resolved[id]
        if (source) Object.assign(node, {
          instanceKey: source.instanceKey, instanceName: source.instanceName, owner: source.owner,
          ownerFilename: source.ownerFilename, origin: source.origin,
        })
      }
      this.#emit()
    } catch { /* Exact marker data remains usable if optional metadata lookup fails. */ }
  }

  #show(tree: ComponentNode[], mode: InspectorController['mode']): void {
    this.tree = tree
    this.mode = mode
    this.#emit()
  }

  /** Asks the server for the files behind the sections on the page, remembering what it already told us. */
  async #resolveSections(wrappers: HTMLElement[]): Promise<SectionLookup> {
    const missing = wrappers.map((wrapper) => wrapper.id).filter((id) => !this.#sectionCache.has(id))
    if (missing.length && this.rpc) {
      const page = (globalThis as { ShopifyAnalytics?: { meta?: { page?: { pageType?: unknown } } } }).ShopifyAnalytics?.meta?.page
      const found = await this.rpc.call('shopify-devtools:resolve-sections', { ids: [...new Set(missing)], pageType: page?.pageType }) as SectionLookup
      for (const id of missing) this.#sectionCache.set(id, found?.[id])
    }
    return Object.fromEntries(wrappers.flatMap((wrapper) => { const source = this.#sectionCache.get(wrapper.id); return source ? [[wrapper.id, source]] : [] }))
  }

  // Without markers (a plain `shopify theme dev`), fall back to the sections Shopify wraps in the page
  // and guess the blocks and snippets inside them from the theme source.
  async #refreshSections(): Promise<void> {
    const wrappers = sectionWrappers()
    const run = ++this.#sectionRun
    if (!this.rpc || !wrappers.length) { this.#show([], 'none'); return }
    let resolved: SectionLookup
    try {
      resolved = await this.#resolveSections(wrappers)
    } catch (error) {
      this.error = error instanceof Error ? error : new Error('Could not resolve sections')
      this.#emit()
      return
    }
    if (run !== this.#sectionRun) return
    const tree = sectionTree(wrappers, resolved)
    this.#show(tree, tree.length ? 'inferred' : 'none')
  }

  /**
   * On a page with markers (full mode), scores what the inference would have shown against the exact tree.
   * Call it from the console: `shopifyDevtools.compareInference()`.
   */
  async compareInference(): Promise<InferenceReport | undefined> {
    const truth = componentTree()
    if (!truth.length) return
    const wrappers = sectionWrappers()
    return compareTrees(truth, sectionTree(wrappers, await this.#resolveSections(wrappers)))
  }

  activate(): void {
    if (this.active) return
    this.active = true
    if (!this.#overlay.isConnected) document.documentElement.append(this.#overlay)
    document.documentElement.style.cursor = 'crosshair'
    addEventListener('pointermove', this.#move, true)
    addEventListener('pointerdown', this.#pointerDown, true)
    addEventListener('focusin', this.#focusIn, true)
    addEventListener('click', this.#click, true)
    addEventListener('keydown', this.#key)
    addEventListener('scroll', this.#refreshHighlight, true)
    addEventListener('resize', this.#refreshHighlight)
    this.refresh()
  }

  deactivate(): void {
    this.active = false
    removeEventListener('pointermove', this.#move, true)
    removeEventListener('pointerdown', this.#pointerDown, true)
    removeEventListener('focusin', this.#focusIn, true)
    removeEventListener('click', this.#click, true)
    removeEventListener('keydown', this.#key)
    removeEventListener('scroll', this.#refreshHighlight, true)
    removeEventListener('resize', this.#refreshHighlight)
    document.documentElement.style.cursor = ''
    this.clearHighlight()
    this.#overlay.remove()
    this.#emit()
  }

  toggle(): void { if (this.active) this.deactivate(); else this.activate() }
  select(node: ComponentNode): void { this.selected = node; this.#emit() }
  clearHighlight(): void { this.#highlighted = undefined; this.#overlay.replaceChildren() }

  highlight(node: ComponentNode): void {
    if (!this.#overlay.isConnected) document.documentElement.append(this.#overlay)
    this.#highlighted = node
    this.#overlay.replaceChildren()
    for (const root of node.roots) {
      const rect = root.getBoundingClientRect()
      if ((!rect.width && !rect.height) || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue
      const box = document.createElement('div')
      box.dataset.shopifyDevtoolsHighlight = ''
      Object.assign(box.style, { position: 'fixed', boxSizing: 'border-box', pointerEvents: 'none', border: '2px solid #4ac93e', background: 'rgba(74,201,62,.16)', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
      const badge = document.createElement('div')
      badge.dataset.shopifyDevtoolsSource = ''
      badge.textContent = `<${root.localName}> ${node.file}:${node.line}`
      Object.assign(badge.style, { position: 'fixed', boxSizing: 'border-box', pointerEvents: 'none', zIndex: '1', maxWidth: 'calc(100vw - 8px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: '4px', background: '#303030', color: '#fff', font: '550 11px/16px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', left: `${Math.max(4, rect.left)}px`, top: `${rect.bottom}px` })
      this.#overlay.append(box, badge)
      const badgeWidth = badge.getBoundingClientRect().width || badge.offsetWidth
      const badgeHeight = badge.getBoundingClientRect().height || badge.offsetHeight || 22
      badge.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - badgeWidth - 4))}px`
      badge.style.top = `${rect.bottom + badgeHeight <= innerHeight ? rect.bottom : Math.max(0, rect.top - badgeHeight)}px`
    }
  }

  async openEditor(node: ComponentNode): Promise<void> {
    if (!this.rpc) throw new Error('DevTools RPC is unavailable. Restart the Vite development server.')
    this.error = undefined
    try {
      await this.rpc.call('shopify-devtools:open-in-editor', { file: node.file, line: node.line })
    } catch (error) {
      this.error = error instanceof Error ? error : new Error('Could not open the editor')
      this.#emit()
      throw this.error
    }
  }

  #emit(): void { for (const listener of this.#listeners) listener(this) }
  #node(event: MouseEvent | PointerEvent): ComponentNode | undefined {
    const target = event.target instanceof Element ? event.target : null
    return target ? deepestForTarget(this.tree, target) : deepestAtPoint(this.tree, event.clientX, event.clientY)
  }
  #blocked(): boolean {
    if (!this.#isBlocked()) return false
    this.deactivate()
    return true
  }
  #move = (event: PointerEvent): void => {
    if (this.#blocked()) return
    if (isDevtoolsEvent(event)) {
      this.clearHighlight()
      return
    }
    const node = this.#node(event)
    if (node) this.highlight(node); else this.clearHighlight()
  }
  #refreshHighlight = (): void => { if (this.#highlighted) this.highlight(this.#highlighted) }
  #pick(event: MouseEvent | PointerEvent, node: ComponentNode): void {
    event.preventDefault(); event.stopPropagation()
    if (this.#picking) return
    this.#picking = true
    this.select(node)
    this.clearHighlight()
    void this.openEditor(node)
      .then(() => this.deactivate())
      .catch((error) => console.error('[shopify-devtools] Could not open the editor:', error))
      .finally(() => { this.#picking = false })
  }
  #pointerDown = (event: PointerEvent): void => {
    if (this.#blocked()) return
    if (isDevtoolsEvent(event)) {
      if (!isInspectorControlEvent(event)) this.deactivate()
      return
    }
    const node = this.#node(event)
    if (!node) return
    this.#pointerPicked = true
    addEventListener('click', this.#swallowPickedClick, { capture: true, once: true })
    setTimeout(() => this.#releasePickedClick(), 1_000)
    this.#pick(event, node)
  }
  #focusIn = (event: FocusEvent): void => {
    if (this.#blocked()) return
    if (isDevtoolsEvent(event) && !isInspectorControlEvent(event)) this.deactivate()
  }
  // The pick happens on pointerdown, so its trailing click must not reach the page or pick again (even after deactivate).
  #swallowPickedClick = (event: MouseEvent): void => {
    this.#pointerPicked = false
    event.preventDefault(); event.stopPropagation()
  }
  #releasePickedClick(): void {
    this.#pointerPicked = false
    removeEventListener('click', this.#swallowPickedClick, true)
  }
  #click = (event: MouseEvent): void => {
    if (this.#blocked()) return
    if (isDevtoolsEvent(event)) return
    if (this.#pointerPicked) return this.#swallowPickedClick(event)
    const node = this.#node(event)
    if (!node) return
    this.#pick(event, node)
  }
  #key = (event: KeyboardEvent): void => { if (event.key === 'Escape') this.deactivate() }
}

const controllerKey = Symbol.for('shopify-devtools:inspector-controller')
type ControllerGlobal = typeof globalThis & { [controllerKey]?: InspectorController }

export function getInspectorController(): InspectorController {
  const scope = globalThis as ControllerGlobal
  return scope[controllerKey] ??= new InspectorController()
}

export function deactivateInspectorOnDevtoolsNavigation(context: DockClientScriptContext): void {
  if (!context.docks || !context.panel) return
  const controller = getInspectorController()
  const isForeignDock = (id: string | null | undefined): boolean => id != null && id !== INSPECT_ENTRY_ID && id !== PANEL_ENTRY_ID
  controller.setNavigationGuard(() => isForeignDock(context.docks.selectedId))
  if (watchedDocks.has(context.docks)) return
  watchedDocks.add(context.docks)

  for (const entry of context.docks.entries) {
    if (entry.id === INSPECT_ENTRY_ID) continue
    context.docks.getStateById(entry.id)?.events.on('entry:activated', () => controller.deactivate())
  }

  context.panel.events.on('panel:state:changed', (state) => {
    if (state.state !== 'open' || isForeignDock(state.selectedDockId)) controller.deactivate()
  })
}
