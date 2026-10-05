// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Expectation, Signature } from '../src/graph.js'
import { inferNodes, matchesSignature } from '../src/infer.js'

const signature = (tag: string, classes: string[] = [], attrs: Record<string, string> = {}): Signature => ({ tag, classes, attrs })
const snippet = (file: string, roots: Signature[], children: Expectation[] = []): Expectation => ({ kind: 'snippet', file: `snippets/${file}.liquid`, line: 1, roots, children })
const run = (html: string, expectations: Expectation[]) => {
  const scope = document.createElement('div')
  scope.innerHTML = html
  let next = 0
  return inferNodes(scope, expectations, { occurrence: () => next++ }, null)
}
const files = (nodes: ReturnType<typeof run>): string[] => nodes.map((node) => node.file)

describe('matchesSignature', () => {
  it('needs the tag, every class and every static attribute, and ignores extra classes', () => {
    const element = Object.assign(document.createElement('a'), { className: 'btn btn--big is-open' })
    element.setAttribute('data-k', '1')
    expect(matchesSignature(element, signature('a', ['btn', 'btn--big'], { 'data-k': '1' }))).toBe(true)
    expect(matchesSignature(element, signature('a', ['btn', 'missing']))).toBe(false)
    expect(matchesSignature(element, signature('span', ['btn']))).toBe(false)
    expect(matchesSignature(element, signature('a', ['btn'], { 'data-k': '2' }))).toBe(false)
  })
})

describe('inferNodes', () => {
  it('prefers the more specific component when markup overlaps', () => {
    const nodes = run('<article class="card card--wide"></article><article class="card"></article>', [
      snippet('card', [signature('article', ['card'])]),
      snippet('panel', [signature('article', ['card', 'card--wide'])]),
    ])
    expect(files(nodes)).toEqual(['snippets/panel.liquid', 'snippets/card.liquid'])
  })

  it('shows nothing for markup that two different components share exactly', () => {
    const nodes = run('<div class="box"></div>', [snippet('a', [signature('div', ['box'])]), snippet('b', [signature('div', ['box'])])])
    expect(nodes).toEqual([])
  })

  it('lets a container claim what is inside it before the caller does', () => {
    const button = snippet('button', [signature('a', ['btn'])])
    const nodes = run('<article class="card"><a class="btn"></a></article><a class="btn"></a>', [
      button,
      snippet('card', [signature('article', ['card'])], [button]),
    ])
    expect(files(nodes)).toEqual(['snippets/card.liquid', 'snippets/button.liquid'])
    expect(files(nodes[0].children)).toEqual(['snippets/button.liquid'])
  })

  it('matches only inside the scope and never the scope itself', () => {
    const scope = document.createElement('section')
    scope.className = 'card'
    scope.innerHTML = '<p class="card"></p>'
    expect(inferNodes(scope, [snippet('card', [signature('section', ['card'])])], { occurrence: () => 0 }, null)).toEqual([])
  })

  it('gives every node of the same component its own occurrence and links parents', () => {
    const nodes = run('<i class="x"></i><i class="x"></i>', [snippet('x', [signature('i', ['x'])])])
    expect(nodes.map((node) => node.occurrence)).toEqual([0, 1])
    expect(nodes.every((node) => node.inferred && node.parent === null)).toBe(true)
  })

  it('numbers block instances in order from the template JSON', () => {
    const block: Expectation = {
      kind: 'block', file: 'sections/s.liquid', line: 3, label: 'feature', roots: [signature('li', ['f'])], children: [],
      instances: [{ id: 'a', type: 'feature' }, { id: 'b', type: 'feature' }],
    }
    const nodes = run('<li class="f"></li><li class="f"></li><li class="f"></li>', [block])
    expect(nodes.map((node) => node.label)).toEqual(['feature · a', 'feature · b', 'feature'])
    expect(nodes.map((node) => node.shopifyId)).toEqual(['a', 'b', undefined])
  })

  it('uses Shopify block attributes to match generic roots and reject another block type', () => {
    const block: Expectation = {
      kind: 'block', file: 'blocks/text.liquid', line: 1, label: 'text', roots: [], children: [], shopifyAttributes: true,
      instances: [{ id: 'text-a', type: 'text' }],
    }
    const nodes = run(`<div data-shopify-editor-block='{"id":"other","type":"image"}'></div><div data-shopify-editor-block='{"id":"text-a","type":"text"}'></div><div data-shopify-editor-block='bad'></div>`, [block])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ file: 'blocks/text.liquid', shopifyId: 'text-a' })
  })

  it('shows app blocks from runtime identity without a local Liquid definition', () => {
    const app: Expectation = {
      kind: 'block', file: 'templates/index.json', line: 8, label: 'stars', roots: [], children: [], shopifyAttributes: true, app: true,
      appType: 'shopify://apps/reviews/blocks/stars/123', instances: [{ id: 'review-a', type: 'shopify://apps/reviews/blocks/stars/123', sourceFile: 'templates/index.json', sourceLine: 8 }],
    }
    const nodes = run(`<div data-shopify-editor-block='{"id":"review-a","type":"shopify://apps/reviews/blocks/stars/123"}'></div>`, [app])
    expect(nodes[0]).toMatchObject({ app: true, label: 'stars · review-a', shopifyId: 'review-a', instanceSourceFile: 'templates/index.json' })
  })

  it('explains high, medium, and low confidence from the evidence used', () => {
    const nodes = run('<div class="one"></div><div class="two extra"></div><div id="unique"></div>', [
      snippet('low', [signature('div', ['one'])]),
      snippet('medium', [signature('div', ['two', 'extra'])]),
      snippet('high', [signature('div', [], { id: 'unique' })]),
    ])
    expect(nodes.map((node) => [node.inferenceConfidence, node.inferenceReason])).toEqual([
      ['low', 'Matched one static class: one.'],
      ['medium', 'Matched 2 static classes.'],
      ['high', 'Matched distinctive static attribute: id.'],
    ])
  })

  it('reports missing, ambiguous, and transparent snippets once with their call sites while preserving transparent children', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<i class="leaf"></i><div class="same"></div>'
    const diagnostics: NonNullable<Parameters<typeof inferNodes>[2]['diagnostics']> = []
    const at = (file: string, line: number): Expectation['callSites'] => [{ file, line }]
    const nodes = inferNodes(scope, [
      { ...snippet('transparent', [], [snippet('leaf', [signature('i', ['leaf'])])]), transparent: true, callSites: at('sections/a.liquid', 3) },
      { ...snippet('missing', [signature('p', ['gone'])]), callSites: at('sections/a.liquid', 4) },
      { ...snippet('ambiguous-a', [signature('div', ['same'])]), callSites: at('sections/a.liquid', 5) },
      { ...snippet('ambiguous-b', [signature('div', ['same'])]), callSites: at('sections/a.liquid', 6) },
    ], { occurrence: () => 0, diagnostics }, null)
    expect(files(nodes)).toEqual(['snippets/leaf.liquid'])
    expect(diagnostics).toEqual([
      { file: 'snippets/transparent.liquid', callSiteFile: 'sections/a.liquid', callSiteLine: 3, reason: 'Root cannot be recognised' },
      { file: 'snippets/missing.liquid', callSiteFile: 'sections/a.liquid', callSiteLine: 4, reason: 'No matching DOM element' },
      { file: 'snippets/ambiguous-a.liquid', callSiteFile: 'sections/a.liquid', callSiteLine: 5, reason: 'Ambiguous DOM match' },
      { file: 'snippets/ambiguous-b.liquid', callSiteFile: 'sections/a.liquid', callSiteLine: 6, reason: 'Ambiguous DOM match' },
    ])
  })
})
