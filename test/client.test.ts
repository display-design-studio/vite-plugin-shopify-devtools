// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const section = { id: 'section:hero', kind: 'section', file: 'sections/hero.liquid', line: 1 }
const marker = btoa(JSON.stringify(section))
let client: typeof import('../src/client.js')
let getInspectorController: typeof import('../src/inspector.js').getInspectorController
let nativePanel: HTMLDivElement
const rpcCall = vi.fn<(name: string, input?: unknown) => Promise<unknown>>(async () => ({ ok: true }))

beforeAll(async () => {
  document.body.innerHTML = `<!--shopify-devtools:start:${marker}--><section id="shopify-section-hero" class="hero">Hello</section><!--shopify-devtools:end:${marker}-->`
  client = await import('../src/client.js')
  getInspectorController = (await import('../src/inspector.js')).getInspectorController
  nativePanel = document.createElement('div')
  document.documentElement.append(nativePanel)
  let mount: ((panel: HTMLElement) => void) | undefined
  client.default({
    rpc: { call: rpcCall },
    current: {
      domElements: {},
      events: {
        on: (event: string, handler: (panel: HTMLElement) => void) => { if (event === 'dom:panel:mounted') mount = handler },
      },
    },
  } as never)
  mount?.(nativePanel)
})

afterAll(() => nativePanel.remove())

describe('browser panel', () => {
  it('mounts inside the native Vite DevTools custom-render panel', () => {
    const host = nativePanel.querySelector('shopify-liquid-devtools')
    expect(host).toBeTruthy()
    expect(host?.hasAttribute('data-vite-devtools-panel')).toBe(true)
    expect(host?.shadowRoot?.querySelector('#vite-devtools-native-layout')?.textContent).toContain('#toolbar{display:none')
    const inspector = host?.shadowRoot?.querySelector('#panel-inspect') as HTMLButtonElement
    expect(inspector).toBeTruthy()
    expect(inspector.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 256 256')
    expect(inspector.querySelector('svg')?.classList.contains('inspect-icon')).toBe(true)
    expect(inspector.querySelector('path')?.getAttribute('opacity')).toBe('.2')
    expect(inspector.querySelectorAll('path')).toHaveLength(2)
    inspector.click()
    expect(inspector.getAttribute('aria-pressed')).toBe('true')
    inspector.click()
  })

  it('mounts immediately when Vite created the panel before loading the renderer', () => {
    const panel = document.createElement('div')
    client.default({
      rpc: { call: rpcCall },
      current: {
        domElements: { panel },
        events: { on: vi.fn() },
      },
    } as never)
    expect(panel.querySelector('shopify-liquid-devtools')).toBeTruthy()
    panel.remove()
  })

  it('mounts in Shadow DOM and renders the Liquid tree', () => {
    const host = document.querySelector('shopify-liquid-devtools')
    expect(host?.shadowRoot).toBeTruthy()
    expect(host?.shadowRoot?.querySelector('#toolbar')).toBeTruthy()
    const standaloneInspector = host?.shadowRoot?.querySelector('#inspect')
    expect(standaloneInspector?.getAttribute('aria-pressed')).toBe('false')
    expect(standaloneInspector?.querySelector('svg')?.classList.contains('inspect-icon')).toBe(true)
    expect(host?.shadowRoot?.textContent).toContain('hero.liquid')
  })

  it('synchronizes tree selection and opens the editor through RPC', async () => {
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    ;(shadow?.querySelector('#tree button') as HTMLButtonElement).click()
    expect(shadow?.querySelector('#details')?.textContent).toContain('sections/hero.liquid')
    expect(shadow?.querySelector('#details')?.textContent).toContain('Line1')
    ;(shadow?.querySelector('#details button') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(rpcCall).toHaveBeenCalledWith('shopify-devtools:open-in-editor', { file: 'sections/hero.liquid', line: 1 }))
  })

  it('does not highlight or select page blocks when hovering a tree entry', () => {
    getInspectorController().clearHighlight()
    ;(document.querySelector('#shopify-section-hero') as HTMLElement).getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100, toJSON: () => ({}) })
    const item = document.querySelector('shopify-liquid-devtools')?.shadowRoot?.querySelector('#tree button') as HTMLButtonElement
    item.dispatchEvent(new MouseEvent('pointerenter'))
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeNull()
  })

  it('selecting a tree entry only shows its details, without highlighting the page', () => {
    const item = document.querySelector('shopify-liquid-devtools')?.shadowRoot?.querySelector('#tree button') as HTMLButtonElement
    item.click()
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeNull()
  })

  it('Inspect page switches to the inspect dock like the dock icon', () => {
    const switchEntry = vi.fn()
    const panel = document.createElement('div')
    document.documentElement.append(panel)
    client.default({
      rpc: { call: rpcCall },
      docks: { switchEntry },
      current: { domElements: { panel }, events: { on: vi.fn() } },
    } as never)
    const host = panel.querySelector('shopify-liquid-devtools')
    ;(host?.shadowRoot?.querySelector('#panel-inspect') as HTMLButtonElement).click()
    expect(switchEntry).toHaveBeenCalledWith('shopify-liquid:inspect')
    panel.remove()
  })

  it('highlights the inspected component outside the dock and opens it directly', async () => {
    const target = document.querySelector('#shopify-section-hero') as HTMLElement
    target.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100, toJSON: () => ({}) })
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    ;(shadow?.querySelector('#panel-inspect') as HTMLButtonElement).click()
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 30, clientY: 40 }))
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeTruthy()
    const callsBefore = rpcCall.mock.calls.length
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }))
    await vi.waitFor(() => expect(rpcCall).toHaveBeenCalledTimes(callsBefore + 1))
  })

  it('maps repeated snippet instances to their actual DOM roots', () => {
    const snippet = btoa(JSON.stringify({ id: 'snippet:card:10', kind: 'snippet', file: 'snippets/card.liquid', line: 1 }))
    document.body.innerHTML = `<!--shopify-devtools:start:${marker}--><div id="shopify-section-hero"><!--shopify-devtools:start:${snippet}--><article id="first"></article><!--shopify-devtools:end:${snippet}--><!--shopify-devtools:start:${snippet}--><article id="second"><span id="target"></span></article><!--shopify-devtools:end:${snippet}--></div><!--shopify-devtools:end:${marker}-->`
    const tree = client.componentTree()
    const selected = client.deepestForTarget(tree, document.querySelector('#target') as Element)
    expect(selected?.file).toBe('snippets/card.liquid')
    expect(selected?.occurrence).toBe(1)
    expect(selected?.roots[0]?.id).toBe('second')
  })

  it('filters ancestors, labels repeated entries, navigates, collapses, and copies source values', async () => {
    const snippet = btoa(JSON.stringify({ id: 'snippet:card:10', kind: 'snippet', file: 'snippets/card.liquid', line: 7 }))
    document.body.innerHTML = `<!--shopify-devtools:start:${marker}--><div id="shopify-section-hero"><!--shopify-devtools:start:${snippet}--><article></article><!--shopify-devtools:end:${snippet}--><!--shopify-devtools:start:${snippet}--><article></article><!--shopify-devtools:end:${snippet}--></div><!--shopify-devtools:end:${marker}-->`
    document.dispatchEvent(new Event('shopify:section:load'))
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    await vi.waitFor(() => expect(shadow?.querySelectorAll('.tree-item')).toHaveLength(3))
    expect(shadow?.querySelector('#tree')?.textContent).toContain('card.liquid #2')

    const search = shadow?.querySelector('#search') as HTMLInputElement
    search.value = 'snippet'; search.dispatchEvent(new Event('input'))
    expect(shadow?.querySelectorAll('.tree-item')).toHaveLength(3)
    search.value = 'missing'; search.dispatchEvent(new Event('input'))
    expect(shadow?.querySelector('.tree-empty')?.textContent).toContain('No components match')
    search.value = ''; search.dispatchEvent(new Event('input'))

    const sectionEntry = shadow?.querySelector('.tree-item') as HTMLButtonElement
    ;(sectionEntry.querySelector('.disclosure') as HTMLElement).click()
    expect(shadow?.querySelectorAll('.tree-item')).toHaveLength(1)
    const collapsedSection = shadow?.querySelector('.tree-item') as HTMLButtonElement
    expect(collapsedSection.getAttribute('aria-expanded')).toBe('false')
    collapsedSection.focus()
    collapsedSection.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    const expandedSection = shadow?.querySelector('.tree-item') as HTMLButtonElement
    expect(expandedSection.getAttribute('aria-expanded')).toBe('true')
    expandedSection.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(shadow?.activeElement?.textContent).toContain('card.liquid')
    ;(shadow?.activeElement as HTMLButtonElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => expect(rpcCall).toHaveBeenCalledWith('shopify-devtools:open-in-editor', { file: 'snippets/card.liquid', line: 7 }))

    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    ;(shadow?.querySelector('#details .copy') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('snippets/card.liquid'))
  })

  it('shows a useful RPC error from the editor action', async () => {
    rpcCall.mockRejectedValueOnce(new Error('Editor launcher failed'))
    document.body.innerHTML = `<!--shopify-devtools:start:${marker}--><section id="shopify-section-hero"></section><!--shopify-devtools:end:${marker}-->`
    document.dispatchEvent(new Event('shopify:section:load'))
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    ;(shadow?.querySelector('#tree button') as HTMLButtonElement).click()
    ;(shadow?.querySelector('#details button') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(shadow?.querySelector('#toast')?.textContent).toContain('Editor launcher failed'))
  })
})

describe('theme', () => {
  it('follows the Vite DevTools theme instead of the OS preference', async () => {
    const { resolveTheme, ShopifyDevtools } = await import('../src/client.js')
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) })
    const dark = document.createElement('div'); dark.className = 'dark'
    const light = document.createElement('div'); light.className = 'light'
    expect(resolveTheme(light, true)).toBe('light')
    expect(resolveTheme(dark, false)).toBe('dark')
    localStorage.setItem('devframes-color-scheme', 'light')
    expect(resolveTheme(null, true)).toBe('light')
    localStorage.setItem('devframes-color-scheme', 'auto')
    expect(resolveTheme(null, true)).toBe('dark')
    localStorage.removeItem('devframes-color-scheme')

    const host = new ShopifyDevtools()
    light.append(host)
    document.body.append(light)
    expect(host.dataset.theme).toBe('light')
    light.className = 'dark'
    await new Promise((resolve) => setTimeout(resolve))
    expect(host.dataset.theme).toBe('dark')
    light.remove()
    vi.unstubAllGlobals()
  })
})

describe('pages without markers', () => {
  it('lists the sections Shopify renders when the theme is not instrumented', async () => {
    rpcCall.mockClear()
    rpcCall.mockImplementation(async (name: string, input: unknown) => name === 'shopify-devtools:resolve-sections'
      ? { 'shopify-section-template--1__hero': { file: 'sections/hero.liquid', line: 1, kind: 'section' } }
      : { ok: true, input })
    document.body.innerHTML = '<div id="shopify-section-template--1__hero" class="shopify-section">Hero</div><div id="shopify-section-unknown">Other</div>'
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    await vi.waitFor(() => expect(shadow?.querySelector('#tree .tree-empty')?.textContent ?? '').toContain('inferred from your theme source'))
    expect(shadow?.querySelectorAll('#tree button')).toHaveLength(1)
    expect(shadow?.querySelector('#tree')?.textContent).toContain('hero.liquid')
    expect(rpcCall).toHaveBeenCalledWith('shopify-devtools:resolve-sections', expect.objectContaining({ ids: expect.arrayContaining(['shopify-section-template--1__hero']) }))
  })

  it('shows inferred block settings and opens the owning JSON at its key', async () => {
    rpcCall.mockClear()
    rpcCall.mockImplementation(async (name: string) => name === 'shopify-devtools:resolve-sections'
      ? {
          'shopify-section-template--9__settings': {
            file: 'sections/settings-demo.liquid', line: 1, kind: 'section', origin: 'template', instanceKey: 'settings',
            tree: [{
              kind: 'block', file: 'blocks/text.liquid', line: 1, label: 'text', roots: [{ tag: 'p', classes: ['copy'], attrs: {} }], children: [],
              instances: [{ id: 'copy_a', type: 'text', settings: { heading: 'Hello', enabled: true }, sourceFile: 'templates/index.json', sourceLine: 42 }],
            }],
          },
        }
      : { ok: true })
    document.body.innerHTML = '<div id="shopify-section-template--9__settings"><p class="copy">Hello</p></div>'
    document.dispatchEvent(new Event('shopify:section:load'))
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    await vi.waitFor(() => expect(shadow?.querySelectorAll('.tree-item')).toHaveLength(2))
    ;(shadow?.querySelectorAll('.tree-item')[1] as HTMLButtonElement).click()
    expect(shadow?.querySelector('.settings')?.textContent).toContain('"heading": "Hello"')
    ;(shadow?.querySelector('.open-source') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(rpcCall).toHaveBeenCalledWith('shopify-devtools:open-in-editor', { file: 'templates/index.json', line: 42 }))
  })

  it('says so when the page has no sections at all', async () => {
    document.body.innerHTML = '<main>Plain page</main>'
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    await vi.waitFor(() => expect(shadow?.querySelector('#tree .tree-empty')?.textContent).toContain('No Liquid sections found'))
    expect(shadow?.querySelectorAll('#tree button')).toHaveLength(0)
  })
})
