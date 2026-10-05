import type { DockClientScriptContext } from '@vitejs/devtools-kit/client'
import { INSPECT_ENTRY_ID, componentTree, deactivateInspectorOnDevtoolsNavigation, deepestAtPoint, deepestForTarget, getInspectorController, type ComponentNode } from './inspector.js'
import { INSPECT_ICON_SVG } from './inspect-icon.js'
import { SHOPIFY_GLYPH_URI } from './shopify-glyph.js'

const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`
const liquidIcon = `<img class="glyph" src="${SHOPIFY_GLYPH_URI}" alt="" aria-hidden="true" draggable="false">`
const inspectIcon = INSPECT_ICON_SVG.replace('<svg ', '<svg class="inspect-icon" aria-hidden="true" ')
const closeIcon = icon('<path d="m7 7 10 10M17 7 7 17"/>')
const disclosureIcon = icon('<path d="m9 6 6 6-6 6"/>')
const COLLAPSED_KEY = 'shopify-devtools:collapsed-nodes'
const PANEL_LAYOUT_KEY = 'shopify-devtools:panel-layout'
type PanelLayout = { x: number; y: number; width: number; height: number }

export class ShopifyDevtools extends HTMLElement {
  #shadow = this.attachShadow({ mode: 'open' })
  #controller = getInspectorController()
  #panelOpen = false
  #tree: ComponentNode[] = this.#controller.tree
  #unsubscribe?: () => void
  #shownError?: Error
  #query = ''
  #collapsed = this.readCollapsed()
  #treeSignature = ''
  #resizeObserver?: ResizeObserver
  #layoutTimer?: ReturnType<typeof setTimeout>
  #drag?: { pointerId: number; offsetX: number; offsetY: number }
  onInspectPage?: () => void
  #observer = new MutationObserver(() => this.#controller.refresh())
  #themeObserver = new MutationObserver(() => this.syncTheme())
  #colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')

  connectedCallback(): void {
    // Lets you score the inference on a page that has markers: `await shopifyDevtools.compareInference()`.
    Object.assign(globalThis, { shopifyDevtools: { compareInference: () => this.#controller.compareInference() } })
    this.#shadow.innerHTML = `<style>${styles}</style>
      <section id="panel" aria-label="Shopify Liquid DevTools">
        <header><div class="title">${liquidIcon}<strong>Liquid DevTools</strong><span class="badge">DEV</span></div><div class="header-actions"><button id="panel-inspect" class="panel-inspect" aria-label="Inspect Liquid component" aria-pressed="false">${inspectIcon}<span>Inspect page</span></button><button id="close" class="icon" aria-label="Close DevTools">${closeIcon}</button></div></header>
        <div class="workspace"><nav><div class="nav-title">Components</div><label class="search"><span class="sr-only">Search components</span><input id="search" type="search" placeholder="Search components…" autocomplete="off"></label><ol id="tree" role="tree" aria-label="Liquid components"></ol></nav><main id="details"><div class="empty"><strong>No component selected</strong><span>Select a component from the tree or activate the inspector.</span></div></main></div>
      </section>
      <div id="toast" role="status" aria-live="polite"></div>
      <div id="toolbar" role="toolbar" aria-label="Shopify Liquid DevTools">
        <button id="toggle" class="brand" aria-label="Toggle Liquid DevTools" aria-pressed="false">${liquidIcon}<span>Liquid</span></button>
        <span class="divider"></span>
        <button id="inspect" class="icon" aria-label="Inspect Liquid component" aria-pressed="false">${inspectIcon}</button>
      </div>`
    this.#themeSource = themeSource(this)
    if (this.#themeSource) this.#themeObserver.observe(this.#themeSource, { attributes: true, attributeFilter: ['class'] })
    this.#colorScheme?.addEventListener('change', this.#syncTheme)
    window.addEventListener('storage', this.#syncTheme)
    this.syncTheme()
    this.#shadow.querySelector('#toggle')?.addEventListener('click', () => this.togglePanel())
    this.#shadow.querySelector('#inspect')?.addEventListener('click', () => this.toggleInspector())
    this.#shadow.querySelector('#panel-inspect')?.addEventListener('click', () => { if (this.onInspectPage) this.onInspectPage(); else this.toggleInspector() })
    this.#shadow.querySelector('#close')?.addEventListener('click', () => this.togglePanel(false))
    const panel = this.#shadow.querySelector<HTMLElement>('#panel')
    const header = this.#shadow.querySelector<HTMLElement>('header')
    if (!this.hasAttribute('data-vite-devtools-panel') && panel && header) {
      this.applyPanelLayout(panel)
      header.addEventListener('pointerdown', this.#startDrag)
      if (typeof ResizeObserver !== 'undefined') {
        this.#resizeObserver = new ResizeObserver(() => this.schedulePanelLayoutSave())
        this.#resizeObserver.observe(panel)
      }
      window.addEventListener('resize', this.#constrainPanel)
    }
    this.#shadow.querySelector('#search')?.addEventListener('input', (event) => {
      this.#query = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase()
      this.renderTree()
    })
    for (const event of shopifyEvents) document.addEventListener(event, this.#refreshEvent)
    this.#observer.observe(document.documentElement, { childList: true, subtree: true })
    this.#unsubscribe = this.#controller.subscribe(() => this.syncController())
    this.#controller.refresh()
  }

  disconnectedCallback(): void {
    this.#observer.disconnect()
    this.#themeObserver.disconnect()
    this.#colorScheme?.removeEventListener('change', this.#syncTheme)
    window.removeEventListener('storage', this.#syncTheme)
    this.#unsubscribe?.()
    this.#resizeObserver?.disconnect()
    removeEventListener('pointermove', this.#dragPanel)
    removeEventListener('pointerup', this.#stopDrag)
    if (this.#layoutTimer) clearTimeout(this.#layoutTimer)
    window.removeEventListener('resize', this.#constrainPanel)
    this.#controller.clearHighlight()
    for (const event of shopifyEvents) document.removeEventListener(event, this.#refreshEvent)
  }

  #themeSource: Element | null = null
  #syncTheme = (): void => this.syncTheme()

  syncTheme(): void {
    this.dataset.theme = resolveTheme(this.#themeSource, this.#colorScheme?.matches ?? true)
  }

  #refreshEvent = (): void => this.#controller.refresh()

  togglePanel(force = !this.#panelOpen): void {
    this.#panelOpen = force
    this.#shadow.querySelector('#panel')?.classList.toggle('open', force)
    this.#shadow.querySelector('#toggle')?.setAttribute('aria-pressed', String(force))
  }

  readPanelLayout(): PanelLayout | undefined {
    try {
      const value = JSON.parse(localStorage.getItem(PANEL_LAYOUT_KEY) ?? 'null') as Partial<PanelLayout> | null
      if (value && [value.x, value.y, value.width, value.height].every((part) => typeof part === 'number' && Number.isFinite(part))) return value as PanelLayout
    } catch { /* Storage can be unavailable or malformed. */ }
  }

  constrainedLayout(layout: PanelLayout): PanelLayout {
    const minimumWidth = Math.min(320, innerWidth - 12)
    const minimumHeight = Math.min(220, innerHeight - 24)
    const width = Math.min(Math.max(minimumWidth, layout.width), innerWidth - 12)
    const height = Math.min(Math.max(minimumHeight, layout.height), innerHeight - 24)
    return { width, height, x: Math.min(Math.max(6, layout.x), Math.max(6, innerWidth - width - 6)), y: Math.min(Math.max(6, layout.y), Math.max(6, innerHeight - height - 6)) }
  }

  applyPanelLayout(panel: HTMLElement): void {
    const stored = this.readPanelLayout()
    if (!stored) return
    const layout = this.constrainedLayout(stored)
    Object.assign(panel.style, { left: `${layout.x}px`, top: `${layout.y}px`, bottom: 'auto', transform: 'none', width: `${layout.width}px`, height: `${layout.height}px` })
  }

  currentPanelLayout(): PanelLayout | undefined {
    const panel = this.#shadow.querySelector<HTMLElement>('#panel')
    if (!panel || this.hasAttribute('data-vite-devtools-panel')) return
    const rect = panel.getBoundingClientRect()
    return this.constrainedLayout({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  }

  savePanelLayout(): void {
    const layout = this.currentPanelLayout()
    if (!layout) return
    try { localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(layout)) } catch { /* Storage can be unavailable. */ }
  }

  schedulePanelLayoutSave(): void {
    if (this.#layoutTimer) clearTimeout(this.#layoutTimer)
    this.#layoutTimer = setTimeout(() => this.savePanelLayout(), 100)
  }

  #startDrag = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    const panel = this.#shadow.querySelector<HTMLElement>('#panel')
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    this.#drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
    Object.assign(panel.style, { left: `${rect.left}px`, top: `${rect.top}px`, bottom: 'auto', transform: 'none', width: `${rect.width}px`, height: `${rect.height}px` })
    addEventListener('pointermove', this.#dragPanel)
    addEventListener('pointerup', this.#stopDrag)
    event.preventDefault()
  }

  #dragPanel = (event: PointerEvent): void => {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) return
    const panel = this.#shadow.querySelector<HTMLElement>('#panel')
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const layout = this.constrainedLayout({ x: event.clientX - this.#drag.offsetX, y: event.clientY - this.#drag.offsetY, width: rect.width, height: rect.height })
    panel.style.left = `${layout.x}px`; panel.style.top = `${layout.y}px`
  }

  #stopDrag = (event: PointerEvent): void => {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) return
    this.#drag = undefined
    removeEventListener('pointermove', this.#dragPanel)
    removeEventListener('pointerup', this.#stopDrag)
    this.savePanelLayout()
  }

  #constrainPanel = (): void => {
    const panel = this.#shadow.querySelector<HTMLElement>('#panel')
    const layout = this.currentPanelLayout()
    if (!panel || !layout) return
    Object.assign(panel.style, { left: `${layout.x}px`, top: `${layout.y}px`, width: `${layout.width}px`, height: `${layout.height}px` })
    this.schedulePanelLayoutSave()
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
    const signature = this.#tree.flatMap(function walk(node): ComponentNode[] { return [node, ...node.children.flatMap(walk)] })
      .map((node) => [node.id, node.occurrence, node.instanceKey, node.instanceName, node.origin, node.instanceSourceFile, node.callSiteFile, node.callSiteLine, JSON.stringify(node.settings), node.children.length].join('|')).join('\n')
    if (signature !== this.#treeSignature) { this.#treeSignature = signature; this.renderTree() }
    if (this.#controller.selected) this.showSelection(this.#controller.selected)
    if (this.#controller.error && this.#controller.error !== this.#shownError) {
      this.#shownError = this.#controller.error
      this.toast(this.#controller.error.message, 'error')
    }
  }

  readCollapsed(): Set<string> {
    try {
      const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
      return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
    } catch { return new Set() }
  }

  saveCollapsed(): void {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...this.#collapsed])) } catch { /* Storage can be unavailable. */ }
  }

  nodeKey(node: ComponentNode): string { return `${node.id}:${node.occurrence}` }

  originLabel(node: ComponentNode): string | undefined {
    return node.origin === 'template' ? 'Template' : node.origin === 'section-group' ? 'Section group' : undefined
  }

  searchText(node: ComponentNode): string {
    return [this.displayName(node, false), node.file, node.kind, node.instanceKey, node.instanceName, node.owner, node.ownerFilename, this.originLabel(node)].filter(Boolean).join(' ').toLocaleLowerCase()
  }

  nodeMatches(node: ComponentNode): boolean {
    return !this.#query || this.searchText(node).includes(this.#query) || node.children.some((child) => this.nodeMatches(child))
  }

  renderTree(): void {
    const list = this.#shadow.querySelector('#tree')
    if (!list) return
    const nodes = this.#tree.filter((node) => this.nodeMatches(node))
    const items = nodes.map((node) => this.renderNode(node))
    if (!items.length) items.push(this.renderNote(this.#query ? `No components match “${this.#query}”.` : 'No Liquid sections found on this page.'))
    else if (this.#controller.mode === 'inferred' && !this.#query) items.unshift(this.renderNote('Blocks and snippets are inferred from your theme source and can be incomplete. Use the full mode for exact results: see "Full mode" in the README.'))
    list.replaceChildren(...items)
    this.syncTabStops()
  }

  syncTabStops(preferred?: HTMLElement): void {
    const entries = [...this.#shadow.querySelectorAll<HTMLElement>('.tree-item')]
    const active = preferred ?? entries.find((item) => item.classList.contains('selected')) ?? entries[0]
    for (const entry of entries) entry.tabIndex = entry === active ? 0 : -1
  }

  renderNote(text: string): HTMLLIElement {
    const item = document.createElement('li'); item.className = 'tree-empty'
    item.textContent = text
    return item
  }

  // Inline blocks live in their section's file, so the file name alone would repeat the section.
  displayName(node: ComponentNode, suffix = true): string {
    const primary = node.label && node.file.startsWith('sections/') ? node.label : node.file.split('/').at(-1) ?? node.file
    const name = [primary, node.instanceName, node.instanceKey].filter(Boolean).join(' · ')
    if (!suffix) return name
    const identical = this.#tree.flatMap(function walk(item): ComponentNode[] { return [item, ...item.children.flatMap(walk)] })
      .filter((item) => this.displayName(item, false) === name)
    const index = identical.indexOf(node)
    return index > 0 ? `${name} #${index + 1}` : name
  }

  displayKind(node: ComponentNode): string {
    return node.inferred && node.kind !== 'section' ? `${node.kind} · inferred` : node.kind
  }

  renderNode(node: ComponentNode): HTMLLIElement {
    const item = document.createElement('li')
    item.setAttribute('role', 'none')
    const button = document.createElement('button')
    button.className = 'tree-item'
    button.dataset.key = this.nodeKey(node)
    button.setAttribute('role', 'treeitem')
    const children = node.children.filter((child) => this.nodeMatches(child))
    const expanded = this.#query ? true : !this.#collapsed.has(this.nodeKey(node))
    if (node.children.length) button.setAttribute('aria-expanded', String(expanded))
    const disclosure = document.createElement('span'); disclosure.className = `disclosure${node.children.length ? '' : ' placeholder'}`; disclosure.innerHTML = disclosureIcon
    const text = document.createElement('span')
    const name = document.createElement('b'); name.textContent = this.displayName(node)
    const kind = document.createElement('small'); kind.textContent = this.displayKind(node)
    text.append(name, kind)
    const badgeText = this.originLabel(node)
    if (badgeText) { const badge = document.createElement('em'); badge.className = 'origin'; badge.textContent = badgeText; text.append(badge) }
    const initial = document.createElement('span'); initial.className = `kind ${node.kind}`; initial.textContent = node.kind.slice(0, 1).toUpperCase()
    button.append(disclosure, initial, text)
    button.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.disclosure') && node.children.length) this.toggleNode(node)
      else this.select(node)
    })
    button.addEventListener('focus', () => { this.syncTabStops(button); if (this.#controller.selected !== node) this.select(node) })
    button.addEventListener('keydown', (event) => this.onTreeKey(event, node))
    item.append(button)
    if (children.length && expanded) {
      const nested = document.createElement('ol')
      nested.setAttribute('role', 'group')
      nested.append(...children.map((child) => this.renderNode(child)))
      item.append(nested)
    }
    return item
  }

  toggleNode(node: ComponentNode, expand = this.#collapsed.has(this.nodeKey(node))): void {
    if (expand) this.#collapsed.delete(this.nodeKey(node)); else this.#collapsed.add(this.nodeKey(node))
    this.saveCollapsed(); this.renderTree(); this.focusNode(node)
  }

  focusNode(node: ComponentNode): void {
    const entry = [...this.#shadow.querySelectorAll<HTMLElement>('.tree-item')].find((item) => item.dataset.key === this.nodeKey(node))
    entry?.focus(); if (entry && 'scrollIntoView' in entry) entry.scrollIntoView({ block: 'nearest' })
  }

  onTreeKey(event: KeyboardEvent, node: ComponentNode): void {
    const visible = [...this.#shadow.querySelectorAll<HTMLElement>('.tree-item')]
    const current = event.currentTarget as HTMLElement
    const index = visible.indexOf(current)
    let target: ComponentNode | undefined
    if (event.key === 'ArrowDown') target = visible[index + 1] && this.nodeFor(visible[index + 1])
    else if (event.key === 'ArrowUp') target = visible[index - 1] && this.nodeFor(visible[index - 1])
    else if (event.key === 'ArrowRight' && node.children.length) {
      if (this.#collapsed.has(this.nodeKey(node)) && !this.#query) this.toggleNode(node, true)
      else target = node.children.find((child) => this.nodeMatches(child))
    } else if (event.key === 'ArrowLeft') {
      if (node.children.length && !this.#collapsed.has(this.nodeKey(node)) && !this.#query) this.toggleNode(node, false)
      else target = node.parent ?? undefined
    } else if (event.key === 'Enter') void this.openEditor(node)
    else return
    event.preventDefault()
    if (target) this.focusNode(target)
  }

  nodeFor(entry: HTMLElement): ComponentNode | undefined {
    const nodes = this.#tree.flatMap(function walk(node): ComponentNode[] { return [node, ...node.children.flatMap(walk)] })
    return nodes.find((node) => this.nodeKey(node) === entry.dataset.key)
  }

  select(node: ComponentNode): void {
    this.#controller.select(node)
  }

  showSelection(node: ComponentNode): void {
    for (let parent = node.parent; parent; parent = parent.parent) this.#collapsed.delete(this.nodeKey(parent))
    this.saveCollapsed()
    if (![...this.#shadow.querySelectorAll<HTMLElement>('.tree-item')].some((item) => item.dataset.key === this.nodeKey(node))) this.renderTree()
    this.#shadow.querySelectorAll('.tree-item').forEach((item) => {
      item.classList.remove('selected'); item.setAttribute('aria-selected', 'false')
    })
    const key = this.nodeKey(node)
    const selected = [...this.#shadow.querySelectorAll<HTMLElement>('.tree-item')].find((item) => item.dataset.key === key)
    selected?.classList.add('selected')
    selected?.setAttribute('aria-selected', 'true')
    if (selected && 'scrollIntoView' in selected) selected.scrollIntoView({ block: 'nearest' })
    const element = node.roots[0]
    const details = this.#shadow.querySelector('#details')
    if (!details) return
    details.replaceChildren()
    const heading = document.createElement('div'); heading.className = 'detail-heading'
    const initial = document.createElement('span'); initial.className = `kind ${node.kind}`; initial.textContent = node.kind.slice(0, 1).toUpperCase()
    const title = document.createElement('div')
    const strong = document.createElement('strong'); strong.textContent = this.displayName(node)
    const small = document.createElement('small'); small.textContent = [this.displayKind(node), this.originLabel(node)].filter(Boolean).join(' · ')
    title.append(strong, small)
    heading.append(initial, title)
    const fields = document.createElement('dl')
    const dom = element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].map((value) => `.${value}`).join('')}` : 'No DOM root'
    const detailFields: Array<[string, string, string?]> = [['File', node.file, node.file], ['Line', String(node.line)], ['Location', `${node.file}:${node.line}`, `${node.file}:${node.line}`], ['DOM', dom], ['Shopify ID', node.shopifyId ?? '—', node.shopifyId]]
    for (const [label, value, copy] of detailFields) {
      const dt = document.createElement('dt'); dt.textContent = label
      const dd = document.createElement('dd'); dd.textContent = value
      if (copy) { const control = document.createElement('button'); control.className = 'copy'; control.type = 'button'; control.setAttribute('aria-label', `Copy ${label}`); control.textContent = 'Copy'; control.addEventListener('click', () => void this.copyValue(copy)); dd.append(control) }
      fields.append(dt, dd)
    }
    const open = document.createElement('button'); open.className = 'open-editor'; open.textContent = 'Open in editor'
    open.addEventListener('click', () => void this.openEditor(node, open))
    const card = document.createElement('section'); card.className = 'card'
    const actions = document.createElement('div'); actions.className = 'detail-actions'; actions.append(open)
    if (node.instanceSourceFile) {
      const openInstance = document.createElement('button'); openInstance.className = 'open-source'; openInstance.textContent = 'Open template JSON'
      openInstance.addEventListener('click', () => void this.openInstanceSource(node, openInstance))
      actions.append(openInstance)
    }
    if (node.callSiteFile) {
      const callLabel = node.kind === 'block' ? 'Open block call' : 'Open render call'
      const openCallSite = document.createElement('button'); openCallSite.className = 'open-source'; openCallSite.textContent = callLabel
      openCallSite.addEventListener('click', () => void this.openRelatedSource(node.callSiteFile!, node.callSiteLine ?? 1, callLabel, openCallSite))
      actions.append(openCallSite)
    }
    card.append(heading, actions, fields)
    if (node.settings) {
      const settingsHeading = document.createElement('h3'); settingsHeading.textContent = 'Block settings'
      const settings = document.createElement('pre'); settings.className = 'settings'; settings.textContent = JSON.stringify(node.settings, null, 2)
      card.append(settingsHeading, settings)
    }
    details.append(card)
  }

  async copyValue(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); this.toast(`Copied ${value}`, 'success') }
    catch { this.toast('Could not copy to the clipboard', 'error') }
  }

  async openInstanceSource(node: ComponentNode, button: HTMLButtonElement): Promise<void> {
    if (!node.instanceSourceFile) return
    await this.openRelatedSource(node.instanceSourceFile, node.instanceSourceLine ?? 1, 'Open template JSON', button)
  }

  async openRelatedSource(file: string, line: number, label: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true; button.textContent = 'Opening…'
    try {
      await this.#controller.openSource(file, line)
      this.toast(`Opened ${file}:${line}`, 'success')
    } catch (error) {
      this.toast(error instanceof Error ? error.message : `Could not ${label.toLocaleLowerCase()}`, 'error')
    } finally { button.disabled = false; button.textContent = label }
  }

  async openEditor(node: ComponentNode, button?: HTMLButtonElement): Promise<void> {
    if (button) { button.disabled = true; button.textContent = 'Opening…' }
    try {
      await this.#controller.openEditor(node)
      this.toast(`Opened ${node.file}:${node.line}`, 'success')
    } catch (error) {
      this.toast(error instanceof Error ? error.message : 'Could not open the editor', 'error')
    } finally { if (button) { button.disabled = false; button.textContent = 'Open in editor' } }
  }

  toast(message: string, type: 'success' | 'error'): void {
    const toast = this.#shadow.querySelector('#toast') as HTMLElement | null
    if (!toast) return
    toast.textContent = message; toast.dataset.type = type; toast.classList.add('show')
    setTimeout(() => toast.classList.remove('show'), 3_500)
  }
}

const COLOR_SCHEME_KEY = 'devframes-color-scheme'

/** Nearest ancestor (crossing shadow roots) that Vite DevTools marks with `.dark` or `.light`. */
function themeSource(element: Element): Element | null {
  let node: Node | null = element
  while (node) {
    if (node instanceof Element && (node.classList.contains('dark') || node.classList.contains('light'))) return node
    node = node.parentNode ?? (node as ShadowRoot).host ?? null
  }
  return null
}

/** The selected Vite DevTools theme, falling back to its stored choice and then the OS preference. */
export function resolveTheme(source: Element | null, prefersDark: boolean): 'dark' | 'light' {
  if (source?.classList.contains('dark')) return 'dark'
  if (source?.classList.contains('light')) return 'light'
  let stored: string | null = null
  try { stored = localStorage.getItem(COLOR_SCHEME_KEY) } catch { /* Storage can be unavailable. */ }
  const value = stored?.replace(/^"|"$/g, '')
  if (value === 'dark' || value === 'light') return value
  return prefersDark ? 'dark' : 'light'
}

const shopifyEvents = ['shopify:section:load', 'shopify:section:unload', 'shopify:section:reorder', 'shopify:block:select', 'shopify:block:deselect']

const styles = `
:host{all:initial;--bg:#111;--panel:#111;--raised:#1c1c1c;--selected:#242424;--border:#303030;--muted:#aaa;--text:#f2f2f2;--focus:#91d0ff;--primary-bg:#fff;--primary-hover:#f3f3f3;--primary-text:#0a0a0a;--accent:#4ac93e;--accent-strong:#2f9a28;--accent-text:color-mix(in oklab,var(--accent),white 34%);--accent-soft:#4ac93e26;--glass:#111;--shadow-bar:0 4px 6px -2px #0006;--shadow-float:0 8px 16px -4px #0008;--section-bg:#92fec229;--section-text:#b4fed2;--block-bg:#91d0ff29;--block-text:#cae6ff;--snippet-bg:#ffeb7829;--snippet-text:#fff4bf;--ok-bg:#92fec21f;--ok-border:#92fec24d;--ok-text:#b4fed2;--err-bg:#fec3c11f;--err-border:#fec3c14d;--err-text:#fed3d1;--ease:cubic-bezier(.25,.1,.25,1);--dock-ease:cubic-bezier(.4,0,.2,1);font:450 13px/20px Inter,-apple-system,BlinkMacSystemFont,'San Francisco','Segoe UI',Roboto,'Helvetica Neue',sans-serif;color:var(--text);position:fixed;z-index:2147483647;color-scheme:dark}
:host([data-theme=light]){--bg:#fff;--panel:#fff;--raised:#f4f4f4;--selected:#ececec;--border:#e3e3e3;--muted:#616161;--text:#303030;--focus:#005bd3;--primary-bg:#101010;--primary-hover:#0a0a0a;--primary-text:#fff;--accent-text:color-mix(in oklab,var(--accent-strong),black 25%);--accent-soft:#4ac93e33;--glass:#fff;--shadow-bar:0 4px 6px -2px #1a1a1a33;--shadow-float:0 8px 16px -4px #1a1a1a38;--section-bg:#cdfee1;--section-text:#0c5132;--block-bg:#eaf4ff;--block-text:#003a5a;--snippet-bg:#fff8db;--snippet-text:#4f4700;--ok-bg:#cdfee1;--ok-border:#92fec2;--ok-text:#0c5132;--err-bg:#fee9e8;--err-border:#fec3c1;--err-text:#8e1f0b;color-scheme:light}
button{font:inherit}button:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.inspect-icon{width:18px;height:18px;fill:currentColor;stroke:none}.glyph{height:20px;width:auto;flex:none;display:block}
#toolbar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);height:34px;box-sizing:content-box;display:flex;align-items:center;gap:2px;padding:0 4px;background:var(--glass);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-bar);transition:all .5s var(--dock-ease)}
#toolbar button,.icon{height:30px;border:0;border-radius:8px;color:var(--muted);background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s var(--ease),color .15s var(--ease)}
#toolbar svg{width:20px;height:20px;transition:all .3s var(--dock-ease)}#toolbar button:hover svg{transform:scale(1.1)}#toolbar button[aria-pressed=true] svg,#inspect.active svg{transform:scale(1.2)}
#toolbar button:hover,.icon:hover{background:var(--raised);color:var(--text)}#toolbar button[aria-pressed=true],#inspect.active{background:var(--accent-soft);color:var(--accent-text)}
.brand{gap:7px;padding:0 10px!important;color:var(--text)!important;font-weight:650}.divider{width:1px;height:20px;background:var(--border);margin:0 2px}#toolbar .icon{width:30px}
#panel{position:fixed;left:50%;bottom:70px;transform:translate(-50%,12px) scale(.985);width:min(760px,calc(100vw - 24px));height:min(520px,calc(100vh - 110px));min-width:min(320px,calc(100vw - 12px));min-height:min(220px,calc(100vh - 24px));max-width:calc(100vw - 12px);max-height:calc(100vh - 24px);display:flex;flex-direction:column;opacity:0;visibility:hidden;background:var(--bg);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-float);overflow:hidden;transition:opacity .5s cubic-bezier(.16,1,.3,1),transform .5s cubic-bezier(.16,1,.3,1),visibility .5s;resize:both}#panel.open{opacity:1;visibility:visible;transform:translate(-50%,0) scale(1)}
header{height:45px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 14px;border-bottom:1px solid var(--border);background:var(--panel);cursor:move;user-select:none}header button{cursor:pointer}
.title{display:flex;align-items:center;gap:8px}.title strong{font-weight:650}.title .badge{font-size:12px;line-height:16px;font-weight:550;color:var(--muted);background:var(--raised);border-radius:4px;padding:0 6px}
header .icon{width:30px;height:30px}.header-actions{display:flex;align-items:center;gap:4px}
.panel-inspect{display:none;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--border);border-radius:8px;color:var(--text);background:var(--panel);cursor:pointer;transition:background .15s var(--ease),border-color .15s var(--ease)}.panel-inspect:hover{background:var(--raised)}.panel-inspect.active{border-color:var(--accent);background:var(--accent-soft)}.panel-inspect span{font-size:13px;font-weight:550}
.workspace{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:0;flex:1}
nav{overflow:auto;background:var(--panel);border-right:1px solid var(--border);padding:10px 8px}.nav-title{padding:2px 8px 8px;color:var(--muted);font-size:12px;line-height:16px;font-weight:650;text-transform:uppercase;letter-spacing:.07em}.search{display:block;margin:0 3px 8px}.search input{box-sizing:border-box;width:100%;height:30px;border:1px solid var(--border);border-radius:7px;padding:4px 9px;background:var(--raised);color:var(--text);font:inherit}.search input::placeholder{color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
ol{list-style:none;padding:0;margin:0}ol ol{padding-left:14px}
.tree-item{width:100%;display:flex;gap:7px;align-items:center;color:var(--text);background:transparent;border:0;border-radius:8px;padding:6px 7px 6px 2px;text-align:left;cursor:pointer;transition:background .15s var(--ease)}.tree-item:hover{background:var(--raised)}.tree-item.selected{background:var(--selected);box-shadow:inset 2px 0 0 var(--accent)}
.tree-item>span:not(.kind):not(.disclosure){min-width:0;display:flex;flex-direction:column}.tree-item b{font-size:13px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-item small,.detail-heading small{font-size:12px;line-height:16px;color:var(--muted);text-transform:capitalize}.disclosure{width:16px;height:20px;display:grid;place-items:center;flex:none}.disclosure svg{width:13px;height:13px;transition:transform .12s}.tree-item[aria-expanded=true] .disclosure svg{transform:rotate(90deg)}.disclosure.placeholder{visibility:hidden}.origin{align-self:flex-start;margin-top:2px;padding:0 5px;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-size:10px;line-height:15px;font-style:normal}
.kind{width:22px;height:22px;flex:none;display:grid;place-items:center;border-radius:4px;font-size:12px;font-weight:650;background:var(--raised);color:var(--muted)}.kind.section{background:var(--section-bg);color:var(--section-text)}.kind.block{background:var(--block-bg);color:var(--block-text)}.kind.snippet{background:var(--snippet-bg);color:var(--snippet-text)}
main{min-width:0;overflow:auto;padding:16px}.tree-empty{list-style:none;padding:8px 7px;color:var(--muted);font-size:12px;line-height:1.45}.empty{height:100%;display:grid;place-content:center;gap:4px;text-align:center;color:var(--muted)}.empty strong{color:var(--text);font-weight:550}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:16px}
.detail-heading{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--border)}.detail-heading>div{display:flex;flex-direction:column}.detail-heading strong{font-weight:650}
dl{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px 14px;margin:14px 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,'SF Mono',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px}.copy{float:right;margin-left:8px;border:1px solid var(--border);border-radius:5px;padding:1px 6px;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:11px}.copy:hover{background:var(--raised);color:var(--text)}
.detail-actions{display:flex;gap:8px;margin-top:14px}.open-editor,.open-source{border:0;background:var(--primary-bg);color:var(--primary-text);border-radius:8px;padding:6px 12px;font-weight:550;cursor:pointer;transition:background .15s var(--ease)}.open-editor:hover{background:var(--primary-hover)}.open-source{border:1px solid var(--border);background:transparent;color:var(--text)}.open-source:hover{background:var(--raised)}.open-editor:disabled,.open-source:disabled{opacity:.6;cursor:wait}.card h3{margin:16px 0 6px;font-size:12px;font-weight:650}.settings{max-height:180px;overflow:auto;margin:0;padding:10px;border:1px solid var(--border);border-radius:7px;background:var(--raised);color:var(--text);font:12px/18px ui-monospace,SFMono-Regular,'SF Mono',Consolas,'Liberation Mono',Menlo,monospace;white-space:pre-wrap}
#highlights{position:fixed;inset:0;pointer-events:none}.highlight{position:fixed;box-sizing:border-box;border:2px solid var(--accent);background:var(--accent-soft);border-radius:2px;box-shadow:0 0 0 1px #fff3 inset}
#toast{position:fixed;left:50%;bottom:72px;max-width:min(460px,calc(100vw - 30px));transform:translate(-50%,8px);opacity:0;visibility:hidden;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);box-shadow:var(--shadow-float);transition:all .15s var(--ease)}#toast.show{opacity:1;visibility:visible;transform:translate(-50%,0)}
#toast[data-type=success]{background:var(--ok-bg);border-color:var(--ok-border);color:var(--ok-text)}#toast[data-type=error]{background:var(--err-bg);border-color:var(--err-border);color:var(--err-text)}
@media(max-width:640px){#toolbar{bottom:10px}#panel{bottom:60px;width:calc(100vw - 12px);height:calc(100vh - 75px)}.workspace{grid-template-columns:1fr;grid-template-rows:minmax(120px,40%) 1fr}nav{border-right:0;border-bottom:1px solid var(--border)}main{padding:12px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
:host([data-vite-devtools-panel]) header{cursor:default}
`

if (!customElements.get('shopify-liquid-devtools')) customElements.define('shopify-liquid-devtools', ShopifyDevtools)

export default function setupShopifyDevtools(context: DockClientScriptContext): void {
  const controller = getInspectorController()
  controller.setRpc(context.rpc)
  context.rpc.client?.register({
    name: 'shopify-devtools:sources-changed',
    type: 'action',
    setup: () => ({ handler: () => controller.invalidateSections() }),
  } as never)
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
