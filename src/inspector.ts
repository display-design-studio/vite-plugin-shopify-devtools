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

export class InspectorController {
  active = false
  tree: ComponentNode[] = []
  selected?: ComponentNode
  error?: Error
  rpc?: RpcCaller
  #overlay = document.createElement('div')
  #listeners = new Set<Listener>()

  constructor() {
    this.#overlay.dataset.shopifyDevtoolsHighlights = ''
    this.#overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646'
  }

  setRpc(rpc: unknown): void { this.rpc = rpc as RpcCaller }
  subscribe(listener: Listener): () => void { this.#listeners.add(listener); listener(this); return () => this.#listeners.delete(listener) }
  refresh(): void { this.tree = componentTree(); this.#emit() }

  activate(): void {
    if (this.active) return
    this.active = true
    if (!this.#overlay.isConnected) document.documentElement.append(this.#overlay)
    document.documentElement.style.cursor = 'crosshair'
    addEventListener('pointermove', this.#move, true)
    addEventListener('click', this.#click, true)
    addEventListener('keydown', this.#key)
    this.refresh()
  }

  deactivate(): void {
    this.active = false
    removeEventListener('pointermove', this.#move, true)
    removeEventListener('click', this.#click, true)
    removeEventListener('keydown', this.#key)
    document.documentElement.style.cursor = ''
    this.clearHighlight()
    this.#overlay.remove()
    this.#emit()
  }

  toggle(): void { if (this.active) this.deactivate(); else this.activate() }
  select(node: ComponentNode): void { this.selected = node; this.highlight(node); this.#emit() }
  clearHighlight(): void { this.#overlay.replaceChildren() }

  highlight(node: ComponentNode): void {
    if (!this.#overlay.isConnected) document.documentElement.append(this.#overlay)
    this.clearHighlight()
    for (const root of node.roots) {
      const rect = root.getBoundingClientRect()
      if (!rect.width && !rect.height) continue
      const box = document.createElement('div')
      box.dataset.shopifyDevtoolsHighlight = ''
      Object.assign(box.style, { position: 'fixed', boxSizing: 'border-box', pointerEvents: 'none', border: '2px solid #8b5cf6', background: '#8b5cf626', borderRadius: '2px', boxShadow: '0 0 0 1px #fff3 inset', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
      this.#overlay.append(box)
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
  #move = (event: PointerEvent): void => {
    if (isDevtoolsEvent(event)) {
      this.clearHighlight()
      return
    }
    const node = this.#node(event)
    if (node) this.highlight(node)
  }
  #click = (event: MouseEvent): void => {
    if (isDevtoolsEvent(event)) return
    const node = this.#node(event)
    if (!node) return
    event.preventDefault(); event.stopPropagation()
    this.select(node)
    this.clearHighlight()
    void this.openEditor(node).catch((error) => console.error('[shopify-devtools] Could not open the editor:', error))
  }
  #key = (event: KeyboardEvent): void => { if (event.key === 'Escape') this.deactivate() }
}

const controllerKey = Symbol.for('shopify-devtools:inspector-controller')
type ControllerGlobal = typeof globalThis & { [controllerKey]?: InspectorController }

export function getInspectorController(): InspectorController {
  const scope = globalThis as ControllerGlobal
  return scope[controllerKey] ??= new InspectorController()
}
