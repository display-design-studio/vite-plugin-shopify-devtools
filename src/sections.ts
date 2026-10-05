import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { sectionExpectations, type Expectation, type JsonBlock } from './graph.js'

export interface ResolvedSection {
  file: string
  line: number
  kind: 'section'
  /** The snippets and blocks this section may contain, read from its Liquid and template JSON. */
  tree?: Expectation[]
  instanceKey?: string
  instanceName?: string
  owner?: string
  ownerFilename?: string
  origin?: 'template' | 'section-group' | 'static'
  app?: boolean
  appType?: string
  instanceSourceFile?: string
  instanceSourceLine?: number
}

const MAX_IDS = 200
const SECTION_NAME = /^[A-Za-z0-9_.-]+$/
const APP_TYPE = /^shopify:\/\/apps\/[^\s]+$/
const validType = (value: string): boolean => SECTION_NAME.test(value) || APP_TYPE.test(value)
const PAGE_TYPE_TEMPLATES: Record<string, string> = { home: 'index' }

/** Parses Shopify JSON files, which may start with a block comment written by the theme editor. */
export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      out += char
      if (char === '\\') out += text[++i] ?? ''
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true; out += char
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
    } else if (char === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end - 1
    } else out += char
  }
  return JSON.parse(out)
}

type Candidate = { owner: string; ownerFilename: string; key?: string; name?: string; type: string; blocks: JsonBlock[]; sourceLine?: number }
type RawBlock = { type?: unknown; name?: unknown; settings?: unknown; disabled?: unknown; blocks?: Record<string, RawBlock>; block_order?: unknown }

const lineOfKey = (text: string, key: string): number => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`"${escaped}"\\s*:`).exec(text)
  return match ? text.slice(0, match.index).split('\n').length : 1
}

/** Blocks of a section or block in the order Shopify renders them, without the disabled ones. */
function normalizeBlocks(raw: RawBlock | undefined, text: string, sourceFile: string): JsonBlock[] {
  const blocks = raw?.blocks ?? {}
  const order = Array.isArray(raw?.block_order) ? raw.block_order.filter((id): id is string => typeof id === 'string') : Object.keys(blocks)
  return order.flatMap((id) => {
    const block = blocks[id]
    if (!block || block.disabled === true || typeof block.type !== 'string' || !validType(block.type)) return []
    const settings = block.settings && typeof block.settings === 'object' && !Array.isArray(block.settings) ? block.settings as Record<string, unknown> : undefined
    return [{ id, type: block.type, settings, sourceFile, sourceLine: lineOfKey(text, id), blocks: normalizeBlocks(block, text, sourceFile) }]
  })
}

async function readSectionTypes(file: string): Promise<Array<[string, { type: string; blocks: JsonBlock[] }]>> {
  try {
    const text = await readFile(file, 'utf8')
    const data = parseJsonc(text) as { sections?: Record<string, RawBlock> }
    const sourceFile = path.relative(path.dirname(path.dirname(file)), file).split(path.sep).join('/')
    return Object.entries(data?.sections ?? {})
      .filter((entry): entry is [string, RawBlock & { type: string }] => typeof entry[1]?.type === 'string' && validType(entry[1].type))
      .map(([key, value]) => [key, { type: value.type, name: typeof value.name === 'string' ? value.name : undefined, sourceLine: lineOfKey(text, key), blocks: normalizeBlocks(value, text, sourceFile) }])
  } catch { return [] }
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith('.json')).map((name) => path.join(directory, name))
  } catch { return [] }
}

async function collect(files: string[], ownerOf: (file: string) => string): Promise<Map<string, Candidate[]>> {
  const keys = new Map<string, Candidate[]>()
  await Promise.all(files.map(async (file) => {
    for (const [key, section] of await readSectionTypes(file)) {
      const list = keys.get(key) ?? []
      list.push({ owner: ownerOf(file), ownerFilename: path.relative(path.dirname(path.dirname(file)), file).split(path.sep).join('/'), key, ...section })
      keys.set(key, list)
    }
  }))
  return keys
}

/**
 * Maps `shopify-section-*` wrapper ids rendered by Shopify to the section files that produced them,
 * using only the theme sources: JSON templates and section groups name the section type for each key.
 */
export async function resolveSections(root: string, ids: unknown, pageType?: unknown): Promise<Record<string, ResolvedSection>> {
  if (!Array.isArray(ids)) return {}
  const wrappers = ids.filter((id): id is string => typeof id === 'string').slice(0, MAX_IDS)
  const preferred = typeof pageType === 'string' ? (PAGE_TYPE_TEMPLATES[pageType] ?? pageType) : undefined
  const exists = async (file: string): Promise<boolean> => readFile(path.join(root, file)).then(() => true, () => false)
  let templates: Map<string, Candidate[]> | undefined
  let groups: Map<string, Candidate[]> | undefined
  const result: Record<string, ResolvedSection> = {}

  for (const id of wrappers) {
    let found: Candidate | undefined
    let origin: ResolvedSection['origin']
    const template = id.match(/^shopify-section-template--\d+__(.+)$/)
    const group = id.match(/^shopify-section-sections--\d+__(.+)$/)
    if (template) {
      origin = 'template'
      templates ??= await collect(
        [...await jsonFiles(path.join(root, 'templates')), ...await jsonFiles(path.join(root, 'templates', 'customers'))],
        (file) => path.relative(path.join(root, 'templates'), file).replace(/\.json$/, '').split(path.sep).join('/'),
      )
      const candidates = templates.get(template[1]) ?? []
      found = candidates.find((candidate) => preferred && (candidate.owner === preferred || candidate.owner.startsWith(`${preferred}.`))) ?? candidates[0]
    } else if (group) {
      origin = 'section-group'
      groups ??= await collect(await jsonFiles(path.join(root, 'sections')), (file) => path.basename(file, '.json'))
      found = groups.get(group[1])?.[0]
    } else {
      const name = id.replace(/^shopify-section-/, '')
      if (SECTION_NAME.test(name)) {
        origin = 'static'
        found = { type: name, blocks: [], owner: `sections/${name}.liquid`, ownerFilename: `sections/${name}.liquid` }
      }
    }
    if (!found) continue
    if (APP_TYPE.test(found.type)) {
      result[id] = {
        file: found.ownerFilename, line: found.sourceLine ?? 1, kind: 'section', instanceKey: found.key,
        instanceName: found.name, owner: found.owner, ownerFilename: found.ownerFilename, origin,
        app: true, appType: found.type, instanceSourceFile: found.ownerFilename, instanceSourceLine: found.sourceLine,
      }
      continue
    }
    const file = `sections/${found.type}.liquid`
    if (await exists(file)) result[id] = {
      file, line: 1, kind: 'section', tree: await sectionExpectations(root, file, found.blocks),
      instanceKey: found.key, instanceName: found.name, owner: found.owner, ownerFilename: found.ownerFilename, origin,
    }
  }
  return result
}
