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
    await writeFile(sourceFile, '<h1>Hello</h1>')
    const before = crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')
    const mirror = await createThemeMirror(theme); mirrors.push(mirror)
    expect(await readFile(path.join(mirror.root, 'sections', 'hero.liquid'), 'utf8')).toContain('shopify-devtools:start:')
    expect(crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')).toBe(before)
    await writeFile(sourceFile, '<h1>Changed</h1>'); await pause()
    expect(await readFile(path.join(mirror.root, 'sections', 'hero.liquid'), 'utf8')).toContain('Changed')
    expect(crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')).not.toBe(before)
    const changed = crypto.createHash('sha256').update(await readFile(sourceFile)).digest('hex')
    expect(changed).toBe(crypto.createHash('sha256').update('<h1>Changed</h1>').digest('hex'))
    await rm(sourceFile); await pause()
    await expect(stat(path.join(mirror.root, 'sections', 'hero.liquid'))).rejects.toMatchObject({ code: 'ENOENT' })
    await mirror.close(); mirrors.pop()
    await expect(stat(mirror.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
