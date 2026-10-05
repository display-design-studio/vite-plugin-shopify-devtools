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
}

export interface SourceReference { file: string; line: number }
interface RenderCall extends SourceReference { name: string }

interface Slot {
  types: string[] | null
  roots: Signature[]
  renders: string[]
  renderCalls: RenderCall[]
  line: number
}

export interface FileGraph {
  roots: Signature[]
  renders: string[]
  renderCalls: RenderCall[]
  slots: Slot[]
  contentForBlocks: boolean
}

const DYNAMIC = '\u0000'
const NAME = /^[A-Za-z0-9_.-]+$/
const MAX_DEPTH = 5
const MAX_ROOTS = 4

type Node = AstNode & { children?: Node[]; attributes?: Node[]; value?: unknown; markup?: unknown }

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

const lookupPath = (markup: unknown): string => {
  const lookup = markup as { name?: string; lookups?: Array<{ value?: string }> } | undefined
  return lookup?.name ? [lookup.name, ...(lookup.lookups ?? []).map((part) => part.value ?? '')].join('.') : ''
}

function isBlockLoop(node: Node): boolean {
  return node.type === 'LiquidTag' && node.name === 'for' && lookupPath((node.markup as { collection?: unknown })?.collection) === 'section.blocks'
}

function findCase(nodes: Node[] = []): Node | undefined {
  for (const node of nodes) {
    if (node.type === 'LiquidTag' && node.name === 'case' && lookupPath(node.markup) === 'block.type') return node
    const nested = findCase(node.children)
    if (nested) return nested
  }
}

export function analyze(source: string): FileGraph {
  const ast = toLiquidHtmlAST(source) as unknown as Node
  const slots: Slot[] = []
  let contentForBlocks = false

  const collect = (nodes: Node[] = [], into: RenderCall[], file = ''): void => {
    for (const node of nodes) {
      if (isBlockLoop(node)) { slots.push(...slotsOf(node)); continue }
      const name = staticRenderName(node, source)
      if (name) into.push({ name, file, line: lineAt(source, node.position?.start ?? 0) })
      if (node.type === 'LiquidTag' && node.name === 'content_for' && node.position && /content_for\s+['"]blocks['"]/.test(source.slice(node.position.start, node.position.end))) contentForBlocks = true
      collect(node.children, into)
    }
  }

  const slotsOf = (loop: Node): Slot[] => {
    const body = (loop.children ?? []).filter((branch) => branch.name !== 'else').flatMap((branch) => branch.children ?? [])
    const caseTag = findCase(body)
    const at = (node: Node): number => lineAt(source, node.position?.start ?? loop.position?.start ?? 0)
    if (!caseTag) {
      const renderCalls: RenderCall[] = []
      collect(body, renderCalls)
      return [{ types: null, roots: usableRoots(topElements(body)), renders: unique(renderCalls.map((call) => call.name)), renderCalls, line: at(loop) }]
    }
    return (caseTag.children ?? []).filter((branch) => branch.name === 'when').map((branch) => {
      const renderCalls: RenderCall[] = []
      collect(branch.children, renderCalls)
      const types = (Array.isArray(branch.markup) ? branch.markup as Node[] : []).map((value) => String(value.value)).filter((value) => NAME.test(value))
      return { types, roots: usableRoots(topElements(branch.children)), renders: unique(renderCalls.map((call) => call.name)), renderCalls, line: at(branch) }
    })
  }

  const renderCalls: RenderCall[] = []
  collect(ast.children, renderCalls)
  return { roots: usableRoots(topElements(ast.children)), renders: unique(renderCalls.map((call) => call.name)), renderCalls, slots, contentForBlocks }
}

const cache = new Map<string, { mtime: number; graph: FileGraph }>()

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

  for (const slot of graph.slots) {
    const children = await snippetExpectations(root, withFile(slot.renderCalls), depth + 1, trail)
    if (!slot.roots.length) { out.push(...children); continue }
    for (const type of slot.types ?? [null]) {
      const instances = blocks.filter((block) => !type || block.type === type).map(({ id, type: blockType, settings, sourceFile, sourceLine }) => ({ id, type: blockType, settings, sourceFile, sourceLine }))
      out.push({ kind: 'block', file, line: slot.line, label: type ?? 'block', roots: slot.roots, children, instances })
    }
  }

  if (graph.contentForBlocks && depth <= MAX_DEPTH) {
    for (const type of unique(blocks.map((block) => block.type))) {
      const blockFile = `blocks/${type}.liquid`
      const blockGraph = await loadGraph(root, blockFile)
      if (!blockGraph) continue
      const same = blocks.filter((block) => block.type === type)
      const children = await childExpectations(root, blockFile, blockGraph, same.flatMap((block) => block.blocks), depth + 1, trail)
      if (!blockGraph.roots.length) { out.push(...children); continue }
      out.push({ kind: 'block', file: blockFile, line: 1, label: type, roots: blockGraph.roots, children, instances: same.map(({ id, type: blockType, settings, sourceFile, sourceLine }) => ({ id, type: blockType, settings, sourceFile, sourceLine })) })
    }
  }
  return out
}

/** The components a section may contain, found by reading its Liquid and following the snippets and blocks it renders. */
export async function sectionExpectations(root: string, file: string, blocks: JsonBlock[] = []): Promise<Expectation[]> {
  const graph = await loadGraph(root, file)
  return graph ? childExpectations(root, file, graph, blocks, 0, []) : []
}
