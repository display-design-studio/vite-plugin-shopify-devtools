import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyze, sectionExpectations } from '../src/graph.js'

async function theme(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devtools-graph-'))
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), content)
  }
  return root
}

describe('analyze', () => {
  it('reads the root element, keeping only the static class tokens', () => {
    const graph = analyze('<div class="card card--{{ size }} {{ extra }} wide" id="x" data-k="1" data-v="{{ v }}">{% render "icon" %}</div>')
    expect(graph.roots).toEqual([{ tag: 'div', classes: ['card', 'wide'], attrs: { id: 'x', 'data-k': '1' } }])
    expect(graph.renders).toEqual(['icon'])
    expect(graph.renderCalls).toEqual([{ name: 'icon', file: '', line: 1 }])
  })

  it('looks through Liquid control flow but not into elements, and reads svg', () => {
    const graph = analyze('{% if a %}<svg class="i"></svg>{% else %}<span class="j"><b class="inner"></b></span>{% endif %}')
    expect(graph.roots.map((root) => `${root.tag}.${root.classes[0]}`)).toEqual(['svg.i', 'span.j'])
  })

  it('has no usable root when the markup is generic or missing', () => {
    expect(analyze('<div><p class="a"></p></div>').roots).toEqual([])
    expect(analyze('{{ value }} EUR').roots).toEqual([])
  })

  it('splits section block loops by block type and keeps their snippets apart', () => {
    const graph = analyze(`{% render 'top' %}
{% for block in section.blocks %}
  {% case block.type %}
    {% when 'a' %}<li class="a">{% render 'in-a' %}</li>
    {% when 'b', 'c' %}<li class="b"></li>
  {% endcase %}
{% endfor %}`)
    expect(graph.renders).toEqual(['top'])
    expect(graph.slots.map((slot) => [slot.types, slot.roots[0]?.classes, slot.renders])).toEqual([[['a'], ['a'], ['in-a']], [['b', 'c'], ['b'], []]])
    expect(graph.slots[0].renderCalls[0]).toMatchObject({ name: 'in-a', line: 4 })
  })

  it('treats a block loop without case as one slot for every type', () => {
    const graph = analyze('{% for block in section.blocks %}<div class="blk"></div>{% endfor %}')
    expect(graph.slots).toHaveLength(1)
    expect(graph.slots[0].types).toBeNull()
  })

  it('notices where theme blocks are rendered', () => {
    expect(analyze("<div>{% content_for 'blocks' %}</div>").contentForBlocks).toBe(true)
    expect(analyze('<div></div>').contentForBlocks).toBe(false)
  })

  it('reads static block calls and nested block loops with custom variable names', () => {
    const graph = analyze(`{% content_for 'block', type: '_heading', id: 'fixed-heading' %}
{% for child_block in block.blocks %}
  {% case child_block.type %}{% when 'text' %}<p class="nested"></p>{% endcase %}
{% endfor %}`)
    expect(graph.staticBlocks).toEqual([{ type: '_heading', id: 'fixed-heading', line: 1 }])
    expect(graph.slots).toHaveLength(1)
    expect(graph.slots[0]).toMatchObject({ types: ['text'], roots: [{ tag: 'p', classes: ['nested'], attrs: {} }] })
  })

  it('records Shopify block identity attributes even on otherwise generic roots', () => {
    const inline = analyze(`{% for block in section.blocks %}<div {{ block.shopify_attributes }}></div>{% endfor %}`)
    expect(inline.slots[0]).toMatchObject({ roots: [], shopifyAttributes: true })
    expect(analyze(`<div {{ block.shopify_attributes }}></div>`)).toMatchObject({ roots: [], shopifyAttributes: true })
  })
})

describe('sectionExpectations', () => {
  it('follows snippets, passes through ones with no element, and survives cycles', async () => {
    const root = await theme({
      'sections/s.liquid': `<section>{% render 'wrap' %}{% render 'loop' %}{% render 'missing' %}</section>`,
      'snippets/wrap.liquid': `{% render 'leaf' %}`,
      'snippets/leaf.liquid': `<i class="leaf"></i>`,
      'snippets/loop.liquid': `<b class="loop">{% render 'loop' %}</b>`,
    })
    const tree = await sectionExpectations(root, 'sections/s.liquid')
    expect(tree.map((entry) => entry.file)).toEqual(['snippets/leaf.liquid', 'snippets/loop.liquid'])
    expect(tree[1].children).toEqual([])
    expect(tree[0].callSites).toEqual([{ file: 'snippets/wrap.liquid', line: 1 }])
  })

  it('maps template blocks to theme block files and nests the ones inside them', async () => {
    const root = await theme({
      'sections/s.liquid': `<div>{% content_for 'blocks' %}</div>`,
      'blocks/group.liquid': `<div class="group">{% content_for 'blocks' %}</div>`,
      'blocks/text.liquid': `<p class="text"></p>`,
    })
    const tree = await sectionExpectations(root, 'sections/s.liquid', [
      { id: 'g', type: 'group', settings: { layout: 'stack' }, sourceFile: 'templates/index.json', sourceLine: 8, blocks: [{ id: 't1', type: 'text', blocks: [] }, { id: 't2', type: 'text', blocks: [] }] },
    ])
    expect(tree.map((entry) => [entry.file, entry.instances?.map((instance) => instance.id)])).toEqual([['blocks/group.liquid', ['g']]])
    expect(tree[0].instances?.[0]).toMatchObject({ settings: { layout: 'stack' }, sourceFile: 'templates/index.json', sourceLine: 8 })
    expect(tree[0].children.map((entry) => [entry.file, entry.instances?.map((instance) => instance.id)])).toEqual([['blocks/text.liquid', ['t1', 't2']]])
  })

  it('maps static blocks and inline loops over nested block.blocks', async () => {
    const root = await theme({
      'sections/s.liquid': `{% content_for 'block', type: 'group', id: 'fixed-group' %}`,
      'blocks/group.liquid': `<div class="group">{% for child in block.blocks %}{% case child.type %}{% when 'text' %}<p class="nested"></p>{% endcase %}{% endfor %}</div>`,
    })
    const tree = await sectionExpectations(root, 'sections/s.liquid')
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ file: 'blocks/group.liquid', instances: [{ id: 'fixed-group', type: 'group' }], callSites: [{ file: 'sections/s.liquid', line: 1 }] })

    const nested = await sectionExpectations(root, 'blocks/group.liquid', [{ id: 'text-a', type: 'text', blocks: [] }])
    expect(nested[0]).toMatchObject({ kind: 'block', file: 'blocks/group.liquid', label: 'text', instances: [{ id: 'text-a', type: 'text' }] })
  })

  it('is empty for a missing section file', async () => {
    expect(await sectionExpectations(await theme({}), 'sections/none.liquid')).toEqual([])
  })
})
