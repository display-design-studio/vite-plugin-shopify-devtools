// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const section = { id: 'section:hero', kind: 'section', file: 'sections/hero.liquid', line: 1 }
const marker = btoa(JSON.stringify(section))
let client: typeof import('../src/client.js')

beforeAll(async () => {
  globalThis.__SHOPIFY_DEVTOOLS_CONFIG__ = { token: 'session-token', endpoint: '/__shopify-devtools/open' }
  globalThis.fetch = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  document.body.innerHTML = `<!--shopify-devtools:start:${marker}--><section id="shopify-section-hero" class="hero">Hello</section><!--shopify-devtools:end:${marker}-->`
  client = await import('../src/client.js')
})

afterAll(() => document.querySelector('shopify-liquid-devtools')?.remove())

describe('browser panel', () => {
  it('mounts in Shadow DOM and renders the Liquid tree', () => {
    const host = document.querySelector('shopify-liquid-devtools')
    expect(host?.shadowRoot).toBeTruthy()
    expect(host?.shadowRoot?.querySelector('#toolbar')).toBeTruthy()
    expect(host?.shadowRoot?.querySelector('#inspect')?.getAttribute('aria-pressed')).toBe('false')
    expect(host?.shadowRoot?.textContent).toContain('hero.liquid')
  })

  it('synchronizes tree selection and sends authenticated open-editor requests', async () => {
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    ;(shadow?.querySelector('#tree button') as HTMLButtonElement).click()
    expect(shadow?.querySelector('#details')?.textContent).toContain('sections/hero.liquid')
    expect(shadow?.querySelector('#details')?.textContent).toContain('Line1')
    ;(shadow?.querySelector('#details button') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/__shopify-devtools/open', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer session-token' }),
    })))
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

  it('shows a useful error when the editor endpoint returns an empty body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 502 }))
    document.body.innerHTML = `<!--shopify-devtools:start:${marker}--><section id="shopify-section-hero"></section><!--shopify-devtools:end:${marker}-->`
    document.dispatchEvent(new Event('shopify:section:load'))
    const shadow = document.querySelector('shopify-liquid-devtools')?.shadowRoot
    ;(shadow?.querySelector('#tree button') as HTMLButtonElement).click()
    ;(shadow?.querySelector('#details button') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(shadow?.querySelector('#toast')?.textContent).toContain('empty response'))
  })
})
