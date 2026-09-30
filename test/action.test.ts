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

  it('stays active and opens every selected component through RPC until explicitly deactivated', async () => {
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
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeTruthy()

    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('shopify-devtools:open-in-editor', { file: source.file, line: source.line }))
    expect(getInspectorController().selected?.file).toBe(source.file)
    expect(getInspectorController().active).toBe(true)
    expect(document.documentElement.style.cursor).toBe('crosshair')
    expect(document.querySelector('[data-shopify-devtools-highlight]')).toBeNull()

    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2))

    handlers.get('entry:deactivated')?.()
    expect(getInspectorController().active).toBe(false)
    expect(document.documentElement.style.cursor).toBe('')
    expect(document.querySelector('[data-shopify-devtools-highlights]')).toBeNull()
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

  it('does not intercept DevTools controls across their Shadow DOM boundary', () => {
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
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    advanced.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(bubbled).toHaveBeenCalledOnce()
    expect(getInspectorController().selected).toBe(selectedBefore)
    expect(getInspectorController().active).toBe(true)
    expect(call).not.toHaveBeenCalled()
  })
})
