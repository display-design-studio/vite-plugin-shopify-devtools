import { readFileSync } from 'node:fs'
import { defineDevframe } from 'devframe'
import { createInspectionRpc, registerInspectionTools } from './rpc.js'

export interface ShopifyDevframeOptions {
  themeRoot: string
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  homepage: string
  description: string
}

/** Portable, agent-native view of the read-only Shopify inspection backend. */
export function createShopifyDevframe(options: ShopifyDevframeOptions) {
  return defineDevframe({
    id: 'shopify-devtools',
    name: 'Shopify Liquid DevTools',
    version: manifest.version,
    packageName: manifest.name,
    importMetaUrl: import.meta.url,
    homepage: manifest.homepage,
    description: manifest.description,
    setup(context) {
      for (const definition of createInspectionRpc(options.themeRoot)) context.rpc.register(definition)
      registerInspectionTools(context.agent, options.themeRoot)
    },
  })
}
