import { mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchEditor, resolveAllowedOrigins, resolveThemeFile } from '../src/index.js'

describe('open-editor security', () => {
  it('rejects traversal and symlinks outside the theme root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'theme-root-'))
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.liquid`)
    await writeFile(outside, 'secret')
    await symlink(outside, path.join(root, 'escape.liquid'))
    await expect(resolveThemeFile(root, '../outside.liquid')).rejects.toThrow()
    await expect(resolveThemeFile(root, 'escape.liquid')).rejects.toThrow('outside')
  })

  it('allows the Shopify CLI preview, myshopify.com, the configured store, and extras only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'theme-origins-'))
    await writeFile(path.join(root, 'shopify.theme.toml'), '[environments.development]\nstore = "toml-shop.myshopify.com"\n')
    const origins = resolveAllowedOrigins(root, { SHOPIFY_STORE_DOMAIN: 'env-shop.myshopify.com' }, ['https://tunnel.example'])
    expect(origins).toEqual(expect.arrayContaining([
      'http://127.0.0.1:9292', 'http://localhost:9292',
      'https://env-shop.myshopify.com', 'https://toml-shop.myshopify.com', 'https://tunnel.example',
    ]))
    const regexes = origins.filter((origin): origin is RegExp => origin instanceof RegExp)
    const allowed = (origin: string): boolean => regexes.some((regex) => regex.test(origin))
    expect(allowed('https://any-shop.myshopify.com')).toBe(true)
    expect(allowed('https://evil.example')).toBe(false)
    expect(allowed('https://myshopify.com.evil.example')).toBe(false)
    expect(resolveAllowedOrigins(await mkdtemp(path.join(os.tmpdir(), 'theme-origins-')), {})).not.toContain('https://undefined')
  })

  it('reports launcher failures instead of returning a false success', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'theme-editor-'))
    await writeFile(path.join(root, 'section.liquid'), '<section></section>')
    await expect(launchEditor(root, 'section.liquid', 1, 'definitely-not-an-editor-command')).rejects.toThrow()
  })

  it('passes an existing source file and position to a configured launcher', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'theme-editor-'))
    await writeFile(path.join(root, 'section.liquid'), '<section></section>')
    await expect(launchEditor(root, 'section.liquid', 1, 'true')).resolves.toBe(await realpath(path.join(root, 'section.liquid')))
  })
})
