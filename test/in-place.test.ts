import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { instrumentInPlace, JOURNAL_DIRECTORY, JOURNAL_FILE, recoverInPlace } from '../src/in-place.js'
import { instrumentLiquid } from '../src/instrument.js'

const pause = () => new Promise((resolve) => setTimeout(resolve, 800))

describe('in-place instrumentation', () => {
  it('journals originals, instruments edits, and restores clean sources on close', async () => {
    const theme = await mkdtemp(path.join(os.tmpdir(), 'devtools-in-place-'))
    await mkdir(path.join(theme, 'sections'))
    const file = path.join(theme, 'sections', 'hero.liquid')
    await writeFile(file, '<h1>Hello</h1>')
    const active = await instrumentInPlace(theme)
    expect(await readFile(file, 'utf8')).toContain('shopify-devtools:start:')
    expect((await stat(path.join(theme, JOURNAL_DIRECTORY, JOURNAL_FILE))).isFile()).toBe(true)
    await writeFile(file, '<h2>Changed</h2>')
    await pause()
    expect(await readFile(file, 'utf8')).toContain('shopify-devtools:start:')
    await active.close()
    expect(await readFile(file, 'utf8')).toBe('<h2>Changed</h2>')
    await expect(stat(path.join(theme, JOURNAL_DIRECTORY, JOURNAL_FILE))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers files after an interrupted run before instrumenting again', async () => {
    const theme = await mkdtemp(path.join(os.tmpdir(), 'devtools-recover-'))
    await mkdir(path.join(theme, 'snippets'))
    const file = path.join(theme, 'snippets', 'card.liquid')
    await writeFile(file, '<article>Card</article>')
    const original = '<article>Card</article>'
    const instrumented = instrumentLiquid(original, 'snippets/card.liquid')
    await writeFile(file, instrumented)
    await mkdir(path.join(theme, JOURNAL_DIRECTORY))
    await writeFile(path.join(theme, JOURNAL_DIRECTORY, JOURNAL_FILE), JSON.stringify({
      version: 1,
      entries: [{ file: 'snippets/card.liquid', original, instrumented }],
    }))
    expect(await recoverInPlace(theme)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(original)
  })
})
