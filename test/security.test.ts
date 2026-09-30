import { mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAllowedOrigin, launchEditor, resolveThemeFile } from '../src/index.js'

describe('open-editor security', () => {
  it('rejects traversal and symlinks outside the theme root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'theme-root-'))
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.liquid`)
    await writeFile(outside, 'secret')
    await symlink(outside, path.join(root, 'escape.liquid'))
    await expect(resolveThemeFile(root, '../outside.liquid')).rejects.toThrow()
    await expect(resolveThemeFile(root, 'escape.liquid')).rejects.toThrow('outside')
  })

  it('allows only configured, local, store, or server origins', () => {
    const server = { config: { server: { host: 'vite.example.test' } } } as never
    expect(isAllowedOrigin(undefined, server, [])).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:9292', server, [])).toBe(true)
    expect(isAllowedOrigin('https://preview.example', server, ['https://preview.example'])).toBe(true)
    expect(isAllowedOrigin('https://evil.example', server, [])).toBe(false)
    expect(isAllowedOrigin('not a url', server, [])).toBe(false)
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
