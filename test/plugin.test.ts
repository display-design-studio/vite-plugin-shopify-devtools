import { realpath } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import shopifyDevtools, { shopifyDevtoolsBranding } from '../src/index.js'

describe('Vite plugin', () => {
  it('only applies during serve and injects the client into the configured entry', () => {
    const plugin = shopifyDevtools({ entry: 'frontend/theme.ts' })
    expect(plugin.apply).toBe('serve')
    const resolved = plugin.resolveId as (id: string) => unknown
    expect(resolved('virtual:shopify-devtools/client')).toBe('\0virtual:shopify-devtools/client')
    expect(resolved('virtual:shopify-devtools/renderer')).toBe('\0virtual:shopify-devtools/renderer')
    const load = plugin.load as (id: string) => string
    const virtualModule = load('\0virtual:shopify-devtools/client')
    expect(virtualModule).not.toContain('__SHOPIFY_DEVTOOLS_CONFIG__')
    expect(virtualModule).not.toContain('__shopify-devtools/open')
    expect(virtualModule).not.toContain('Bearer')
    expect(virtualModule).toContain("connectionUrl=origin+'/__devtools/__connection.json'")
    expect(virtualModule).toContain('__DEVFRAME_CONNECTION__')
    expect(virtualModule).toContain("/__devtools/embedded.js")
    expect(plugin.devtools).toBeTruthy()
  })

  it('adds configured Shopify origins to Vite CORS for the embedded bootstrap', () => {
    const plugin = shopifyDevtools({ allowedOrigins: ['https://shop.example'] })
    const config = (plugin.config as () => { server: { cors: { origin: unknown[] } } })()
    expect(config.server.cors.origin).toContain('https://shop.example')
  })

  it('uses origin-safe icons for Shopify-hosted pages', async () => {
    const plugin = shopifyDevtools()
    const register = vi.fn()
    const rpcRegister = vi.fn()
    await plugin.devtools?.setup?.({ docks: { register }, rpc: { register: rpcRegister }, viteConfig: { root: process.cwd() } } as never)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: 'viteplus', visibility: 'false' }), true)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'shopify-liquid',
      type: 'custom-render',
      icon: expect.objectContaining({ light: expect.any(String), dark: expect.any(String) }),
      renderer: expect.objectContaining({ importFrom: '/@id/__x00__virtual:shopify-devtools/renderer' }),
    }))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'shopify-liquid:inspect',
      type: 'action',
      icon: 'ph:crosshair-duotone',
      action: expect.objectContaining({ importFrom: '/@id/__x00__virtual:shopify-devtools/action' }),
    }))
    expect(rpcRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'shopify-devtools:open-in-editor', type: 'action' }))
    expect(shopifyDevtoolsBranding.logo.light).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(shopifyDevtoolsBranding.logo.dark).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(shopifyDevtoolsBranding.logo.light).not.toBe(shopifyDevtoolsBranding.logo.dark)
  })

  it('rejects an invalid editor RPC payload before launching an editor', async () => {
    const plugin = shopifyDevtools()
    let definition: { setup: () => { handler: (input: unknown) => Promise<unknown> } } | undefined
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn() },
      rpc: { register: (value: typeof definition) => { definition = value } },
      viteConfig: { root: process.cwd() },
    } as never)
    const handler = definition?.setup().handler
    await expect(handler?.({ file: 'sections/hero.liquid', line: 0 })).rejects.toThrow('Invalid payload')
    await expect(handler?.({ file: '../outside.liquid', line: 1 })).rejects.toThrow()
  })

  it('opens a validated file through the configured plugin launcher', async () => {
    const plugin = shopifyDevtools({ editor: 'true' })
    let definition: { setup: () => { handler: (input: { file: string; line: number }) => Promise<unknown> } } | undefined
    const invokeLocal = vi.fn(async () => undefined)
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn() },
      rpc: { register: (value: typeof definition) => { definition = value }, invokeLocal },
      viteConfig: { root: process.cwd() },
    } as never)
    const result = await definition?.setup().handler({ file: 'package.json', line: 2 })
    expect(invokeLocal).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, file: await realpath(`${process.cwd()}/package.json`), line: 2 })
  })

  it('propagates configured launcher failures through RPC', async () => {
    const plugin = shopifyDevtools({ editor: 'definitely-not-an-editor-command' })
    let definition: { setup: () => { handler: (input: { file: string; line: number }) => Promise<unknown> } } | undefined
    const invokeLocal = vi.fn(async () => undefined)
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn() },
      rpc: { register: (value: typeof definition) => { definition = value }, invokeLocal },
      viteConfig: { root: process.cwd() },
    } as never)
    await expect(definition?.setup().handler({ file: 'package.json', line: 2 })).rejects.toThrow()
    expect(invokeLocal).not.toHaveBeenCalled()
  })
})
