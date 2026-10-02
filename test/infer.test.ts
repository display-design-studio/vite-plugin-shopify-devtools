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
})
