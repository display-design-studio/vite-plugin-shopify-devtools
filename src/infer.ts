import type { Expectation, Signature } from './graph.js'
import type { ComponentNode } from './inspector.js'

export interface InferContext {
  /** Hands out the n-th occurrence of a component id, so every node of the page has a unique key. */
  occurrence(id: string): number
}

const signatureWeight = (signature: Signature): number => signature.classes.length + 2 * Object.keys(signature.attrs).length
const weightOf = (expectation: Expectation): number => Math.max(...expectation.roots.map(signatureWeight))
const sizeOf = (expectation: Expectation): number => expectation.children.reduce((total, child) => total + 1 + sizeOf(child), 0)

/** More specific markup wins an element; between equals, the component that contains more explains more. */
const better = (a: Expectation, b: Expectation): boolean => weightOf(a) > weightOf(b) || (weightOf(a) === weightOf(b) && sizeOf(a) > sizeOf(b))

export function matchesSignature(element: Element, signature: Signature): boolean {
  if (element.localName !== signature.tag) return false
  if (!signature.classes.every((token) => element.classList.contains(token))) return false
  return Object.entries(signature.attrs).every(([name, value]) => element.getAttribute(name) === value)
}

const inDocumentOrder = (a: Element, b: Element): number => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1

function findMatches(scope: Element, expectation: Expectation, claimed: Set<Element>): Element[] {
  const found = new Set<Element>()
  for (const tag of new Set(expectation.roots.map((signature) => signature.tag))) {
    for (const element of scope.getElementsByTagName(tag)) {
      if (!claimed.has(element) && expectation.roots.some((signature) => matchesSignature(element, signature))) found.add(element)
    }
  }
  return [...found]
}

/**
 * Finds, inside `scope`, the elements that the expected components would have rendered, and nests the
 * components they may contain. It guesses from static markup alone, so every node is marked as inferred.
 */
export function inferNodes(scope: Element, expectations: Expectation[], context: InferContext, parent: ComponentNode | null, claimed: Set<Element> = new Set()): ComponentNode[] {
  const owners = new Map<Element, Expectation>()
  const ambiguous = new Set<Element>()
  for (const expectation of expectations) {
    for (const element of findMatches(scope, expectation, claimed)) {
      const current = owners.get(element)
      if (!current) owners.set(element, expectation)
      else if (better(expectation, current)) { owners.set(element, expectation); ambiguous.delete(element) }
      // Two different components with identical markup: better to show nothing than to guess wrong.
      else if (!better(current, expectation) && (current.file !== expectation.file || current.label !== expectation.label)) ambiguous.add(element)
    }
  }

  // Outer elements first: a component claims the elements inside it before the caller can, so a button
  // rendered by a card is not mistaken for a button the section rendered itself.
  const seen = new Map<Expectation, number>()
  const nodes: ComponentNode[] = []
  for (const [element, expectation] of [...owners].sort(([a], [b]) => inDocumentOrder(a, b))) {
    if (claimed.has(element) || ambiguous.has(element)) continue
    claimed.add(element)
    const index = seen.get(expectation) ?? 0
    seen.set(expectation, index + 1)
    const instance = expectation.instances?.[index]
    const callSite = expectation.callSites?.[index] ?? expectation.callSites?.[0]
    const id = `${expectation.kind}:${expectation.file}${expectation.label ? `:${expectation.label}` : ''}`
    const node: ComponentNode = {
      id,
      kind: expectation.kind,
      file: expectation.file,
      line: expectation.line,
      start: null,
      end: null,
      roots: [element],
      parent,
      children: [],
      occurrence: context.occurrence(id),
      shopifyId: instance?.id,
      inferred: true,
      label: expectation.label ? `${expectation.label}${instance ? ` · ${instance.id}` : ''}` : undefined,
      settings: instance?.settings,
      instanceSourceFile: instance?.sourceFile,
      instanceSourceLine: instance?.sourceLine,
      callSiteFile: callSite?.file,
      callSiteLine: callSite?.line,
    }
    node.children = inferNodes(element, expectation.children, context, node, claimed)
    nodes.push(node)
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
