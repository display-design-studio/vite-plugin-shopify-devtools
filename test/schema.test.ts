import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSchema } from '../src/schema.js'

async function theme(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devtools-schema-'))
  await mkdir(path.join(root, 'sections'))
  await writeFile(path.join(root, 'sections', 'hero.liquid'), `<div></div>
{% schema %}
{ "name": "Hero", "settings": [
  { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
  { "type": "header", "content": "Layout" },
  { "type": "range", "id": "height", "label": "t:sections.hero.settings.height.label", "default": 40 }
] }
{% endschema %}`)
  await writeFile(path.join(root, 'sections', 'plain.liquid'), '<div></div>')
  return root
}

describe('readSchema', () => {
  it('lists the settings with an id and skips headers', async () => {
    expect(await readSchema(await theme(), 'sections/hero.liquid')).toEqual([
      { id: 'heading', type: 'text', label: 'Heading', default: 'Hello' },
      { id: 'height', type: 'range', label: 't:sections.hero.settings.height.label', default: 40 },
    ])
  })

  it('returns nothing without a schema, for missing files and for paths outside sections and blocks', async () => {
    const root = await theme()
    expect(await readSchema(root, 'sections/plain.liquid')).toEqual([])
    expect(await readSchema(root, 'sections/missing.liquid')).toEqual([])
    expect(await readSchema(root, '../secret.liquid')).toEqual([])
    expect(await readSchema(root, 'config/settings_schema.json')).toEqual([])
    expect(await readSchema(root, 42)).toEqual([])
  })
})
