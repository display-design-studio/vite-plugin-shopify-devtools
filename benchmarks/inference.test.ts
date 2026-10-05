// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compareKeys, elementPath, treeKeys } from '../src/infer.js'
import { sectionTree, sectionWrappers } from '../src/inspector.js'
import { resolveSections } from '../src/sections.js'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const themes = ['dawn', 'horizon', 'skeleton'] as const
const pages = ['home', 'product', 'collection'] as const

describe('offline inference benchmark', () => {
  it('preserves perfect precision and the multi-root recall baseline', async () => {
    let matched = 0; let expected = 0
    for (const theme of themes) for (const page of pages) {
      const root = path.join(fixtures, theme)
      document.body.innerHTML = await readFile(path.join(root, 'html', `${page}.html`), 'utf8')
      const wrapper = sectionWrappers()[0]
      const resolved = await resolveSections(root, [wrapper.id], page)
      const firstRoot = wrapper.querySelector('.fixture-title')!
      const truth = [`snippets/tile.liquid|${elementPath(firstRoot)}`]
      const report = compareKeys(truth, treeKeys(sectionTree([wrapper], resolved)))
      expect(report.precision, `${theme}/${page}`).toBe(1)
      expect(report.recall, `${theme}/${page}`).toBe(1)
      matched += report.matched; expected += truth.length
    }
    expect(matched / expected).toBe(1)
  })
})
