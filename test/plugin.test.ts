import { describe, expect, it } from 'vitest'
import shopifyDevtools from '../src/index.js'

describe('Vite plugin', () => {
  it('only applies during serve and injects the client into the configured entry', () => {
    const plugin = shopifyDevtools({ entry: 'frontend/theme.ts' })
    expect(plugin.apply).toBe('serve')
    const resolved = plugin.resolveId as (id: string) => unknown
    expect(resolved('virtual:shopify-devtools/client')).toBe('\0virtual:shopify-devtools/client')
    const load = plugin.load as (id: string) => string
    const virtualModule = load('\0virtual:shopify-devtools/client')
    expect(virtualModule.indexOf('__SHOPIFY_DEVTOOLS_CONFIG__')).toBeLessThan(virtualModule.indexOf('await import'))
    expect(virtualModule).toContain("new URL(import.meta.url).origin+'/__shopify-devtools/open'")
  })
})
