// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import setupInspectorAction from '../src/action.js'
import { getInspectorController } from '../src/inspector.js'

const source = { id: 'section:hero', kind: 'section', file: 'sections/hero.liquid', line: 4 }
const marker = btoa(JSON.stringify(source))

describe('inspector dock action', () => {
  beforeEach(() => {
    getInspectorController().deactivate()
    document.body.innerHTML = `<!--shopify-devtools:start:${marker}--><section id="shopify-section-hero">Hero</section><!--shopify-devtools:end:${marker}-->`
  })

  it('opens the selected component and deactivates after the IDE opens', async () => {
    const handlers = new Map<string, () => void>()
    const call = vi.fn(async () => ({ ok: true }))
    setupInspectorAction({
      rpc: { call },
      current: { events: { on: (name: string, handler: () => void) => handlers.set(name, handler) } },
    } as never)

    handlers.get('entry:activated')?.()
    expect(document.documentElement.style.cursor).toBe('crosshair')

    const target = document.querySelector('section') as HTMLElement
    target.getBoundingClientRect = () => ({ x: 1, y: 2, left: 1, top: 2, right: 101, bottom: 52, width: 100, height: 50, toJSON: () => ({}) })
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
    const highlight = document.querySelector<HTMLElement>('[data-shopify-devtools-highlight]')
    expect(highlight?.style.borderColor).toBe('rgb(74, 201, 62)')
    expect(document.querySelector('[data-shopify-devtools-source]')?.textContent).toBe('<section> sections/hero.liquid:4')

    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('shopify-devtools:open-in-editor', { file: source.file, line: source.line }))
    expect(getInspectorController().selected?.file).toBe(source.file)
    await vi.waitFor(() => expect(getInspectorController().active).toBe(false))
    expect(document.documentElement.style.cursor).toBe('')
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeNull()
    expect(document.querySelector('[data-shopify-devtools-highlights]')).toBeNull()
  })

  it('stays active when opening the IDE fails', async () => {
    const call = vi.fn(async () => { throw new Error('Editor unavailable') })
    setupInspectorAction({
      rpc: { call },
      current: { isActive: true, events: { on: vi.fn() } },
    } as never)

    const target = document.querySelector('section') as HTMLElement
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
    expect(getInspectorController().active).toBe(true)
  })

  it('opens on pointerdown before the dock can deactivate the action', async () => {
    const handlers = new Map<string, () => void>()
    const call = vi.fn(async () => ({ ok: true }))
    setupInspectorAction({
      rpc: { call },
      current: { events: { on: (name: string, handler: () => void) => handlers.set(name, handler) } },
    } as never)
    handlers.get('entry:activated')?.()

    const target = document.querySelector('section') as HTMLElement
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 8, clientY: 9 })
    target.dispatchEvent(pointerDown)
    handlers.get('entry:deactivated')?.()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 8, clientY: 9 })
    target.dispatchEvent(click)

    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
    expect(call).toHaveBeenCalledWith('shopify-devtools:open-in-editor', { file: source.file, line: source.line })
    expect(pointerDown.defaultPrevented).toBe(true)
    expect(click.defaultPrevented).toBe(true)
  })

  it('clears unrelated targets and refreshes overlay geometry on viewport changes', () => {
    setupInspectorAction({
      rpc: { call: vi.fn(async () => ({ ok: true })) },
      current: { isActive: true, events: { on: vi.fn() } },
    } as never)

    const target = document.querySelector('section') as HTMLElement
    let top = 20
    target.getBoundingClientRect = () => ({ x: 10, y: top, left: 10, top, right: 110, bottom: top + 50, width: 100, height: 50, toJSON: () => ({}) })
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    expect(document.querySelector<HTMLElement>('[data-shopify-devtools-highlight]')?.style.top).toBe('20px')

    top = 40
    dispatchEvent(new Event('scroll'))
    expect(document.querySelector<HTMLElement>('[data-shopify-devtools-highlight]')?.style.top).toBe('40px')

    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeNull()
  })

  it('activates when the runtime initializes the script after the first activation event', () => {
    const call = vi.fn(async () => ({ ok: true }))
    setupInspectorAction({
      rpc: { call },
      current: { isActive: true, events: { on: vi.fn() } },
    } as never)

    expect(getInspectorController().active).toBe(true)
    expect(document.documentElement.style.cursor).toBe('crosshair')
  })

  it('deactivates on DevTools pointer interaction without intercepting the control', () => {
    const call = vi.fn(async () => ({ ok: true }))
    setupInspectorAction({
      rpc: { call },
      current: { events: { on: vi.fn() } },
    } as never)

    const section = document.querySelector('section') as HTMLElement
    const dock = document.createElement('devframes-dock-embedded')
    const shadow = dock.attachShadow({ mode: 'open' })
    const settings = document.createElement('devframes-settings-panel')
    const advanced = document.createElement('button')
    advanced.textContent = 'Advanced'
    settings.append(advanced)
    shadow.append(settings)
    section.append(dock)

    const bubbled = vi.fn()
    section.addEventListener('click', bubbled)
    const selectedBefore = getInspectorController().selected
    getInspectorController().activate()

    section.getBoundingClientRect = () => ({ x: 1, y: 2, left: 1, top: 2, right: 101, bottom: 52, width: 100, height: 50, toJSON: () => ({}) })
    section.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeTruthy()

    advanced.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, composed: true }))
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeNull()
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, composed: true })
    advanced.dispatchEvent(pointerDown)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    advanced.dispatchEvent(click)

    expect(pointerDown.defaultPrevented).toBe(false)
    expect(click.defaultPrevented).toBe(false)
    expect(bubbled).toHaveBeenCalledOnce()
    expect(getInspectorController().selected).toBe(selectedBefore)
    expect(getInspectorController().active).toBe(false)
    expect(document.documentElement.style.cursor).toBe('')
    expect(document.querySelector('[data-shopify-devtools-highlights]')).toBeNull()
    expect(call).not.toHaveBeenCalled()
  })

  it('deactivates when focus enters DevTools without changing the focus event', () => {
    setupInspectorAction({
      rpc: { call: vi.fn(async () => ({ ok: true })) },
      current: { events: { on: vi.fn() } },
    } as never)

    const dock = document.createElement('devframes-dock-embedded')
    const shadow = dock.attachShadow({ mode: 'open' })
    const settings = document.createElement('button')
    shadow.append(settings)
    document.body.append(dock)
    getInspectorController().activate()

    const focus = new FocusEvent('focusin', { bubbles: true, cancelable: true, composed: true })
    settings.dispatchEvent(focus)

    expect(focus.defaultPrevented).toBe(false)
    expect(getInspectorController().active).toBe(false)
    expect(document.documentElement.style.cursor).toBe('')
  })

  it('leaves internal inspector controls to their normal toggle handlers', () => {
    setupInspectorAction({
      rpc: { call: vi.fn(async () => ({ ok: true })) },
      current: { events: { on: vi.fn() } },
    } as never)

    const host = document.createElement('shopify-liquid-devtools')
    const shadow = host.attachShadow({ mode: 'open' })
    const inspect = document.createElement('button')
    inspect.id = 'panel-inspect'
    shadow.append(inspect)
    document.body.append(host)
    getInspectorController().activate()

    inspect.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
    inspect.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))

    expect(getInspectorController().active).toBe(true)
    expect(document.documentElement.style.cursor).toBe('crosshair')
  })

  it('deactivates when the dock changes panel or closes', () => {
    const entryHandlers = new Map<string, () => void>()
    let panelStateChanged: ((state: { state: 'open' | 'closed'; selectedDockId?: string }) => void) | undefined
    const docks = {
      entries: [{ id: 'shopify-liquid:inspect' }, { id: '~settings' }, { id: 'another-panel' }],
      getStateById: (id: string) => ({ events: { on: (name: string, handler: () => void) => entryHandlers.set(`${id}:${name}`, handler) } }),
    }
    setupInspectorAction({
      rpc: { call: vi.fn(async () => ({ ok: true })) },
      current: { events: { on: vi.fn() } },
      docks,
      panel: { events: { on: (_name: string, handler: typeof panelStateChanged) => { panelStateChanged = handler } } },
    } as never)

    getInspectorController().activate()
    entryHandlers.get('~settings:entry:activated')?.()
    expect(getInspectorController().active).toBe(false)

    getInspectorController().activate()
    panelStateChanged?.({ state: 'open', selectedDockId: 'shopify-liquid:inspect' })
    expect(getInspectorController().active).toBe(true)

    panelStateChanged?.({ state: 'closed' })
    expect(getInspectorController().active).toBe(false)
    expect(document.querySelector('[data-shopify-devtools-highlights]')).toBeNull()
  })

  it('deactivates on the next pointer move when another dock is selected, even without dock events', () => {
    const docks = { selectedId: 'shopify-liquid:inspect' as string | null, entries: [], getStateById: () => undefined }
    setupInspectorAction({
      rpc: { call: vi.fn(async () => ({ ok: true })) },
      current: { events: { on: vi.fn() } },
      docks,
      panel: { events: { on: vi.fn() } },
    } as never)
    const target = document.querySelector('section') as HTMLElement
    target.getBoundingClientRect = () => ({ x: 1, y: 2, left: 1, top: 2, right: 101, bottom: 52, width: 100, height: 50, toJSON: () => ({}) })

    for (const stay of ['shopify-liquid:inspect', 'shopify-liquid', null]) {
      docks.selectedId = stay
      getInspectorController().activate()
      target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
      expect(getInspectorController().active).toBe(true)
      expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeTruthy()
    }

    docks.selectedId = '~settings'
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
    expect(getInspectorController().active).toBe(false)
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeNull()
    getInspectorController().setNavigationGuard(() => false)
  })

  it('releases the inspect dock entry once the inspector turns itself off', async () => {
    const handlers = new Map<string, () => void>()
    const switchEntry = vi.fn()
    const current = { isActive: false, events: { on: (name: string, handler: () => void) => handlers.set(name, handler) } }
    setupInspectorAction({ rpc: { call: vi.fn(async () => ({ ok: true })) }, current, docks: { switchEntry } } as never)

    current.isActive = true
    handlers.get('entry:activated')?.()
    expect(getInspectorController().active).toBe(true)
    expect(switchEntry).not.toHaveBeenCalled()

    const target = document.querySelector('section') as HTMLElement
    target.getBoundingClientRect = () => ({ x: 1, y: 2, left: 1, top: 2, right: 101, bottom: 52, width: 100, height: 50, toJSON: () => ({}) })
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    await vi.waitFor(() => expect(getInspectorController().active).toBe(false))
    expect(switchEntry).toHaveBeenCalledWith(null)
  })
})
