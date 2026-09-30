export const START_PREFIX = 'shopify-devtools:start:'
export const END_PREFIX = 'shopify-devtools:end:'

export type ComponentKind = 'section' | 'block' | 'snippet'

export interface ComponentSource {
  id: string
  kind: ComponentKind
  file: string
  line: number
}

export function encodeMarker(component: ComponentSource): string {
  // Standard base64 never contains `--`, which would make an invalid HTML comment body.
  return Buffer.from(JSON.stringify(component), 'utf8').toString('base64')
}
