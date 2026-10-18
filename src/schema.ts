import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseJsonc } from './sections.js'

export interface SchemaSetting {
  id: string
  label: string
  type: string
  default?: unknown
}

const SCHEMA_FILE = /^(?:sections|blocks)\/[A-Za-z0-9_.-]+\.liquid$/
const SCHEMA_TAG = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/

/** Reads the settings declared in the `{% schema %}` of a section or block file. Returns an empty list when there is none. */
export async function readSchema(root: string, file: unknown): Promise<SchemaSetting[]> {
  if (typeof file !== 'string' || !SCHEMA_FILE.test(file)) return []
  try {
    const source = await readFile(path.join(root, file), 'utf8')
    const body = SCHEMA_TAG.exec(source)?.[1]
    if (!body) return []
    const schema = parseJsonc(body) as { settings?: unknown }
    if (!Array.isArray(schema?.settings)) return []
    return schema.settings.flatMap((entry: Record<string, unknown>): SchemaSetting[] => {
      if (typeof entry?.id !== 'string' || typeof entry.type !== 'string') return []
      return [{ id: entry.id, type: entry.type, label: typeof entry.label === 'string' ? entry.label : entry.id, default: entry.default }]
    })
  } catch { return [] }
}
