import type { DockClientScriptContext } from '@vitejs/devtools-kit/client'
import { INSPECT_ENTRY_ID, componentTree, deactivateInspectorOnDevtoolsNavigation, deepestAtPoint, deepestForTarget, getInspectorController, type ComponentNode } from './inspector.js'
import { INSPECT_ICON_SVG } from './inspect-icon.js'

const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`
const liquidIcon = icon('<path d="M12 2.5c3.2 4.1 6.2 7.5 6.2 11.2a6.2 6.2 0 1 1-12.4 0C5.8 10 8.8 6.6 12 2.5Z"/><path d="M9 15.2c.5 1.4 1.5 2.1 3 2.1"/>')
const inspectIcon = INSPECT_ICON_SVG.replace('<svg ', '<svg class="inspect-icon" aria-hidden="true" ')
const closeIcon = icon('<path d="m7 7 10 10M17 7 7 17"/>')

export class ShopifyDevtools extends HTMLElement {
  #shadow = this.attachShadow({ mode: 'open' })
  #controller = getInspectorController()
  #panelOpen = false
  #tree: ComponentNode[] = this.#controller.tree
  #unsubscribe?: () => void
  #shownError?: Error
  onInspectPage?: () => void
  #observer = new MutationObserver(() => this.#controller.refresh())

  connectedCallback(): void {
    this.#shadow.innerHTML = `<style>${styles}.inspect-icon{width:18px;height:18px}.header-actions{display:flex;align-items:center;gap:4px}.panel-inspect{display:none;align-items:center;gap:7px;height:30px;padding:0 9px;border:1px solid var(--border);border-radius:7px;color:var(--muted);background:transparent;cursor:pointer}.panel-inspect:hover{background:var(--raised);color:var(--text)}.panel-inspect.active{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-text)}.panel-inspect span{font-size:12px;font-weight:600}</style>
      <section id="panel" aria-label="Shopify Liquid DevTools">
        <header><div class="title">${liquidIcon}<strong>Liquid DevTools</strong><span class="badge">DEV</span></div><div class="header-actions"><button id="panel-inspect" class="panel-inspect" aria-label="Inspect Liquid component" aria-pressed="false">${inspectIcon}<span>Inspect page</span></button><button id="close" class="icon" aria-label="Close DevTools">${closeIcon}</button></div></header>
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
    this.#shadow.querySelector('#panel-inspect')?.addEventListener('click', () => { if (this.onInspectPage) this.onInspectPage(); else this.toggleInspector() })
    this.#shadow.querySelector('#close')?.addEventListener('click', () => this.togglePanel(false))
    for (const event of shopifyEvents) document.addEventListener(event, this.#refreshEvent)
    this.#observer.observe(document.documentElement, { childList: true, subtree: true })
    this.#unsubscribe = this.#controller.subscribe(() => this.syncController())
    this.#controller.refresh()
  }

  disconnectedCallback(): void {
    this.#observer.disconnect()
    this.#unsubscribe?.()
    this.#controller.clearHighlight()
    for (const event of shopifyEvents) document.removeEventListener(event, this.#refreshEvent)
  }

  #refreshEvent = (): void => this.#controller.refresh()

  togglePanel(force = !this.#panelOpen): void {
    this.#panelOpen = force
    this.#shadow.querySelector('#panel')?.classList.toggle('open', force)
    this.#shadow.querySelector('#toggle')?.setAttribute('aria-pressed', String(force))
  }

  toggleInspector(force = !this.#controller.active): void {
    if (force) this.#controller.activate(); else this.#controller.deactivate()
  }

  syncController(): void {
    const force = this.#controller.active
    this.#shadow.querySelector('#inspect')?.classList.toggle('active', force)
    this.#shadow.querySelector('#inspect')?.setAttribute('aria-pressed', String(force))
    this.#shadow.querySelector('#panel-inspect')?.classList.toggle('active', force)
    this.#shadow.querySelector('#panel-inspect')?.setAttribute('aria-pressed', String(force))
    this.#tree = this.#controller.tree
    const list = this.#shadow.querySelector('#tree')
    if (list) list.replaceChildren(...this.#tree.map((node) => this.renderNode(node)))
    if (this.#controller.selected) this.showSelection(this.#controller.selected)
    if (this.#controller.error && this.#controller.error !== this.#shownError) {
      this.#shownError = this.#controller.error
      this.toast(this.#controller.error.message, 'error')
    }
  }

  renderNode(node: ComponentNode): HTMLLIElement {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.className = 'tree-item'
    button.dataset.key = `${node.id}:${node.occurrence}`
    button.innerHTML = `<span class="kind ${node.kind}">${node.kind.slice(0, 1).toUpperCase()}</span><span><b>${node.file.split('/').at(-1)}</b><small>${node.kind}</small></span>`
    button.addEventListener('click', () => this.select(node))
    item.append(button)
    if (node.children.length) {
      const nested = document.createElement('ol')
      nested.append(...node.children.map((child) => this.renderNode(child)))
      item.append(nested)
    }
    return item
  }

  select(node: ComponentNode): void {
    this.#controller.select(node)
  }

  showSelection(node: ComponentNode): void {
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
      await this.#controller.openEditor(node)
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

const styles = `:host{all:initial;--bg:#111113;--panel:#18181b;--raised:#232326;--border:rgb(153 153 153/.13);--muted:#a1a1aa;--text:#fafafa;--accent:#95bf47;--accent-strong:#5e8e3e;--accent-text:color-mix(in oklab,var(--accent),white 34%);--accent-soft:#95bf4726;--ease:cubic-bezier(.4,0,.2,1);--glass:#111c;font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--text);position:fixed;z-index:2147483647;color-scheme:dark}button{font:inherit}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#toolbar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);height:34px;box-sizing:content-box;display:flex;align-items:center;gap:2px;padding:0 4px;background:var(--glass);border:1px solid var(--border);border-radius:.5rem;box-shadow:0 1px 3px 0 #0000001a,0 1px 2px -1px #0000001a;backdrop-filter:blur(7px);transition:all .5s var(--ease)}#toolbar button,.icon{height:30px;border:0;border-radius:.75rem;color:var(--muted);background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s var(--ease),color .15s var(--ease)}#toolbar svg{width:20px;height:20px;transition:all .3s var(--ease)}#toolbar button:hover svg{transform:scale(1.1)}#toolbar button[aria-pressed=true] svg,#inspect.active svg{transform:scale(1.2)}#toolbar button:hover,.icon:hover{background:var(--raised);color:var(--text)}#toolbar button[aria-pressed=true],#inspect.active{background:var(--accent-soft);color:var(--accent-text)}.brand{gap:7px;padding:0 10px!important;color:var(--text)!important;font-weight:650}.brand svg{color:var(--accent)}.divider{width:1px;height:20px;background:var(--border);margin:0 2px}#toolbar .icon{width:30px}#panel{position:fixed;left:50%;bottom:70px;transform:translate(-50%,12px) scale(.985);width:min(760px,calc(100vw - 24px));height:min(520px,calc(100vh - 110px));display:flex;flex-direction:column;opacity:0;visibility:hidden;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 80px #000a;overflow:hidden;transition:opacity .5s cubic-bezier(.16,1,.3,1),transform .5s cubic-bezier(.16,1,.3,1),visibility .5s;resize:vertical}#panel.open{opacity:1;visibility:visible;transform:translate(-50%,0) scale(1)}header{height:45px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 14px;border-bottom:1px solid var(--border);background:var(--bg)}.title{display:flex;align-items:center;gap:8px}.title svg{color:var(--accent)}.title .badge{font-size:9px;letter-spacing:.08em;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:1px 4px}header .icon{width:30px;height:30px}.workspace{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:0;flex:1}nav{overflow:auto;border-right:1px solid var(--border);padding:10px 8px}.nav-title{padding:2px 8px 8px;color:var(--muted);font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.07em}ol{list-style:none;padding:0;margin:0}ol ol{padding-left:14px}.tree-item{transition:background .15s var(--ease);width:100%;display:flex;gap:8px;align-items:center;color:var(--text);background:transparent;border:0;border-radius:7px;padding:6px 7px;text-align:left;cursor:pointer}.tree-item:hover{background:var(--raised)}.tree-item.selected{background:var(--accent-soft);color:var(--accent-text)}.tree-item>span:not(.kind){min-width:0;display:flex;flex-direction:column}.tree-item b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-item small,.detail-heading small{font-size:10px;color:var(--muted);text-transform:capitalize}.kind{width:22px;height:22px;flex:none;display:grid;place-items:center;border-radius:6px;font-size:10px;font-weight:750;background:#3f3f46;color:#d4d4d8}.kind.section{background:#95bf4733;color:var(--accent-text)}.kind.block{background:#0ea5e933;color:#7dd3fc}.kind.snippet{background:#10b98133;color:#6ee7b7}main{min-width:0;overflow:auto;padding:20px}.empty{height:100%;display:grid;place-items:center;text-align:center;color:var(--muted)}.detail-heading{display:flex;align-items:center;gap:10px;padding-bottom:16px;border-bottom:1px solid var(--border)}.detail-heading>div{display:flex;flex-direction:column}dl{display:grid;grid-template-columns:90px minmax(0,1fr);gap:10px 14px;margin:18px 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.open-editor{border:1px solid var(--accent-strong);background:var(--accent-strong);color:white;border-radius:8px;padding:8px 12px;font-weight:650;cursor:pointer}.open-editor:hover{background:color-mix(in oklab,var(--accent-strong),black 12%)}.open-editor:disabled{opacity:.6;cursor:wait}#highlights{position:fixed;inset:0;pointer-events:none}.highlight{position:fixed;box-sizing:border-box;border:2px solid var(--accent);background:var(--accent-soft);border-radius:2px;box-shadow:0 0 0 1px #fff3 inset}#toast{position:fixed;left:50%;bottom:72px;max-width:min(460px,calc(100vw - 30px));transform:translate(-50%,8px);opacity:0;visibility:hidden;padding:9px 13px;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--text);box-shadow:0 10px 35px #0008;transition:all .15s var(--ease)}#toast.show{opacity:1;visibility:visible;transform:translate(-50%,0)}#toast[data-type=success]{border-color:#34d39966}#toast[data-type=error]{border-color:#fb718577;color:#fecdd3}@media(max-width:640px){#toolbar{bottom:10px}#panel{bottom:60px;width:calc(100vw - 12px);height:calc(100vh - 75px)}.workspace{grid-template-columns:1fr;grid-template-rows:minmax(120px,40%) 1fr}nav{border-right:0;border-bottom:1px solid var(--border)}main{padding:14px}}@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}@media(prefers-color-scheme:light){:host{--bg:#fff;--panel:#fafafa;--raised:#f0f0f2;--border:#dedee3;--muted:#71717a;--text:#18181b;--accent-text:color-mix(in oklab,var(--accent-strong),black 25%);--accent-soft:#95bf4733;--glass:#ffffffa6;color-scheme:light}#toolbar,#panel,#toast{box-shadow:0 14px 45px #18181b25}.open-editor{color:#fff}}`

if (!customElements.get('shopify-liquid-devtools')) customElements.define('shopify-liquid-devtools', ShopifyDevtools)

export default function setupShopifyDevtools(context: DockClientScriptContext): void {
  getInspectorController().setRpc(context.rpc)
  deactivateInspectorOnDevtoolsNavigation(context)
  const mount = (panel: HTMLElement): void => {
    const host = (panel.querySelector('shopify-liquid-devtools') ?? document.createElement('shopify-liquid-devtools')) as ShopifyDevtools
    host.setAttribute('data-vite-devtools-panel', '')
    if (context.docks) host.onInspectPage = () => void context.docks.switchEntry(INSPECT_ENTRY_ID)
    panel.append(host)
    if (!host.shadowRoot?.querySelector('#vite-devtools-native-layout')) {
      const nativeLayout = document.createElement('style')
      nativeLayout.id = 'vite-devtools-native-layout'
      nativeLayout.textContent = `:host{position:relative!important;display:block!important;width:100%;height:100%;z-index:auto!important;pointer-events:inherit!important;opacity:inherit!important;visibility:inherit!important}#toolbar{display:none!important}.panel-inspect{display:flex!important}#close{display:none!important}#panel{position:relative!important;inset:auto!important;transform:none!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;resize:none!important;opacity:1;visibility:inherit}`
      host.shadowRoot?.append(nativeLayout)
    }
    host.togglePanel(true)
  }

  context.current.events.on('entry:deactivated', () => getInspectorController().clearHighlight())
  context.current.events.on('dom:panel:mounted', mount)
  const mountedPanel = context.current.domElements.panel
  if (mountedPanel) mount(mountedPanel)
}

export { componentTree, deepestAtPoint, deepestForTarget }
