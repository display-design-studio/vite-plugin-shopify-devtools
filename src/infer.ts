import type { Expectation, RootPattern, Signature } from './graph.js'
import type { ComponentNode } from './inspector.js'

export interface InferContext {
  /** Hands out the n-th occurrence of a component id, so every node of the page has a unique key. */
  occurrence(id: string): number
  diagnostics?: MissingSnippet[]
}

export type InferenceConfidence = 'high' | 'medium' | 'low'
export type MissingSnippetReason = 'Root cannot be recognised' | 'No matching DOM element' | 'Ambiguous DOM match'
export interface MissingSnippet {
  file: string
  callSiteFile?: string
  callSiteLine?: number
  reason: MissingSnippetReason
}

const signatureWeight = (signature: Signature): number => signature.classes.length + 2 * Object.keys(signature.attrs).length
const patternsOf = (expectation: Expectation): RootPattern[] => {
  const roots = expectation.roots
  return roots.length && !Array.isArray(roots[0]) ? [(roots as Signature[])] : roots as RootPattern[]
}
const weightOf = (expectation: Expectation): number => Math.max(0, ...patternsOf(expectation).map((pattern) => pattern.reduce((sum, root) => sum + signatureWeight(root), 0)))
const sizeOf = (expectation: Expectation): number => expectation.children.reduce((total, child) => total + 1 + sizeOf(child), 0)

/** More specific markup wins an element; between equals, the component that contains more explains more. */
const better = (a: Expectation, b: Expectation): boolean => weightOf(a) > weightOf(b) || (weightOf(a) === weightOf(b) && sizeOf(a) > sizeOf(b))

export function matchesSignature(element: Element, signature: Signature): boolean {
  if (element.localName !== signature.tag) return false
  if (!signature.classes.every((token) => element.classList.contains(token))) return false
  return Object.entries(signature.attrs).every(([name, value]) => element.getAttribute(name) === value)
}

const inDocumentOrder = (a: Element, b: Element): number => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1

interface ElementIndex {
  byTag: Map<string, Element[]>
  all: Element[]
  query(scopes: Element[], tag: string): Element[]
}

function createIndex(scope: Element): ElementIndex {
  const byTag = new Map<string, Element[]>()
  const all = [...scope.querySelectorAll('*')]
  for (const element of all) {
    const list = byTag.get(element.localName) ?? []
    list.push(element); byTag.set(element.localName, list)
  }
  const cache = new WeakMap<Element, Map<string, Element[]>>()
  return { byTag, all, query(scopes, tag) {
    if (scopes.length !== 1) return (byTag.get(tag) ?? []).filter((element) => scopes.some((item) => item !== element && item.contains(element)))
    let tags = cache.get(scopes[0]); if (!tags) { tags = new Map(); cache.set(scopes[0], tags) }
    const cached = tags.get(tag); if (cached) return cached
    const found = (byTag.get(tag) ?? []).filter((element) => scopes[0] !== element && scopes[0].contains(element)); tags.set(tag, found); return found
  } }
}

function findMatches(scopes: Element[], expectation: Expectation, claimed: Set<Element>, index: ElementIndex): Element[][] {
  const found: Element[][] = []
  const matchesIdentity = (element: Element): boolean => {
    const raw = element.getAttribute('data-shopify-editor-block')
    try {
      const identity = JSON.parse(raw ?? '') as { id?: unknown; type?: unknown }
      return !!expectation.instances?.some((instance) => instance.id === identity.id && instance.type === identity.type)
    } catch { return false }
  }
  for (const pattern of patternsOf(expectation)) {
    const first = pattern[0]
    if (!first) continue
    for (const element of index.query(scopes, first.tag)) {
      if (claimed.has(element) || !matchesSignature(element, first)) continue
      const group = [element]
      let next: Element | null = element
      for (const signature of pattern.slice(1)) {
        next = next.nextElementSibling
        if (!next || !matchesSignature(next, signature) || claimed.has(next)) { next = null; break }
        group.push(next)
      }
      if (next && (!expectation.shopifyAttributes || !element.hasAttribute('data-shopify-editor-block') || matchesIdentity(element))) found.push(group)
    }
  }
  if (expectation.shopifyAttributes) {
    for (const element of index.all.filter((candidate) => scopes.some((scope) => scope !== candidate && scope.contains(candidate)))) {
      if (claimed.has(element)) continue
      if (element.hasAttribute('data-shopify-editor-block') && matchesIdentity(element)) found.push([element])
    }
  }
  const unique = found.filter((group, at) => found.findIndex((other) => other.length === group.length && other.every((item, index) => item === group[index])) === at)
  const generic = patternsOf(expectation).every((pattern) => pattern.every((root) => signatureWeight(root) === 0))
  if (generic) {
    const cardinality = expectation.instances?.length || expectation.callSites?.length
    if (unique.length !== (cardinality ?? 1)) return []
  }
  return unique
}

function confidenceFor(expectation: Expectation, roots: Element[]): { level: InferenceConfidence, reason: string } {
  const element = roots[0]
  if (expectation.shopifyAttributes && element.hasAttribute('data-shopify-editor-block')) {
    return { level: 'high', reason: 'Matched Shopify block ID and type.' }
  }
  const signature = patternsOf(expectation).flat().find((candidate) => matchesSignature(element, candidate))
  if (roots.length > 1) return { level: 'high', reason: `Matched an ordered sequence of ${roots.length} sibling roots.` }
  const attributes = signature ? Object.keys(signature.attrs) : []
  if (attributes.length) return { level: 'high', reason: `Matched distinctive static ${attributes.length === 1 ? 'attribute' : 'attributes'}: ${attributes.join(', ')}.` }
  if ((signature?.classes.length ?? 0) > 1) return { level: 'medium', reason: `Matched ${signature!.classes.length} static classes.` }
  if (signature && signatureWeight(signature) === 0) return { level: 'medium', reason: 'Matched a unique tag-only root in the expected scope.' }
  return { level: 'low', reason: `Matched one static class: ${signature?.classes[0] ?? 'unknown'}.` }
}

function reportMissing(context: InferContext, expectation: Expectation, reason: MissingSnippetReason): void {
  if (expectation.kind !== 'snippet' || !context.diagnostics) return
  const sites = expectation.callSites?.length ? expectation.callSites : [undefined]
  for (const site of sites) {
    const diagnostic: MissingSnippet = { file: expectation.file, callSiteFile: site?.file, callSiteLine: site?.line, reason }
    if (!context.diagnostics.some((item) => item.file === diagnostic.file && item.callSiteFile === diagnostic.callSiteFile && item.callSiteLine === diagnostic.callSiteLine && item.reason === diagnostic.reason)) context.diagnostics.push(diagnostic)
  }
}

/**
 * Finds, inside `scope`, the elements that the expected components would have rendered, and nests the
 * components they may contain. It guesses from static markup alone, so every node is marked as inferred.
 */
export function inferNodes(scope: Element, expectations: Expectation[], context: InferContext, parent: ComponentNode | null, claimed: Set<Element> = new Set()): ComponentNode[] {
  return inferInScopes([scope], expectations, context, parent, claimed, createIndex(scope))
}

function inferInScopes(scopes: Element[], expectations: Expectation[], context: InferContext, parent: ComponentNode | null, claimed: Set<Element>, index: ElementIndex): ComponentNode[] {
  const matchable: Expectation[] = []
  const collect = (items: Expectation[]): void => {
    for (const expectation of items) {
      if (!expectation.transparent) matchable.push(expectation)
      else { reportMissing(context, expectation, 'Root cannot be recognised'); collect(expectation.children) }
    }
  }
  collect(expectations)
  const owners = new Map<Element, { expectation: Expectation, group: Element[] }>()
  const ambiguous = new Set<Element[]>()
  const ambiguousExpectations = new Set<Expectation>()
  for (const expectation of matchable) {
    for (const group of findMatches(scopes, expectation, claimed, index)) {
      const conflicts = group.map((element) => owners.get(element)).filter((item): item is NonNullable<typeof item> => !!item)
      const current = conflicts[0]
      if (!current) for (const element of group) owners.set(element, { expectation, group })
      else if (better(expectation, current.expectation)) { for (const element of current.group) owners.delete(element); for (const element of group) owners.set(element, { expectation, group }) }
      // Two different components with identical markup: better to show nothing than to guess wrong.
      else if (!better(current.expectation, expectation) && (current.expectation.file !== expectation.file || current.expectation.label !== expectation.label)) {
        ambiguous.add(current.group); ambiguous.add(group); ambiguousExpectations.add(current.expectation); ambiguousExpectations.add(expectation)
      }
    }
  }

  // Outer elements first: a component claims the elements inside it before the caller can, so a button
  // rendered by a card is not mistaken for a button the section rendered itself.
  const seen = new Map<Expectation, number>()
  const nodes: ComponentNode[] = []
  const groups = [...new Set([...owners.values()])].sort((a, b) => inDocumentOrder(a.group[0], b.group[0]))
  for (const { group, expectation } of groups) {
    if (group.some((element) => claimed.has(element)) || ambiguous.has(group)) continue
    for (const element of group) claimed.add(element)
    const instanceIndex = seen.get(expectation) ?? 0
    seen.set(expectation, instanceIndex + 1)
    const instance = expectation.instances?.[instanceIndex]
    const callSite = expectation.callSites?.[instanceIndex] ?? expectation.callSites?.[0]
    const id = `${expectation.kind}:${expectation.file}${expectation.label ? `:${expectation.label}` : ''}`
    const confidence = confidenceFor(expectation, group)
    const node: ComponentNode = {
      id,
      kind: expectation.kind,
      file: expectation.file,
      line: expectation.line,
      start: null,
      end: null,
      roots: group,
      parent,
      children: [],
      occurrence: context.occurrence(id),
      shopifyId: instance?.id,
      inferred: true,
      inferenceConfidence: confidence.level,
      inferenceReason: confidence.reason,
      label: expectation.label ? `${expectation.label}${instance ? ` · ${instance.id}` : ''}` : undefined,
      settings: instance?.settings,
      instanceSourceFile: instance?.sourceFile,
      instanceSourceLine: instance?.sourceLine,
      callSiteFile: callSite?.file,
      callSiteLine: callSite?.line,
      app: expectation.app,
      appType: expectation.appType,
    }
    node.children = inferInScopes(group, expectation.children, context, node, claimed, index)
    nodes.push(node)
  }
  for (const expectation of matchable) {
    if (expectation.kind !== 'snippet' || seen.has(expectation)) continue
    reportMissing(context, expectation, ambiguousExpectations.has(expectation) ? 'Ambiguous DOM match' : 'No matching DOM element')
  }
  return nodes
}

/** Position of an element as child indexes from the root, stable between two renders of the same page. */
export function elementPath(element: Element): string {
  const parts: number[] = []
  for (let current: Element | null = element; current?.parentElement; current = current.parentElement) {
    parts.push([...current.parentElement.children].indexOf(current))
  }
  return parts.reverse().join('/')
}

const flatten = (nodes: ComponentNode[]): ComponentNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)])
const comparable = (node: ComponentNode): boolean => node.file.startsWith('snippets/') || node.file.startsWith('blocks/')
const keyOf = (node: ComponentNode): string => `${node.file}|${node.roots[0] ? elementPath(node.roots[0]) : ''}`

export interface InferenceReport {
  precision: number
  recall: number
  matched: number
  extra: string[]
  missed: string[]
}

/** Keys of the snippets and theme blocks in a tree; take them while the page they belong to is still in the document. */
export function treeKeys(nodes: ComponentNode[]): string[] {
  return [...new Set(flatten(nodes).filter(comparable).map(keyOf))]
}

/**
 * Scores an inferred tree against the exact one that markers give. Inline blocks have no markers, so
 * only snippets and theme blocks are compared.
 */
export function compareKeys(truth: string[], inferred: string[]): InferenceReport {
  const expected = new Set(truth)
  const matched = inferred.filter((key) => expected.has(key)).length
  return {
    precision: inferred.length ? matched / inferred.length : 1,
    recall: expected.size ? matched / expected.size : 1,
    matched,
    extra: inferred.filter((key) => !expected.has(key)),
    missed: truth.filter((key) => !inferred.includes(key)),
  }
}

export const compareTrees = (truth: ComponentNode[], inferred: ComponentNode[]): InferenceReport => compareKeys(treeKeys(truth), treeKeys(inferred))
