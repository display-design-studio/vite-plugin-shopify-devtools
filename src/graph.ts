import { toLiquidHtmlAST } from '@shopify/liquid-html-parser'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { lineAt, staticRenderName, type AstNode } from './instrument.js'

/** How an element rendered by a Liquid file can be recognised in the DOM, from its static markup only. */
export interface Signature {
  tag: string
  classes: string[]
  attrs: Record<string, string>
}

export interface BlockInstance {
  id: string
  type: string
  settings?: Record<string, unknown>
  sourceFile?: string
  sourceLine?: number
}

export interface JsonBlock extends BlockInstance {
  blocks: JsonBlock[]
}

/** A component a section may contain, with the markup to look for and what it may contain in turn. */
export interface Expectation {
  kind: 'snippet' | 'block'
  file: string
  line: number
  label?: string
  roots: Signature[]
  children: Expectation[]
  /** Blocks of this type in the template JSON, in order: the n-th DOM match is the n-th instance. */
  instances?: BlockInstance[]
  /** Static render call sites in the parent Liquid file, in runtime order when known. */
  callSites?: SourceReference[]
  /** The component's root prints Shopify's runtime block identity attribute. */
  shopifyAttributes?: boolean
  app?: boolean
  appType?: string
}

export interface SourceReference { file: string; line: number }
interface RenderCall extends SourceReference { name: string }

interface Slot {
  types: string[] | null
  roots: Signature[]
  renders: string[]
  renderCalls: RenderCall[]
  line: number
  shopifyAttributes: boolean
}

export interface FileGraph {
  roots: Signature[]
  renders: string[]
  renderCalls: RenderCall[]
  slots: Slot[]
  contentForBlocks: boolean
  staticBlocks: Array<{ id: string; type: string; line: number }>
  shopifyAttributes: boolean
}

const DYNAMIC = '\u0000'
const NAME = /^[A-Za-z0-9_.-]+$/
const MAX_DEPTH = 5
const MAX_ROOTS = 4

type Node = AstNode & { children?: Node[]; attributes?: Node[]; value?: unknown; markup?: unknown; blockStartPosition?: { start: number; end: number } }

// The parser keeps `<svg>` as a raw node whose name is a plain string; script and style never render anything to match.
const isElement = (node: Node): boolean => node.type === 'HtmlElement' || node.type === 'HtmlVoidElement' || node.type === 'HtmlSelfClosingElement' || (node.type === 'HtmlRawNode' && node.name === 'svg')

/** Static text of a name or value; dynamic parts become a marker so partial tokens can be dropped. */
const staticText = (parts: unknown): string => (Array.isArray(parts) ? parts as Node[] : [])
  .map((part) => part.type === 'TextNode' ? String(part.value) : DYNAMIC)
  .join('')

export const signatureWeight = (signature: Signature): number => signature.classes.length + 2 * Object.keys(signature.attrs).length

function signatureOf(element: Node): Signature | undefined {
  const tag = (typeof element.name === 'string' ? element.name : staticText(element.name)).toLowerCase()
  if (!tag || tag.includes(DYNAMIC)) return
  const signature: Signature = { tag, classes: [], attrs: {} }
  for (const attribute of element.attributes ?? []) {
    const name = staticText(attribute.name).toLowerCase()
    if (name.includes(DYNAMIC)) continue
    const value = staticText(attribute.value)
    if (name === 'class') {
      signature.classes = value.split(/\s+/).filter((token) => token && !token.includes(DYNAMIC))
    } else if ((name === 'id' || name.startsWith('data-')) && value && !value.includes(DYNAMIC)) {
      signature.attrs[name] = value
    }
  }
  return signature
}

/** The elements a file emits at its top level, looking through Liquid control flow but not into other elements. */
function topElements(children: Node[] = []): Node[] {
  return children.flatMap((child) => {
    if (isElement(child)) return [child]
    if (child.type === 'LiquidTag' || child.type === 'LiquidBranch') return topElements(child.children)
    return []
  })
}

const usableRoots = (elements: Node[]): Signature[] => elements
  .map(signatureOf)
  .filter((signature): signature is Signature => !!signature && signatureWeight(signature) > 0)
  .slice(0, MAX_ROOTS)

const printsShopifyAttributes = (elements: Node[], variable: string, source: string): boolean => elements.some((element) => {
  const start = element.position?.start
  const end = element.blockStartPosition?.end ?? element.position?.end
  return typeof start === 'number' && typeof end === 'number' && new RegExp(`\\b${variable}\\.shopify_attributes\\b`).test(source.slice(start, end))
})

const lookupPath = (markup: unknown): string => {
  const lookup = markup as { name?: string; lookups?: Array<{ value?: string }> } | undefined
  return lookup?.name ? [lookup.name, ...(lookup.lookups ?? []).map((part) => part.value ?? '')].join('.') : ''
}

function blockLoopVariable(node: Node): string | undefined {
  if (node.type !== 'LiquidTag' || node.name !== 'for') return
  const markup = node.markup as { collection?: unknown; variableName?: unknown }
  return /^(section|block)\.blocks$/.test(lookupPath(markup.collection)) && typeof markup.variableName === 'string' ? markup.variableName : undefined
}

function findCase(nodes: Node[] = [], variable = 'block'): Node | undefined {
  for (const node of nodes) {
    if (node.type === 'LiquidTag' && node.name === 'case' && lookupPath(node.markup) === `${variable}.type`) return node
    const nested = findCase(node.children, variable)
    if (nested) return nested
  }
}

export function analyze(source: string): FileGraph {
  const ast = toLiquidHtmlAST(source) as unknown as Node
  const slots: Slot[] = []
  let contentForBlocks = false
  const staticBlocks: FileGraph['staticBlocks'] = []

  const collect = (nodes: Node[] = [], into: RenderCall[], file = ''): void => {
    for (const node of nodes) {
      if (blockLoopVariable(node)) { slots.push(...slotsOf(node)); continue }
      const name = staticRenderName(node, source)
      if (name) into.push({ name, file, line: lineAt(source, node.position?.start ?? 0) })
      if (node.type === 'LiquidTag' && node.name === 'content_for') {
        const markup = node.markup as { contentForType?: { value?: unknown }; args?: Array<{ name?: unknown; value?: { value?: unknown } }> }
        if (markup.contentForType?.value === 'blocks') contentForBlocks = true
        if (markup.contentForType?.value === 'block') {
          const value = (name: string): string | undefined => {
            const found = markup.args?.find((argument) => argument.name === name)?.value?.value
            return typeof found === 'string' && NAME.test(found) ? found : undefined
          }
          const type = value('type'); const id = value('id')
          if (type && id) staticBlocks.push({ type, id, line: lineAt(source, node.position?.start ?? 0) })
        }
      }
      collect(node.children, into)
    }
  }

  const slotsOf = (loop: Node): Slot[] => {
    const body = (loop.children ?? []).filter((branch) => branch.name !== 'else').flatMap((branch) => branch.children ?? [])
    const variable = blockLoopVariable(loop) ?? 'block'
    const caseTag = findCase(body, variable)
    const at = (node: Node): number => lineAt(source, node.position?.start ?? loop.position?.start ?? 0)
    if (!caseTag) {
      const renderCalls: RenderCall[] = []
      collect(body, renderCalls)
      const elements = topElements(body)
      return [{ types: null, roots: usableRoots(elements), renders: unique(renderCalls.map((call) => call.name)), renderCalls, line: at(loop), shopifyAttributes: printsShopifyAttributes(elements, variable, source) }]
    }
    return (caseTag.children ?? []).filter((branch) => branch.name === 'when').map((branch) => {
      const renderCalls: RenderCall[] = []
      collect(branch.children, renderCalls)
      const types = (Array.isArray(branch.markup) ? branch.markup as Node[] : []).map((value) => String(value.value)).filter((value) => NAME.test(value))
      const elements = topElements(branch.children)
      return { types, roots: usableRoots(elements), renders: unique(renderCalls.map((call) => call.name)), renderCalls, line: at(branch), shopifyAttributes: printsShopifyAttributes(elements, variable, source) }
    })
  }

  const renderCalls: RenderCall[] = []
  collect(ast.children, renderCalls)
  const rootElements = topElements(ast.children)
  return { roots: usableRoots(rootElements), renders: unique(renderCalls.map((call) => call.name)), renderCalls, slots, contentForBlocks, staticBlocks, shopifyAttributes: printsShopifyAttributes(rootElements, 'block', source) }
}

const cache = new Map<string, { mtime: number; graph: FileGraph }>()

/** Drops parsed Liquid data after Vite reports a source mutation. */
export function invalidateGraph(file?: string): void {
  if (file) cache.delete(path.resolve(file)); else cache.clear()
}

async function loadGraph(root: string, file: string): Promise<FileGraph | undefined> {
  const absolute = path.join(root, file)
  try {
    const { mtimeMs } = await stat(absolute)
    const cached = cache.get(absolute)
    if (cached?.mtime === mtimeMs) return cached.graph
    const graph = analyze(await readFile(absolute, 'utf8'))
    cache.set(absolute, { mtime: mtimeMs, graph })
    return graph
  } catch { return undefined }
}

const unique = <T>(values: T[]): T[] => [...new Set(values)]

async function snippetExpectations(root: string, calls: RenderCall[], depth: number, trail: string[]): Promise<Expectation[]> {
  if (depth > MAX_DEPTH) return []
  const found = new Map<string, Expectation>()
  for (const name of unique(calls.map((call) => call.name))) {
    if (!NAME.test(name) || trail.includes(name)) continue
    const file = `snippets/${name}.liquid`
    const graph = await loadGraph(root, file)
    if (!graph) continue
    const children = await childExpectations(root, file, graph, [], depth + 1, [...trail, name])
    const callSites = calls.filter((call) => call.name === name).map(({ file: callFile, line }) => ({ file: callFile, line }))
    // A snippet with no element of its own (or none that can be told apart) is transparent: its children belong to the caller.
    const entries: Expectation[] = graph.roots.length ? [{ kind: 'snippet', file, line: 1, roots: graph.roots, children, callSites }] : children
    for (const entry of entries) if (!found.has(entry.file + (entry.label ?? ''))) found.set(entry.file + (entry.label ?? ''), entry)
  }
  return [...found.values()]
}

/** What a file can render: static snippets, the section's own block loop, and theme blocks from the template JSON. */
async function childExpectations(root: string, file: string, graph: FileGraph, blocks: JsonBlock[], depth: number, trail: string[]): Promise<Expectation[]> {
  const withFile = (calls: RenderCall[]): RenderCall[] => calls.map((call) => ({ ...call, file }))
  const out = await snippetExpectations(root, withFile(graph.renderCalls), depth, trail)

  for (const type of unique(blocks.map((block) => block.type).filter((type) => type.startsWith('shopify://apps/')))) {
    const instances = blocks.filter((block) => block.type === type)
    const label = type.match(/\/blocks\/([^/]+)/)?.[1] ?? 'App block'
    out.push({
      kind: 'block', file: instances[0]?.sourceFile ?? file, line: instances[0]?.sourceLine ?? 1,
      label, roots: [], children: [], instances, shopifyAttributes: true, app: true, appType: type,
    })
  }

  for (const slot of graph.slots) {
    const children = await snippetExpectations(root, withFile(slot.renderCalls), depth + 1, trail)
    if (!slot.roots.length && !slot.shopifyAttributes) { out.push(...children); continue }
    for (const type of slot.types ?? [null]) {
      const instances = blocks.filter((block) => !type || block.type === type).map(({ id, type: blockType, settings, sourceFile, sourceLine }) => ({ id, type: blockType, settings, sourceFile, sourceLine }))
      out.push({ kind: 'block', file, line: slot.line, label: type ?? 'block', roots: slot.roots, children, instances, shopifyAttributes: slot.shopifyAttributes })
    }
  }

  for (const type of unique(graph.staticBlocks.map((block) => block.type))) {
    const blockFile = `blocks/${type}.liquid`
    const blockGraph = await loadGraph(root, blockFile)
    if (!blockGraph) continue
    const instances = graph.staticBlocks.filter((block) => block.type === type)
    const children = await childExpectations(root, blockFile, blockGraph, [], depth + 1, trail)
    if (!blockGraph.roots.length && !blockGraph.shopifyAttributes) { out.push(...children); continue }
    out.push({
      kind: 'block', file: blockFile, line: 1, label: type, roots: blockGraph.roots, children,
      instances: instances.map(({ id }) => ({ id, type })),
      callSites: instances.map(({ line }) => ({ file, line })),
      shopifyAttributes: blockGraph.shopifyAttributes,
    })
  }

  if (graph.contentForBlocks && depth <= MAX_DEPTH) {
    for (const type of unique(blocks.map((block) => block.type).filter((type) => !type.startsWith('shopify://apps/')))) {
      const blockFile = `blocks/${type}.liquid`
      const blockGraph = await loadGraph(root, blockFile)
      if (!blockGraph) continue
      const same = blocks.filter((block) => block.type === type)
      const children = await childExpectations(root, blockFile, blockGraph, same.flatMap((block) => block.blocks), depth + 1, trail)
      if (!blockGraph.roots.length && !blockGraph.shopifyAttributes) { out.push(...children); continue }
      out.push({ kind: 'block', file: blockFile, line: 1, label: type, roots: blockGraph.roots, children, instances: same.map(({ id, type: blockType, settings, sourceFile, sourceLine }) => ({ id, type: blockType, settings, sourceFile, sourceLine })), shopifyAttributes: blockGraph.shopifyAttributes })
    }
  }
  return out
}

/** The components a section may contain, found by reading its Liquid and following the snippets and blocks it renders. */
export async function sectionExpectations(root: string, file: string, blocks: JsonBlock[] = []): Promise<Expectation[]> {
  const graph = await loadGraph(root, file)
  return graph ? childExpectations(root, file, graph, blocks, 0, []) : []
}
