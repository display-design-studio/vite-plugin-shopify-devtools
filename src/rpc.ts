import { defineRpcFunction, type DevframeAgentHost } from 'devframe'
import type { StandardSchemaV1 } from 'devframe/utils/simple-schema'
import * as v from 'valibot'
import { readSchema } from './schema.js'
import { resolveSections } from './sections.js'

const resolveSectionsInput = v.object({
  ids: v.array(v.string()),
  pageType: v.optional(v.string()),
})

const schemaInput = v.object({ file: v.string() })
const unknownOutput: StandardSchemaV1<unknown> = {
  '~standard': { version: 1, vendor: 'shopify-devtools', validate: (value) => ({ value }) },
}

/** Read-only inspection functions shared by Vite DevTools and agent transports. */
export function createInspectionRpc(themeRoot: string) {
  return [
    defineRpcFunction({
      name: 'shopify-devtools:resolve-sections',
      type: 'query',
      jsonSerializable: true,
      args: [resolveSectionsInput],
      returns: unknownOutput,
      handler: (input) => resolveSections(themeRoot, input.ids, input.pageType),
    }),
    defineRpcFunction({
      name: 'shopify-devtools:schema',
      type: 'query',
      jsonSerializable: true,
      args: [schemaInput],
      returns: unknownOutput,
      handler: (input) => readSchema(themeRoot, input.file),
    }),
  ] as const
}

const parse = <T>(schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>, input: unknown): T => {
  const result = v.safeParse(schema, input)
  if (!result.success) throw new TypeError(result.issues.map((issue) => issue.message).join('; '))
  return result.output
}

/** Direct MCP-friendly tools use named object properties instead of RPC's positional arg envelope. */
export function registerInspectionTools(agent: DevframeAgentHost, themeRoot: string): void {
  agent.registerTool({
    id: 'shopify-devtools:resolve-sections',
    title: 'Resolve Shopify sections',
    description: 'Resolve Shopify section wrapper IDs to their Liquid source files, settings, and inferred child component trees. Use this when section IDs were collected from a rendered storefront.',
    safety: 'read',
    tags: ['shopify', 'liquid', 'sections'],
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } }, pageType: { type: 'string' } },
      required: ['ids'],
      additionalProperties: false,
    },
    handler: (input) => {
      const { ids, pageType } = parse(resolveSectionsInput, input)
      return resolveSections(themeRoot, ids, pageType)
    },
  })
  agent.registerTool({
    id: 'shopify-devtools:schema',
    title: 'Read Liquid component schema',
    description: 'Read the declared settings from a Shopify section or theme block schema. The file must be a theme-relative sections/*.liquid or blocks/*.liquid path.',
    safety: 'read',
    tags: ['shopify', 'liquid', 'schema'],
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' } },
      required: ['file'],
      additionalProperties: false,
    },
    handler: (input) => readSchema(themeRoot, parse(schemaInput, input).file),
  })
}
