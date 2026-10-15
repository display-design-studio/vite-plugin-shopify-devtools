import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { initProject, patchGitignore, patchViteConfig } from '../src/init.js'

const base = `import { defineConfig } from 'vite'
import shopify from '@display-studio/vite-plugin-shopify-theme'

export default defineConfig({
  plugins: [shopify({ entries: { 'theme.ts': 'a.ts' } })],
})
`

describe('init', () => {
  it('adds the import, preset and plugin', () => {
    const { source, changed } = patchViteConfig(base)
    expect(changed).toBe(true)
    expect(source).toContain("import shopifyDevtools, { shopifyDevtoolsConfig } from '@display-studio/vite-plugin-shopify-devtools'")
    expect(source).toContain('devtools: shopifyDevtoolsConfig,')
    expect(source).toMatch(/shopify\(\{[^\]]*\}\), shopifyDevtools\(\)\]/)
    expect(source.indexOf('vite-plugin-shopify-devtools')).toBeGreaterThan(source.indexOf('vite-plugin-shopify-theme'))
  })

  it('is idempotent', () => {
    const once = patchViteConfig(base).source
    expect(patchViteConfig(once)).toEqual({ source: once, changed: false })
  })

  it('handles an empty plugins array and a trailing comma', () => {
    expect(patchViteConfig("import x from 'x'\nexport default defineConfig({ plugins: [] })").source).toContain('plugins: [shopifyDevtools()]')
    expect(patchViteConfig("import x from 'x'\nexport default defineConfig({ plugins: [a(),] })").source).toContain('[a(),shopifyDevtools()]')
  })

  it('reports configs it cannot patch', () => {
    expect(patchViteConfig('export default defineConfig(({ mode }) => ({ plugins: [] }))').manual).toBeTruthy()
    expect(patchViteConfig('export default defineConfig({ build: {} })').manual).toContain('plugins')
  })

  it('appends to .gitignore once', () => {
    const first = patchGitignore('node_modules')
    expect(first.source).toBe('node_modules\n\n# Shopify DevTools instrumented theme mirror\n.shopify-devtools/\n')
    expect(patchGitignore(first.source).changed).toBe(false)
  })

  it('patches files on disk', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'devtools-init-'))
    writeFileSync(path.join(root, 'vite.config.ts'), base)
    expect(initProject(root)).toMatchObject({ configChanged: true, gitignoreChanged: true })
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('.shopify-devtools/')
    expect(initProject(root)).toMatchObject({ configChanged: false, gitignoreChanged: false })
    expect(initProject(mkdtempSync(path.join(tmpdir(), 'devtools-empty-'))).manual).toContain('No vite.config')
  })
})
