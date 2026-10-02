import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export interface ResolvedSection {
  file: string
  line: number
  kind: 'section'
}

const MAX_IDS = 200
const SECTION_NAME = /^[A-Za-z0-9_.-]+$/
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

type Candidate = { owner: string; type: string }

async function readSectionTypes(file: string): Promise<Array<[string, string]>> {
  try {
    const data = parseJsonc(await readFile(file, 'utf8')) as { sections?: Record<string, { type?: unknown }> }
    return Object.entries(data?.sections ?? {})
      .filter((entry): entry is [string, { type: string }] => typeof entry[1]?.type === 'string' && SECTION_NAME.test(entry[1].type))
      .map(([key, value]) => [key, value.type])
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
    for (const [key, type] of await readSectionTypes(file)) {
      const list = keys.get(key) ?? []
      list.push({ owner: ownerOf(file), type })
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
    let type: string | undefined
    const template = id.match(/^shopify-section-template--\d+__(.+)$/)
    const group = id.match(/^shopify-section-sections--\d+__(.+)$/)
    if (template) {
      templates ??= await collect(
        [...await jsonFiles(path.join(root, 'templates')), ...await jsonFiles(path.join(root, 'templates', 'customers'))],
        (file) => path.relative(path.join(root, 'templates'), file).replace(/\.json$/, '').split(path.sep).join('/'),
      )
      const candidates = templates.get(template[1]) ?? []
      type = (candidates.find((candidate) => preferred && (candidate.owner === preferred || candidate.owner.startsWith(`${preferred}.`))) ?? candidates[0])?.type
    } else if (group) {
      groups ??= await collect(await jsonFiles(path.join(root, 'sections')), (file) => path.basename(file, '.json'))
      type = groups.get(group[1])?.[0]?.type
    } else {
      const name = id.replace(/^shopify-section-/, '')
      if (SECTION_NAME.test(name)) type = name
    }
    if (!type) continue
    const file = `sections/${type}.liquid`
    if (await exists(file)) result[id] = { file, line: 1, kind: 'section' }
  }
  return result
}
