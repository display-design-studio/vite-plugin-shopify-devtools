import type { ComponentSource } from './protocol.js'

declare global {
  var __SHOPIFY_DEVTOOLS_CONFIG__: { token: string; endpoint: string }
}

const getConfig = (): typeof globalThis.__SHOPIFY_DEVTOOLS_CONFIG__ => globalThis.__SHOPIFY_DEVTOOLS_CONFIG__

interface ComponentNode extends ComponentSource {
  start: Comment
  end: Comment | null
  roots: Element[]
  parent: ComponentNode | null
  children: ComponentNode[]
  occurrence: number
  shopifyId?: string
}

const decode = (value: string): ComponentSource => JSON.parse(atob(value))

function elementsInBoundary(start: Comment, end: Comment): Element[] {
  const range = document.createRange()
  try {
    range.setStartAfter(start)
    range.setEndBefore(end)
  } catch { return [] }
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

function componentTree(root: ParentNode = document): ComponentNode[] {
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

function flatten(nodes: ComponentNode[], depth = 0): Array<{ node: ComponentNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])
}

function deepestForTarget(nodes: ComponentNode[], target: Element): ComponentNode | undefined {
  return flatten(nodes)
    .filter(({ node }) => node.roots.some((root) => root === target || root.contains(target)))
    .sort((a, b) => b.depth - a.depth)[0]?.node
}

function deepestAtPoint(nodes: ComponentNode[], x: number, y: number): ComponentNode | undefined {
  const target = document.elementFromPoint(x, y)
  if (target) return deepestForTarget(nodes, target)
  return flatten(nodes).reverse().find(({ node }) => node.roots.some((root) => {
    const rect = root.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }))?.node
}

const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`
const liquidIcon = icon('<path d="M12 2.5c3.2 4.1 6.2 7.5 6.2 11.2a6.2 6.2 0 1 1-12.4 0C5.8 10 8.8 6.6 12 2.5Z"/><path d="M9 15.2c.5 1.4 1.5 2.1 3 2.1"/>')
const inspectIcon = icon('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.5"/>')
const closeIcon = icon('<path d="m7 7 10 10M17 7 7 17"/>')

class ShopifyDevtools extends HTMLElement {
  #shadow = this.attachShadow({ mode: 'open' })
  #inspecting = false
  #panelOpen = false
  #tree: ComponentNode[] = []
  #selected?: ComponentNode
  #observer = new MutationObserver(() => this.refresh())

  connectedCallback(): void {
    this.#shadow.innerHTML = `<style>${styles}</style>
      <div id="highlights" aria-hidden="true"></div>
      <section id="panel" aria-label="Shopify Liquid DevTools">
        <header><div class="title">${liquidIcon}<strong>Liquid DevTools</strong><span class="badge">DEV</span></div><button id="close" class="icon" aria-label="Close DevTools">${closeIcon}</button></header>
        <div class="workspace"><nav><div class="nav-title">Components</div><ol id="tree"></ol></nav><main id="details"><div class="empty">Select a component from the tree or activate the inspector.</div></main></div>
      </section>
      <div id="toast" role="status" aria-live="polite"></div>
      <div id="toolbar" role="toolbar" aria-label="Shopify Liquid DevTools">
        <button id="toggle" class="brand" aria-label="Toggle Liquid DevTools" aria-pressed="false">${liquidIcon}<span>Liquid</span></button>
        <span class="divider"></span>
        <button id="inspect" class="icon" aria-label="Inspect Liquid component" aria-pressed="false">${inspectIcon}</button>
      </div>`
    this.#shadow.querySelector('#toggle')?.addEventListener('click', () => this.togglePanel())
    this.#shadow.querySelector('#inspect')?.addEventListener('click', () => this.toggleInspector())
    this.#shadow.querySelector('#close')?.addEventListener('click', () => this.togglePanel(false))
    addEventListener('keydown', this.#key)
    addEventListener('pointermove', this.#move, true)
    addEventListener('click', this.#click, true)
    for (const event of shopifyEvents) document.addEventListener(event, this.#refreshEvent)
    this.#observer.observe(document.documentElement, { childList: true, subtree: true })
    this.refresh()
  }

  disconnectedCallback(): void {
    this.#observer.disconnect()
    removeEventListener('keydown', this.#key)
    removeEventListener('pointermove', this.#move, true)
    removeEventListener('click', this.#click, true)
    for (const event of shopifyEvents) document.removeEventListener(event, this.#refreshEvent)
  }

  #key = (event: KeyboardEvent): void => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'd') this.togglePanel()
    if (event.key === 'Escape' && this.#inspecting) this.toggleInspector(false)
  }
  #refreshEvent = (): void => this.refresh()
  #move = (event: PointerEvent): void => {
    if (!this.#inspecting || event.composedPath().includes(this)) return
    const target = event.target instanceof Element ? event.target : null
    const node = target ? deepestForTarget(this.#tree, target) : deepestAtPoint(this.#tree, event.clientX, event.clientY)
    if (node) this.highlight(node)
  }
  #click = (event: MouseEvent): void => {
    if (!this.#inspecting || event.composedPath().includes(this)) return
    const target = event.target instanceof Element ? event.target : null
    const node = target ? deepestForTarget(this.#tree, target) : deepestAtPoint(this.#tree, event.clientX, event.clientY)
    if (!node) return
    event.preventDefault(); event.stopPropagation()
    this.togglePanel(true); this.toggleInspector(false); this.select(node)
  }

  togglePanel(force = !this.#panelOpen): void {
    this.#panelOpen = force
    this.#shadow.querySelector('#panel')?.classList.toggle('open', force)
    this.#shadow.querySelector('#toggle')?.setAttribute('aria-pressed', String(force))
  }

  toggleInspector(force = !this.#inspecting): void {
    this.#inspecting = force
    this.#shadow.querySelector('#inspect')?.classList.toggle('active', force)
    this.#shadow.querySelector('#inspect')?.setAttribute('aria-pressed', String(force))
    document.documentElement.style.cursor = force ? 'crosshair' : ''
    if (!force && !this.#selected) this.clearHighlight()
  }

  refresh(): void {
    this.#tree = componentTree()
    const list = this.#shadow.querySelector('#tree')
    if (list) list.replaceChildren(...this.#tree.map((node) => this.renderNode(node)))
  }

  renderNode(node: ComponentNode): HTMLLIElement {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.className = 'tree-item'
    button.dataset.key = `${node.id}:${node.occurrence}`
    button.innerHTML = `<span class="kind ${node.kind}">${node.kind.slice(0, 1).toUpperCase()}</span><span><b>${node.file.split('/').at(-1)}</b><small>${node.kind}</small></span>`
    button.addEventListener('pointerenter', () => this.highlight(node))
    button.addEventListener('click', () => this.select(node))
    item.append(button)
    if (node.children.length) {
      const nested = document.createElement('ol')
      nested.append(...node.children.map((child) => this.renderNode(child)))
      item.append(nested)
    }
    return item
  }

  clearHighlight(): void { this.#shadow.querySelector('#highlights')?.replaceChildren() }

  highlight(node: ComponentNode): void {
    this.clearHighlight()
    const container = this.#shadow.querySelector('#highlights')
    if (!container) return
    for (const root of node.roots) {
      const rect = root.getBoundingClientRect()
      if (!rect.width && !rect.height) continue
      const box = document.createElement('div')
      box.className = 'highlight'
      Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
      container.append(box)
    }
  }

  select(node: ComponentNode): void {
    this.#selected = node; this.highlight(node)
    this.#shadow.querySelectorAll('.tree-item.selected').forEach((item) => item.classList.remove('selected'))
    const key = `${node.id}:${node.occurrence}`
    ;[...this.#shadow.querySelectorAll<HTMLElement>('.tree-item')].find((item) => item.dataset.key === key)?.classList.add('selected')
    const element = node.roots[0]
    const details = this.#shadow.querySelector('#details')
    if (!details) return
    details.replaceChildren()
    const heading = document.createElement('div'); heading.className = 'detail-heading'
    heading.innerHTML = `<span class="kind ${node.kind}">${node.kind.slice(0, 1).toUpperCase()}</span><div><strong>${node.file.split('/').at(-1)}</strong><small>${node.kind}</small></div>`
    const fields = document.createElement('dl')
    const dom = element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].map((value) => `.${value}`).join('')}` : 'No DOM root'
    for (const [label, value] of [['File', node.file], ['Line', String(node.line)], ['DOM', dom], ['Shopify ID', node.shopifyId ?? '—']]) {
      const dt = document.createElement('dt'); dt.textContent = label
      const dd = document.createElement('dd'); dd.textContent = value
      fields.append(dt, dd)
    }
    const open = document.createElement('button'); open.className = 'open-editor'; open.textContent = 'Open in editor'
    open.addEventListener('click', () => void this.openEditor(node, open))
    details.append(heading, fields, open)
    if (element && 'scrollIntoView' in element) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  async openEditor(node: ComponentNode, button: HTMLButtonElement): Promise<void> {
    button.disabled = true; button.textContent = 'Opening…'
    try {
      const runtimeConfig = getConfig()
      if (!runtimeConfig) throw new Error('DevTools configuration is unavailable. Restart the Vite development server.')
      const response = await fetch(runtimeConfig.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${runtimeConfig.token}` },
        body: JSON.stringify({ file: node.file, line: node.line }),
      })
      const body = await response.text()
      let payload: { ok?: boolean; error?: string } = {}
      if (body) {
        try { payload = JSON.parse(body) as typeof payload } catch { throw new Error(`Editor endpoint returned an invalid response (${response.status}).`) }
      }
      if (!body) throw new Error(`Editor endpoint returned an empty response (${response.status}). Restart the Vite development server.`)
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Request failed (${response.status})`)
      this.toast(`Opened ${node.file}:${node.line}`, 'success')
    } catch (error) {
      this.toast(error instanceof Error ? error.message : 'Could not open the editor', 'error')
    } finally { button.disabled = false; button.textContent = 'Open in editor' }
  }

  toast(message: string, type: 'success' | 'error'): void {
    const toast = this.#shadow.querySelector('#toast') as HTMLElement | null
    if (!toast) return
    toast.textContent = message; toast.dataset.type = type; toast.classList.add('show')
    setTimeout(() => toast.classList.remove('show'), 3_500)
  }
}

const shopifyEvents = ['shopify:section:load', 'shopify:section:unload', 'shopify:section:reorder', 'shopify:block:select', 'shopify:block:deselect']

const styles = `:host{all:initial;--bg:#111113;--panel:#18181b;--raised:#232326;--border:#343438;--muted:#a1a1aa;--text:#fafafa;--accent:#8b5cf6;--accent-soft:#8b5cf626;font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--text);position:fixed;z-index:2147483647;color-scheme:dark}button{font:inherit}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#toolbar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);height:42px;display:flex;align-items:center;gap:3px;padding:4px;background:color-mix(in srgb,var(--bg) 94%,transparent);border:1px solid var(--border);border-radius:13px;box-shadow:0 10px 35px #0008,0 1px 0 #ffffff10 inset;backdrop-filter:blur(14px)}#toolbar button,.icon{height:34px;border:0;border-radius:9px;color:var(--muted);background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,color .15s,transform .15s}#toolbar button:hover,.icon:hover{background:var(--raised);color:var(--text)}#toolbar button:active{transform:scale(.96)}#toolbar button[aria-pressed=true],#inspect.active{background:var(--accent-soft);color:#c4b5fd}.brand{gap:7px;padding:0 10px!important;color:var(--text)!important;font-weight:650}.brand svg{color:#a78bfa}.divider{width:1px;height:20px;background:var(--border);margin:0 2px}#toolbar .icon{width:34px}#panel{position:fixed;left:50%;bottom:70px;transform:translate(-50%,12px) scale(.985);width:min(760px,calc(100vw - 24px));height:min(520px,calc(100vh - 110px));display:flex;flex-direction:column;opacity:0;visibility:hidden;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 80px #000a;overflow:hidden;transition:opacity .16s,transform .16s,visibility .16s;resize:vertical}#panel.open{opacity:1;visibility:visible;transform:translate(-50%,0) scale(1)}header{height:45px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 14px;border-bottom:1px solid var(--border);background:var(--bg)}.title{display:flex;align-items:center;gap:8px}.title svg{color:#a78bfa}.title .badge{font-size:9px;letter-spacing:.08em;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:1px 4px}header .icon{width:30px;height:30px}.workspace{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:0;flex:1}nav{overflow:auto;border-right:1px solid var(--border);padding:10px 8px}.nav-title{padding:2px 8px 8px;color:var(--muted);font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.07em}ol{list-style:none;padding:0;margin:0}ol ol{padding-left:14px}.tree-item{width:100%;display:flex;gap:8px;align-items:center;color:var(--text);background:transparent;border:0;border-radius:7px;padding:6px 7px;text-align:left;cursor:pointer}.tree-item:hover{background:var(--raised)}.tree-item.selected{background:var(--accent-soft);color:#ddd6fe}.tree-item>span:not(.kind){min-width:0;display:flex;flex-direction:column}.tree-item b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-item small,.detail-heading small{font-size:10px;color:var(--muted);text-transform:capitalize}.kind{width:22px;height:22px;flex:none;display:grid;place-items:center;border-radius:6px;font-size:10px;font-weight:750;background:#3f3f46;color:#d4d4d8}.kind.section{background:#7c3aed33;color:#c4b5fd}.kind.block{background:#0ea5e933;color:#7dd3fc}.kind.snippet{background:#10b98133;color:#6ee7b7}main{min-width:0;overflow:auto;padding:20px}.empty{height:100%;display:grid;place-items:center;text-align:center;color:var(--muted)}.detail-heading{display:flex;align-items:center;gap:10px;padding-bottom:16px;border-bottom:1px solid var(--border)}.detail-heading>div{display:flex;flex-direction:column}dl{display:grid;grid-template-columns:90px minmax(0,1fr);gap:10px 14px;margin:18px 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.open-editor{border:1px solid #7c3aed;background:#7c3aed;color:white;border-radius:8px;padding:8px 12px;font-weight:650;cursor:pointer}.open-editor:hover{background:#6d28d9}.open-editor:disabled{opacity:.6;cursor:wait}#highlights{position:fixed;inset:0;pointer-events:none}.highlight{position:fixed;box-sizing:border-box;border:2px solid var(--accent);background:var(--accent-soft);border-radius:2px;box-shadow:0 0 0 1px #fff3 inset}#toast{position:fixed;left:50%;bottom:72px;max-width:min(460px,calc(100vw - 30px));transform:translate(-50%,8px);opacity:0;visibility:hidden;padding:9px 13px;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--text);box-shadow:0 10px 35px #0008;transition:.18s}#toast.show{opacity:1;visibility:visible;transform:translate(-50%,0)}#toast[data-type=success]{border-color:#34d39966}#toast[data-type=error]{border-color:#fb718577;color:#fecdd3}@media(max-width:640px){#toolbar{bottom:10px}#panel{bottom:60px;width:calc(100vw - 12px);height:calc(100vh - 75px)}.workspace{grid-template-columns:1fr;grid-template-rows:minmax(120px,40%) 1fr}nav{border-right:0;border-bottom:1px solid var(--border)}main{padding:14px}}@media(prefers-color-scheme:light){:host{--bg:#fff;--panel:#fafafa;--raised:#f0f0f2;--border:#dedee3;--muted:#71717a;--text:#18181b;--accent-soft:#8b5cf61c;color-scheme:light}#toolbar,#panel,#toast{box-shadow:0 14px 45px #18181b25}.open-editor{color:#fff}}`

if (!customElements.get('shopify-liquid-devtools')) customElements.define('shopify-liquid-devtools', ShopifyDevtools)
if (!document.querySelector('shopify-liquid-devtools')) document.documentElement.append(document.createElement('shopify-liquid-devtools'))

export { componentTree, deepestAtPoint, deepestForTarget }
