import { realpath } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import shopifyDevtools, { devtoolsConfigWarning, resolveEntrypoints, resolveThemeRoot, shopifyDevtoolsBranding, shopifyDevtoolsConfig } from '../src/index.js'
import { INSPECT_ICON } from '../src/inspect-icon.js'

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

  it('auto-detects script entrypoints from the resolved build input', () => {
    expect(resolveEntrypoints('/theme', { rollupOptions: { input: ['/theme/frontend/entrypoints/ts/theme.ts', '/theme/frontend/entrypoints/css/app.css'] } }))
      .toEqual(['/theme/frontend/entrypoints/ts/theme.ts'])
    expect(resolveEntrypoints('/theme', { rollupOptions: { input: { a: 'frontend/a.js' } } })).toEqual(['/theme/frontend/a.js'])
    expect(resolveEntrypoints('/theme', undefined)).toEqual([])

    const plugin = shopifyDevtools()
    ;(plugin.configResolved as (config: unknown) => void)({
      command: 'serve',
      root: '/theme',
      build: { rollupOptions: { input: ['/theme/frontend/entrypoints/ts/theme.ts', '/theme/frontend/entrypoints/ts/product.ts'] } },
    })
    const transform = plugin.transform as (code: string, id: string) => { code: string } | undefined
    expect(transform('x', '/theme/frontend/entrypoints/ts/product.ts?t=1')?.code).toContain("import 'virtual:shopify-devtools/client'")
    expect(transform('x', '/theme/frontend/other.ts')).toBeUndefined()
  })

  it('warns when the devtools config is missing or not the Shopify preset', () => {
    expect(devtoolsConfigWarning(false)).toContain('shopifyDevtoolsConfig')
    expect(devtoolsConfigWarning({ builtinDevTools: true, branding: shopifyDevtoolsBranding })).toContain('builtinDevTools: false')
    expect(devtoolsConfigWarning({ ...shopifyDevtoolsConfig })).toBeUndefined()
  })

  it('derives the theme root from the vite-plugin-shopify outDir', () => {
    expect(resolveThemeRoot({ root: '/project', build: { outDir: '/project/theme/assets' } })).toBe('/project/theme')
    expect(resolveThemeRoot({ root: '/project', build: { outDir: 'assets' } })).toBe('/project')
    expect(resolveThemeRoot({ root: '/project', build: { outDir: 'dist' } })).toBe('/project')
  })

  it('adds configured Shopify origins to Vite CORS for the embedded bootstrap', () => {
    const plugin = shopifyDevtools({ allowedOrigins: ['https://shop.example'] })
    const config = (plugin.config as (c: object, e: object) => { server: { cors: { origin: unknown[] } } })({ root: process.cwd() }, { mode: 'development', command: 'serve' })
    expect(config.server.cors.origin).toContain('https://shop.example')
    expect(config.server.cors.origin).toContain('http://127.0.0.1:9292')
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
      icon: INSPECT_ICON,
      action: expect.objectContaining({ importFrom: '/@id/__x00__virtual:shopify-devtools/action' }),
    }))
    expect(rpcRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'shopify-devtools:open-in-editor', type: 'action' }))
    expect(shopifyDevtoolsBranding.logo.light).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(shopifyDevtoolsBranding.logo.dark).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(decodeURIComponent(atob(shopifyDevtoolsBranding.logo.light.split(',')[1]))).toContain('#95BF47')
    expect(decodeURIComponent(INSPECT_ICON.light)).toContain('stroke="black"')
    expect(decodeURIComponent(INSPECT_ICON.dark)).toContain('stroke="white"')
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
