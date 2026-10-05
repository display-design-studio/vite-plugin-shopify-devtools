import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createThemeMirror } from '../src/mirror.js'

const mirrors: Array<{ close(): Promise<void> }> = []
const pause = () => new Promise((resolve) => setTimeout(resolve, 1_200))

describe('theme mirror', () => {
  afterEach(async () => { await Promise.all(mirrors.splice(0).map((mirror) => mirror.close())) })

  it('instruments copies, syncs changes/deletes, and never mutates sources', async () => {
    const theme = await mkdtemp(path.join(os.tmpdir(), 'devtools-theme-'))
    await mkdir(path.join(theme, 'sections'))
    const sourceFile = path.join(theme, 'sections', 'hero.liquid')
    const environmentFile = path.join(theme, 'shopify.theme.toml')
    await writeFile(sourceFile, '<h1>Hello</h1>')
    await writeFile(environmentFile, '[environments.development]\nstore = "display-xxx.myshopify.com"\n')
    const before = crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')
    const mirror = await createThemeMirror(theme); mirrors.push(mirror)
    expect(await readFile(path.join(mirror.root, 'sections', 'hero.liquid'), 'utf8')).toContain('shopify-devtools:start:')
    expect(await readFile(path.join(mirror.root, 'shopify.theme.toml'), 'utf8')).toContain('[environments.development]')
    expect(crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')).toBe(before)
    await writeFile(sourceFile, '<h1>Changed</h1>'); await pause()
    expect(await readFile(path.join(mirror.root, 'sections', 'hero.liquid'), 'utf8')).toContain('Changed')
    expect(crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')).not.toBe(before)
    const changed = crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')
    expect(changed).toBe(crypto.createHash('sha256').update('<h1>Changed</h1>').digest('hex'))
    await writeFile(environmentFile, '[environments.preview]\nstore = "preview.myshopify.com"\n'); await pause()
    expect(await readFile(path.join(mirror.root, 'shopify.theme.toml'), 'utf8')).toContain('[environments.preview]')
    await rm(sourceFile); await pause()
    await expect(stat(path.join(mirror.root, 'sections', 'hero.liquid'))).rejects.toMatchObject({ code: 'ENOENT' })
    await mirror.close(); mirrors.pop()
    await expect(stat(mirror.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('respects .shopifyignore and can keep a deterministic plugin-managed mirror', async () => {
    const theme = await mkdtemp(path.join(os.tmpdir(), 'devtools-theme-'))
    const output = path.join(theme, '.shopify-devtools', 'theme')
    await mkdir(path.join(theme, 'assets'), { recursive: true })
    await mkdir(path.join(theme, 'listings'), { recursive: true })
    await writeFile(path.join(theme, '.shopifyignore'), 'assets/*.map\n')
    await writeFile(path.join(theme, 'assets', 'theme.js'), 'ok')
    await writeFile(path.join(theme, 'assets', 'theme.js.map'), 'ignored')
    await writeFile(path.join(theme, 'listings', 'default.json'), '{}')
    const mirror = await createThemeMirror(theme, { root: output, keep: true }); mirrors.push(mirror)
    expect(await readFile(path.join(output, 'assets', 'theme.js'), 'utf8')).toBe('ok')
    await expect(stat(path.join(output, 'assets', 'theme.js.map'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(output, 'listings', 'default.json'), 'utf8')).toBe('{}')
    await mirror.close(); mirrors.pop()
    expect((await stat(output)).isDirectory()).toBe(true)
    await rm(theme, { recursive: true, force: true })
  })
})
