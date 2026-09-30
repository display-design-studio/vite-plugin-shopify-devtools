import { toLiquidHtmlAST } from '@shopify/liquid-html-parser'
import path from 'node:path'
import { encodeMarker, type ComponentKind, type ComponentSource } from './protocol.js'

interface Position { start: number; end: number }
interface AstNode { type?: string; name?: unknown; position?: Position; source?: string; [key: string]: unknown }

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length
}

function boundary(direction: 'start' | 'end', source: ComponentSource): string {
  return `<!--shopify-devtools:${direction}:${encodeMarker(source)}-->`
}

function kindFor(relativePath: string): ComponentKind | undefined {
  if (relativePath.startsWith('sections/')) return 'section'
  if (relativePath.startsWith('blocks/')) return 'block'
  return undefined
}

function staticRenderName(node: AstNode, source: string): string | undefined {
  if (node.type !== 'LiquidTag' || node.name !== 'render' || !node.position) return
  const raw = source.slice(node.position.start, node.position.end)
  const match = raw.match(/\{%-?\s*render\s+(['"])([^'"{}]+)\1/)
  return match?.[2]
}

function inUnsafeHtmlContext(source: string, offset: number): boolean {
  const prefix = source.slice(0, offset)
  const tokens = [...prefix.matchAll(/<\/?(script|style)(?:\s[^>]*)?>|\{%\s*(schema|javascript|stylesheet)\b|\{%\s*end(schema|javascript|stylesheet)\s*%\}/gi)]
  let unsafe = false
  for (const token of tokens) {
    if (/^<\//.test(token[0]) || /\{%\s*end/i.test(token[0])) unsafe = false
    else unsafe = true
  }
  return unsafe
}

function walk(value: unknown, visit: (node: AstNode) => void, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return
  seen.add(value as object)
  if (!Array.isArray(value)) visit(value as AstNode)
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visit, seen)
}

export function instrumentLiquid(source: string, relativePath: string): string {
  const normalized = relativePath.split(path.sep).join('/')
  const rootKind = kindFor(normalized)
  const edits: Array<{ at: number; text: string; order: number }> = []
  let ast: unknown
  try { ast = toLiquidHtmlAST(source, { mode: 'tolerant', allowUnclosedDocumentNode: true }) } catch { ast = undefined }

  if (ast) {
    walk(ast, (node) => {
      const name = staticRenderName(node, source)
      if (!name || !node.position || inUnsafeHtmlContext(source, node.position.start)) return
      const component: ComponentSource = {
        id: `snippet:${name}:${node.position.start}`,
        kind: 'snippet',
        file: `snippets/${name}.liquid`,
        line: 1,
      }
      edits.push({ at: node.position.start, text: boundary('start', component), order: 1 })
      edits.push({ at: node.position.end, text: boundary('end', component), order: 0 })
    })
  }

  let result = source
  for (const edit of edits.sort((a, b) => b.at - a.at || a.order - b.order)) {
    result = result.slice(0, edit.at) + edit.text + result.slice(edit.at)
  }

  if (rootKind) {
    const component: ComponentSource = {
      id: `${rootKind}:${normalized}`,
      kind: rootKind,
      file: normalized,
      line: lineAt(source, 0),
    }
    result = `${boundary('start', component)}${result}${boundary('end', component)}`
  }
  return result
}
