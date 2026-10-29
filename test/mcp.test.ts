import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const theme = path.join(root, 'test/browser/fixture/theme')

describe('DevFrame MCP server', () => {
  it('serves the read-only inspection backend over stdio', async () => {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['src/cli.ts', 'mcp', '--theme-path', theme],
      cwd: root,
      stderr: 'pipe',
    })
    const client = new Client({ name: 'shopify-devtools-test', version: '1.0.0' })
    let stderr = ''
    transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name)).toEqual([
        'shopify-devtools_resolve-sections',
        'shopify-devtools_schema',
      ])
      expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
      expect(tools[0]?.inputSchema).toMatchObject({
        required: ['ids'],
        properties: { ids: { type: 'array' }, pageType: { type: 'string' } },
      })

      const resolved = await client.callTool({
        name: 'shopify-devtools_resolve-sections',
        arguments: { ids: ['shopify-section-template--1__hero'], pageType: 'home' },
      })
      expect(resolved.content[0]).toMatchObject({ type: 'text' })
      const sections = JSON.parse(resolved.content[0]?.type === 'text' ? resolved.content[0].text : '{}')
      expect(sections['shopify-section-template--1__hero']).toMatchObject({
        file: 'sections/hero.liquid',
        kind: 'section',
        ownerFilename: 'templates/index.json',
      })

      const schema = await client.callTool({
        name: 'shopify-devtools_schema',
        arguments: { file: '../package.json' },
      })
      expect(schema.content[0]).toMatchObject({ type: 'text', text: '[]' })
    } finally {
      await client.close()
    }

    expect(stderr).toBe('')
  }, 15_000)
})
