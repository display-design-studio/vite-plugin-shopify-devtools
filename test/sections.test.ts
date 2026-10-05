import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJsonc, resolveSections } from '../src/sections.js'

const HEADER = '/*\n * ------------------------------------------------------------\n * IMPORTANT: this file may be updated by the Shopify admin theme editor\n * ------------------------------------------------------------\n */\n'

async function theme(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devtools-sections-'))
  await mkdir(path.join(root, 'templates'))
  await mkdir(path.join(root, 'sections'))
  for (const name of ['hero', 'main-product', 'main-collection', 'header', 'feed-artists']) await writeFile(path.join(root, 'sections', `${name}.liquid`), '<div></div>')
  await writeFile(path.join(root, 'templates', 'index.json'), HEADER + JSON.stringify({ sections: {
    hero: { type: 'hero', name: 'Homepage hero', blocks: { app_review: { type: 'shopify://apps/reviews/blocks/stars/123', settings: { color: 'gold' } } }, block_order: ['app_review'] },
    main: { type: 'main-collection' }, app_section: { type: 'shopify://apps/reviews/sections/recommendations/456', name: 'Recommendations' },
  } }))
  await writeFile(path.join(root, 'templates', 'product.json'), HEADER + JSON.stringify({ sections: { main: { type: 'main-product' } } }))
  await writeFile(path.join(root, 'sections', 'header-group.json'), HEADER + JSON.stringify({ sections: { header: { type: 'header' } } }))
  return root
}

describe('parseJsonc', () => {
  it('ignores comments but keeps comment-like text inside strings', () => {
    expect(parseJsonc('/* a */ { "url": "https://x.test/*not*/", // trailing\n "n": 1 }')).toEqual({ url: 'https://x.test/*not*/', n: 1 })
  })
})

describe('resolveSections', () => {
  it('maps static sections, template keys and section group keys to files', async () => {
    const root = await theme()
    const result = await resolveSections(root, [
      'shopify-section-feed-artists',
      'shopify-section-template--123__hero',
      'shopify-section-sections--456__header',
    ])
    expect(result['shopify-section-feed-artists']).toMatchObject({ file: 'sections/feed-artists.liquid', line: 1, kind: 'section' })
    expect(result['shopify-section-feed-artists']).toMatchObject({ origin: 'static' })
    expect(result['shopify-section-feed-artists']?.instanceKey).toBeUndefined()
    expect(result['shopify-section-template--123__hero']).toMatchObject({ file: 'sections/hero.liquid', origin: 'template', instanceKey: 'hero', instanceName: 'Homepage hero', owner: 'index', ownerFilename: 'templates/index.json' })
    expect(result['shopify-section-sections--456__header']).toMatchObject({ file: 'sections/header.liquid', origin: 'section-group', instanceKey: 'header', owner: 'header-group', ownerFilename: 'sections/header-group.json' })
  })

  it('uses the page type to pick between templates that share a key', async () => {
    const root = await theme()
    const id = 'shopify-section-template--1__main'
    expect((await resolveSections(root, [id], 'product'))[id]?.file).toBe('sections/main-product.liquid')
    expect((await resolveSections(root, [id], 'home'))[id]?.file).toBe('sections/main-collection.liquid')
  })

  it('keeps app sections and blocks with their owning JSON source', async () => {
    const root = await theme()
    const result = await resolveSections(root, ['shopify-section-template--1__hero', 'shopify-section-template--1__app_section'], 'home')
    const appBlock = result['shopify-section-template--1__hero']?.tree?.find((entry) => entry.app)
    expect(appBlock).toMatchObject({ app: true, label: 'stars', appType: 'shopify://apps/reviews/blocks/stars/123', instances: [{ id: 'app_review', sourceFile: 'templates/index.json' }] })
    expect(result['shopify-section-template--1__app_section']).toMatchObject({
      app: true, appType: 'shopify://apps/reviews/sections/recommendations/456', file: 'templates/index.json', instanceName: 'Recommendations', origin: 'template',
    })
  })

  it('skips unknown sections, missing files and unsafe names', async () => {
    const root = await theme()
    await writeFile(path.join(root, 'templates', 'page.json'), JSON.stringify({ sections: { evil: { type: '../../secret' }, ghost: { type: 'ghost' } } }))
    const result = await resolveSections(root, ['shopify-section-template--1__evil', 'shopify-section-template--1__ghost', 'shopify-section-../x', 'shopify-section-nope', 42])
    expect(result).toEqual({})
    expect(await resolveSections(root, 'not-a-list')).toEqual({})
  })
})
