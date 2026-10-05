// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Liquid, type TagToken, type TopLevelToken } from 'liquidjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { compareKeys, treeKeys } from '../src/infer.js'
import { instrumentLiquid } from '../src/instrument.js'
import { componentTree, flatten, sectionTree, sectionWrappers } from '../src/inspector.js'
import { parseJsonc, resolveSections, type ResolvedSection } from '../src/sections.js'

const theme = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../playground/skeleton-theme')
const SECTIONS = { demo: 'template--1__demo', blocks: 'template--1__theme_blocks' } as const

interface JsonBlock { type: string; settings?: object; blocks?: Record<string, JsonBlock>; block_order?: string[] }
const index = parseJsonc(readFileSync(path.join(theme, 'templates/index.json'), 'utf8')) as { sections: Record<string, JsonBlock> }

/** Renders playground sections with LiquidJS, optionally with the same markers `shopify-devtools dev` writes. */
function renderer(instrument: boolean): (key: keyof typeof SECTIONS) => Promise<string> {
  const read = (file: string): string => {
    const source = readFileSync(file, 'utf8')
    return instrument ? instrumentLiquid(source, path.relative(theme, file).split(path.sep).join('/')) : source
  }
  const engine = new Liquid({
    root: [path.join(theme, 'snippets')],
    relativeReference: false,
    extname: '.liquid',
    fs: {
      readFileSync: read,
      readFile: async (file: string) => read(file),
      existsSync: (file: string) => existsSync(file),
      exists: async (file: string) => existsSync(file),
      resolve: (dir: string, file: string, ext: string) => path.resolve(dir, file.endsWith(ext) ? file : `${file}${ext}`),
    },
  })
  // Tags whose body is not markup, and `content_for`, which Shopify implements and LiquidJS does not.
  for (const name of ['schema', 'stylesheet', 'javascript', 'doc']) {
    engine.registerTag(name, {
      parse(_token: TagToken, remaining: TopLevelToken[]) {
        while (remaining.length) if ((remaining.shift() as TagToken).name === `end${name}`) return
      },
      render() { return '' },
    })
  }
  engine.registerTag('content_for', {
    parse() {},
    async render(context, emitter) {
      const children = (context.getSync(['__children']) ?? {}) as { blocks?: Record<string, JsonBlock>; order?: string[] }
      for (const id of children.order ?? []) {
        const block = children.blocks?.[id]
        if (!block) continue
        const source = read(path.join(theme, 'blocks', `${block.type}.liquid`))
        emitter.write(await engine.parseAndRender(source, {
          block: { id, type: block.type, settings: block.settings ?? {} },
          __children: { blocks: block.blocks, order: block.block_order },
        }))
      }
    },
  })

  return async (key) => {
    const jsonKey = key === 'blocks' ? 'theme_blocks' : 'demo'
    const section = index.sections[jsonKey]
    const html = await engine.parseAndRender(read(path.join(theme, 'sections', `${section.type}.liquid`)), {
      section: {
        id: jsonKey,
        settings: section.settings ?? {},
        blocks: (section.block_order ?? []).map((id) => ({ id, ...section.blocks?.[id] })),
      },
      __children: { blocks: section.blocks, order: section.block_order },
    })
    return `<div id="shopify-section-${SECTIONS[key]}" class="shopify-section">${html}</div>`
  }
}

const page = async (instrument: boolean): Promise<string> => {
  const render = renderer(instrument)
  return (await render('demo')) + (await render('blocks'))
}

let resolved: Record<string, ResolvedSection>

beforeAll(async () => {
  const ids = Object.values(SECTIONS).map((id) => `shopify-section-${id}`)
  resolved = await resolveSections(theme, ids, 'home')
})

describe('inference against the exact tree', () => {
  it('finds nothing wrong in the playground demo and misses only what has no element', async () => {
    document.body.innerHTML = await page(true)
    const truth = treeKeys(componentTree())
    expect(truth.length).toBeGreaterThan(10)

    document.body.innerHTML = await page(false)
    const report = compareKeys(truth, treeKeys(sectionTree(sectionWrappers(), resolved)))

    expect(report.extra).toEqual([])
    expect(report.precision).toBe(1)
    // Only snippets with no element of their own (demo-money) cannot be found.
    expect(report.missed).toHaveLength(1)
    expect(report.recall).toBeGreaterThan(0.9)
  })

  it('nests snippets inside the components that render them and tells shared markup apart', async () => {
    document.body.innerHTML = await page(false)
    const sections = sectionTree(sectionWrappers(), resolved)
    const all = flatten(sections).map(({ node }) => node)
    const count = (file: string): number => all.filter((node) => node.file === file).length

    expect(count('snippets/demo-card.liquid')).toBe(3)
    expect(count('snippets/demo-panel.liquid')).toBe(1)
    expect(count('snippets/demo-badge.liquid')).toBe(3)
    expect(count('snippets/demo-button.liquid')).toBe(5)
    const card = all.find((node) => node.file === 'snippets/demo-card.liquid')
    expect(card?.children.map((child) => child.file)).toEqual(['snippets/demo-badge.liquid', 'snippets/demo-button.liquid'])
    expect(card?.parent?.file).toBe('sections/inference-demo.liquid')
    expect(card?.inferred).toBe(true)
  })

  it('labels inline blocks with their template ids and nests theme blocks', async () => {
    document.body.innerHTML = await page(false)
    const all = flatten(sectionTree(sectionWrappers(), resolved)).map(({ node }) => node)
    const inline = all.filter((node) => node.kind === 'block' && node.file === 'sections/inference-demo.liquid')
    expect(inline.map((node) => node.label)).toEqual(['feature · feature_a', 'feature · feature_b', 'cta · cta_a'])
    expect(inline[0].children.map((child) => child.file)).toEqual(['snippets/demo-icon.liquid'])

    const group = all.find((node) => node.file === 'blocks/group.liquid')
    expect(group?.children.map((child) => child.shopifyId)).toEqual(['text_a', 'text_b'])
    expect(group?.instanceSourceFile).toBe('templates/index.json')
    expect(group?.instanceSourceLine).toBeGreaterThan(1)
    expect(group?.settings).toEqual(expect.any(Object))
  })
})
