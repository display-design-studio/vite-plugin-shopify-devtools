import type { DockClientScriptContext } from '@vitejs/devtools-kit/client'
import type { ComponentSource } from './protocol.js'

export interface ComponentNode extends ComponentSource {
  start: Comment
  end: Comment | null
  roots: Element[]
  parent: ComponentNode | null
  children: ComponentNode[]
  occurrence: number
  shopifyId?: string
}

export interface RpcCaller {
  call(name: string, input: { file: string; line: number }): Promise<unknown>
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

function fallbackRoot(node: ComponentNode): Element[] {
  const first = nextElement(node.start)
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
      if (!node) continue
      node.end = comment
      node.roots = elementsInBoundary(node.start, comment)
      if (!node.roots.length) node.roots = fallbackRoot(node)
      const identityRoot = node.kind === 'section'
        ? node.roots[0]?.closest('[id^="shopify-section-"]')
        : node.kind === 'block' ? node.roots[0]?.closest('[data-shopify-editor-block]') : node.roots[0]
      node.shopifyId = identityRoot?.id || identityRoot?.getAttribute('data-shopify-editor-block') || undefined
    }
  }
  for (const { node } of flatten(roots)) if (!node.roots.length && node.parent) node.roots = node.parent.roots
  return roots
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
  #overlay = document.createElement('div')
  #listeners = new Set<Listener>()
  #highlighted?: ComponentNode
  #suppressedClick?: { x: number; y: number; until: number }
  #isBlocked: () => boolean = () => false

  constructor() {
    this.#overlay.dataset.shopifyDevtoolsHighlights = ''
    this.#overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646'
  }

  setRpc(rpc: unknown): void { this.rpc = rpc as RpcCaller }
  setNavigationGuard(isBlocked: () => boolean): void { this.#isBlocked = isBlocked }
  subscribe(listener: Listener): () => void { this.#listeners.add(listener); listener(this); return () => this.#listeners.delete(listener) }
  refresh(): void { this.tree = componentTree(); this.#emit() }

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
      Object.assign(box.style, { position: 'fixed', boxSizing: 'border-box', pointerEvents: 'none', border: '2px solid #95bf47', background: 'rgba(149,191,71,.16)', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
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
    this.select(node)
    this.clearHighlight()
    void this.openEditor(node)
      .then(() => this.deactivate())
      .catch((error) => console.error('[shopify-devtools] Could not open the editor:', error))
  }
  #pointerDown = (event: PointerEvent): void => {
    if (this.#blocked()) return
    if (isDevtoolsEvent(event)) {
      if (!isInspectorControlEvent(event)) this.deactivate()
      return
    }
    const node = this.#node(event)
    if (!node) return
    this.#suppressedClick = { x: event.clientX, y: event.clientY, until: Date.now() + 1_000 }
    addEventListener('click', this.#suppressPickedClick, { capture: true, once: true })
    this.#pick(event, node)
  }
  #focusIn = (event: FocusEvent): void => {
    if (this.#blocked()) return
    if (isDevtoolsEvent(event) && !isInspectorControlEvent(event)) this.deactivate()
  }
  #suppressPickedClick = (event: MouseEvent): void => {
    const suppressed = this.#suppressedClick
    this.#suppressedClick = undefined
    if (suppressed && suppressed.until >= Date.now() && suppressed.x === event.clientX && suppressed.y === event.clientY) {
      event.preventDefault(); event.stopPropagation()
    }
  }
  #click = (event: MouseEvent): void => {
    if (this.#blocked()) return
    if (isDevtoolsEvent(event)) return
    const suppressed = this.#suppressedClick
    this.#suppressedClick = undefined
    if (suppressed && suppressed.until >= Date.now() && suppressed.x === event.clientX && suppressed.y === event.clientY) {
      event.preventDefault(); event.stopPropagation()
      return
    }
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
