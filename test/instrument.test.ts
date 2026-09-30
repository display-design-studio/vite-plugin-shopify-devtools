import { describe, expect, it } from 'vitest'
import { instrumentLiquid } from '../src/instrument.js'

describe('instrumentLiquid', () => {
  it('wraps section roots and preserves the original source', () => {
    const source = '<section>{{ section.settings.title }}</section>\n{% schema %}{}{% endschema %}'
    const output = instrumentLiquid(source, 'sections/hero.liquid')
    expect(output).toContain('shopify-devtools:start:')
    expect(output).toContain(source)
    expect(output).toMatch(/shopify-devtools:end:/)
  })

  it('wraps static snippets nested in control flow', () => {
    const source = "{% if product %}{% render 'card', product: product %}{% endif %}"
    const output = instrumentLiquid(source, 'sections/grid.liquid')
    expect(output.match(/shopify-devtools:start:/g)).toHaveLength(2)
    expect(output).toContain("{% render 'card', product: product %}")
  })

  it('supports whitespace control and repeated snippets', () => {
    const source = "{%- for item in items -%}{%- render \"tile\", item: item -%}{%- endfor -%}"
    const output = instrumentLiquid(source, 'snippets/list.liquid')
    expect(output).toContain('shopify-devtools:start:')
    expect(output).toContain(source.slice(0, source.indexOf('{%- render')))
  })

  it('does not instrument dynamic renders or unsafe HTML contexts', () => {
    const dynamic = "{% render snippet_name %}"
    const script = "<script>{% render 'payload' %}</script>"
    expect(instrumentLiquid(dynamic, 'snippets/dynamic.liquid')).toBe(dynamic)
    expect(instrumentLiquid(script, 'snippets/script.liquid')).toBe(script)
  })

  it('wraps theme block files and leaves schema content intact', () => {
    const source = '<div {{ block.shopify_attributes }}>x</div>{% schema %}{"name":"X"}{% endschema %}'
    const output = instrumentLiquid(source, 'blocks/text.liquid')
    expect(output).toContain(source)
    expect(output).toContain('shopify-devtools:start:')
  })
})
