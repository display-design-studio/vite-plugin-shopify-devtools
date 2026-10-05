import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import shopifyDevtools, { absoluteDockUrl, devtoolsConfigWarning, resolveEntrypoints, resolveThemeRoot, shopifyDevtoolsBranding, shopifyDevtoolsConfig, viteOrigin, viteVersionWarning } from '../src/index.js'
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
    expect(virtualModule).toContain('devframes-dock-embedded')
    expect(virtualModule).toContain('--devframes-dock-minimized-size:var(--devframes-dock-height,34px);border-radius:.5rem}')
    expect(virtualModule).toContain('#devframes-dock>div:first-child{width:20px;height:20px}')
    expect(virtualModule).toContain('.bg-dock-glass,#devframes-anchor #devframes-dock{background-color:#fff;backdrop-filter:none}')
    expect(virtualModule).toContain('.dark .bg-dock-glass,.dark #devframes-anchor #devframes-dock{background-color:#111}')
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

  it('fails clearly when no JavaScript entry can receive the client', async () => {
    const plugin = shopifyDevtools()
    await expect((plugin.configResolved as (config: unknown) => Promise<void>)({
      command: 'serve', root: '/theme', build: { rollupOptions: { input: ['/theme/assets/theme.css'] } }, logger: { warn: vi.fn(), info: vi.fn() },
    })).rejects.toThrow('No JavaScript entry was found')
  })

  it('generates a client module that is valid JavaScript', () => {
    const code = (shopifyDevtools().load as (id: string) => string)('\0virtual:shopify-devtools/client')
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (body: string) => unknown
    expect(() => new AsyncFunction(code.replace('import.meta.url', "'http://localhost:5173/client.js'").replace('import(/* @vite-ignore */devtoolsClient)', 'import(devtoolsClient)'))).not.toThrow()
  })

  it('warns when the devtools config is missing or not the Shopify preset', () => {
    expect(devtoolsConfigWarning(false)).toContain('shopifyDevtoolsConfig')
    expect(devtoolsConfigWarning({ builtinDevTools: true, branding: shopifyDevtoolsBranding })).toContain('builtinDevTools: false')
    expect(devtoolsConfigWarning({ ...shopifyDevtoolsConfig })).toBeUndefined()
  })

  it('accepts the preset after Vite deep-clones it', () => {
    expect(devtoolsConfigWarning(structuredClone(shopifyDevtoolsConfig))).toBeUndefined()
  })

  it('reads the preset from the shape Vite resolves it to', () => {
    const resolved = { enabled: true, apply: 'serve', config: structuredClone(shopifyDevtoolsConfig) }
    expect(devtoolsConfigWarning(resolved)).toBeUndefined()
    expect(devtoolsConfigWarning({ ...resolved, config: { ...resolved.config, builtinDevTools: true } })).toContain('builtinDevTools: false')
    expect(devtoolsConfigWarning({ enabled: false, config: {} })).toContain('disabled')
  })

  it('warns when the installed Vite does not support the devtools option', () => {
    expect(viteVersionWarning('7.1.7')).toContain('requires Vite 8.3')
    expect(viteVersionWarning('8.2.9')).toContain('Vite 8.2.9 is installed')
    expect(viteVersionWarning('8.3.0')).toBeUndefined()
    expect(viteVersionWarning('8.3.2')).toBeUndefined()
    expect(viteVersionWarning('9.0.0')).toBeUndefined()
  })

  it('turns root-relative iframe dock urls into urls on the Vite server', () => {
    expect(absoluteDockUrl({ id: 'vue', type: 'iframe', url: '/__devtools__/' }, 'http://localhost:5173/')).toBe('http://localhost:5173/__devtools__/')
    expect(absoluteDockUrl({ id: 'vue', type: 'iframe', url: '/__devtools__/' }, 'https://tunnel.example')).toBe('https://tunnel.example/__devtools__/')
    expect(absoluteDockUrl({ id: 'a', type: 'iframe', url: 'http://localhost:5173/x' }, 'http://localhost:5173')).toBeUndefined()
    expect(absoluteDockUrl({ id: 'b', type: 'iframe', url: '//cdn.example/x' }, 'http://localhost:5173')).toBeUndefined()
    expect(absoluteDockUrl({ id: 'c', type: 'action', url: '/x' }, 'http://localhost:5173')).toBeUndefined()
    expect(absoluteDockUrl({ id: 'd', type: 'iframe' }, 'http://localhost:5173')).toBeUndefined()
  })

  it('prefers the configured public origin over where Vite listens', () => {
    const resolvedUrls = { local: ['http://localhost:5173/'], network: [] }
    expect(viteOrigin({ config: { server: {} }, resolvedUrls } as never)).toBe('http://localhost:5173/')
    expect(viteOrigin({ config: { server: { origin: 'https://tunnel.example' } }, resolvedUrls } as never)).toBe('https://tunnel.example')
    expect(viteOrigin({ config: { server: {} }, resolvedUrls: null } as never)).toBeUndefined()
  })

  it('fixes iframe docks other plugins registered, now and later, and leaves everything else alone', async () => {
    const plugin = shopifyDevtools()
    const views = new Map<string, { id: string; type: string; url?: string }>([
      ['vue', { id: 'vue', type: 'iframe', url: '/__devtools__/' }],
      ['abs', { id: 'abs', type: 'iframe', url: 'http://localhost:5173/own/' }],
      ['act', { id: 'act', type: 'action' }],
    ])
    const update = vi.fn()
    let onUpdated: ((entry: { id: string; type: string; url?: string }) => void) | undefined
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn(), views, update, events: { on: (_event: string, handler: typeof onUpdated) => { onUpdated = handler } } },
      rpc: { register: vi.fn() },
      viteConfig: { root: process.cwd() },
    } as never)
    expect(update).not.toHaveBeenCalled()

    let listening: (() => void) | undefined
    ;(plugin.configureServer as (server: unknown) => void)({
      config: { logger: { warn: vi.fn() }, server: {}, devtools: undefined },
      resolvedUrls: { local: ['http://localhost:5173/'], network: [] },
      httpServer: { listening: false, once: (_event: string, handler: () => void) => { listening = handler } },
    })
    listening?.()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ id: 'vue', type: 'iframe', url: 'http://localhost:5173/__devtools__/' })

    onUpdated?.({ id: 'late', type: 'iframe', url: '/late/' })
    expect(update).toHaveBeenLastCalledWith({ id: 'late', type: 'iframe', url: 'http://localhost:5173/late/' })
    onUpdated?.({ id: 'vue', type: 'iframe', url: 'http://localhost:5173/__devtools__/' })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('broadcasts cache invalidation only for section-resolution theme sources', async () => {
    const plugin = shopifyDevtools()
    const broadcast = vi.fn()
    await plugin.devtools?.setup?.({ docks: { register: vi.fn() }, rpc: { register: vi.fn(), broadcast }, viteConfig: { root: '/theme' } } as never)
    const handlers = new Map<string, (file: string) => void>()
    ;(plugin.configureServer as (server: unknown) => void)({
      config: { root: '/theme', build: { outDir: 'assets' }, logger: { warn: vi.fn() }, server: {}, devtools: shopifyDevtoolsConfig },
      resolvedUrls: { local: ['http://localhost:5173/'], network: [] },
      httpServer: { listening: true },
      watcher: { on: (event: string, handler: (file: string) => void) => { handlers.set(event, handler) } },
    })
    for (const file of ['/theme/templates/index.json', '/theme/templates/customers/account.json', '/theme/sections/header-group.json', '/theme/sections/hero.liquid', '/theme/blocks/text.liquid', '/theme/snippets/card.liquid']) handlers.get('change')?.(file)
    handlers.get('add')?.('/theme/templates/new.json')
    handlers.get('unlink')?.('/theme/snippets/old.liquid')
    handlers.get('change')?.('/theme/assets/theme.js')
    handlers.get('change')?.('/other/templates/index.json')
    expect(broadcast).toHaveBeenCalledTimes(8)
    expect(broadcast).toHaveBeenLastCalledWith({ method: 'shopify-devtools:sources-changed', args: [], optional: true })
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
    expect(rpcRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'shopify-devtools:resolve-sections', type: 'action' }))
    expect(shopifyDevtoolsBranding.logo.light).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(shopifyDevtoolsBranding.logo.dark).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(decodeURIComponent(atob(shopifyDevtoolsBranding.logo.light.split(',')[1]))).toContain('#4AC93E')
    expect(decodeURIComponent(INSPECT_ICON.light)).toContain('fill="black"')
    expect(decodeURIComponent(INSPECT_ICON.dark)).toContain('fill="white"')
  })

  it('rejects an invalid editor RPC payload before launching an editor', async () => {
    const plugin = shopifyDevtools()
    let definition: { name?: string; setup: () => { handler: (input: unknown) => Promise<unknown> } } | undefined
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn() },
      rpc: { register: (value: typeof definition) => { if (value?.name === 'shopify-devtools:open-in-editor') definition = value } },
      viteConfig: { root: process.cwd() },
    } as never)
    const handler = definition?.setup().handler
    await expect(handler?.({ file: 'sections/hero.liquid', line: 0 })).rejects.toThrow('Invalid payload')
    await expect(handler?.({ file: '../outside.liquid', line: 1 })).rejects.toThrow()
  })

  it('resolves rendered sections to theme files through RPC', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devtools-rpc-'))
    await mkdir(path.join(root, 'sections'))
    await writeFile(path.join(root, 'sections', 'feed-artists.liquid'), '<div></div>')
    const plugin = shopifyDevtools()
    let definition: { name?: string; setup: () => { handler: (input: unknown) => Promise<unknown> } } | undefined
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn() },
      rpc: { register: (value: typeof definition) => { if (value?.name === 'shopify-devtools:resolve-sections') definition = value } },
      viteConfig: { root, build: { outDir: 'assets' } },
    } as never)
    expect(await definition?.setup().handler({ ids: ['shopify-section-feed-artists'] })).toMatchObject({ 'shopify-section-feed-artists': { file: 'sections/feed-artists.liquid', line: 1, kind: 'section' } })
  })

  it('opens a validated file through the configured plugin launcher', async () => {
    const plugin = shopifyDevtools({ editor: 'true' })
    let definition: { name?: string; setup: () => { handler: (input: { file: string; line: number }) => Promise<unknown> } } | undefined
    const invokeLocal = vi.fn(async () => undefined)
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn() },
      rpc: { register: (value: typeof definition) => { if (value?.name === 'shopify-devtools:open-in-editor') definition = value }, invokeLocal },
      viteConfig: { root: process.cwd() },
    } as never)
    const result = await definition?.setup().handler({ file: 'package.json', line: 2 })
    expect(invokeLocal).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, file: await realpath(`${process.cwd()}/package.json`), line: 2 })
  })

  it('propagates configured launcher failures through RPC', async () => {
    const plugin = shopifyDevtools({ editor: 'definitely-not-an-editor-command' })
    let definition: { name?: string; setup: () => { handler: (input: { file: string; line: number }) => Promise<unknown> } } | undefined
    const invokeLocal = vi.fn(async () => undefined)
    await plugin.devtools?.setup?.({
      docks: { register: vi.fn() },
      rpc: { register: (value: typeof definition) => { if (value?.name === 'shopify-devtools:open-in-editor') definition = value }, invokeLocal },
      viteConfig: { root: process.cwd() },
    } as never)
    await expect(definition?.setup().handler({ file: 'package.json', line: 2 })).rejects.toThrow()
    expect(invokeLocal).not.toHaveBeenCalled()
  })
})
