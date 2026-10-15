import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const PACKAGE_NAME = '@display-studio/vite-plugin-shopify-devtools'
const CONFIG_NAMES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']
const MIRROR_IGNORE = '.shopify-devtools/'

export function findViteConfig(root: string): string | undefined {
  return CONFIG_NAMES.map((name) => path.join(root, name)).find((file) => existsSync(file))
}

/** Index just past the bracket that closes the one at `open`, skipping strings and comments. */
function closingIndex(source: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
  const stack: string[] = []
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (char === '"' || char === "'" || char === '`') {
      for (index++; index < source.length && source[index] !== char; index++) if (source[index] === '\\') index++
    } else if (char === '/' && source[index + 1] === '/') index = source.indexOf('\n', index) < 0 ? source.length : source.indexOf('\n', index)
    else if (char === '/' && source[index + 1] === '*') index = source.indexOf('*/', index) < 0 ? source.length : source.indexOf('*/', index) + 1
    else if (pairs[char]) stack.push(pairs[char])
    else if (char === stack.at(-1)) { stack.pop(); if (!stack.length) return index + 1 }
  }
  return -1
}

export interface ConfigPatch { source: string, changed: boolean, manual?: string }

export const MANUAL_SETUP = `import shopifyDevtools, { shopifyDevtoolsConfig } from '${PACKAGE_NAME}'

export default defineConfig({
  devtools: shopifyDevtoolsConfig,
  plugins: [/* your plugins, */ shopifyDevtools()],
})`

/**
 * Adds the import, the `devtools` preset and the plugin to a config shaped like `defineConfig({ plugins: [...] })`.
 * Anything else (a function config, a missing `plugins` array) is left alone and reported as manual work.
 */
export function patchViteConfig(source: string): ConfigPatch {
  const hasImport = source.includes(PACKAGE_NAME)
  const hasPreset = /\bdevtools\s*:/.test(source)
  const hasPlugin = /\bshopifyDevtools\s*\(/.test(source)
  if (hasImport && hasPreset && hasPlugin) return { source, changed: false }
  const call = /defineConfig\(\s*\{/.exec(source)
  if (!call) return { source, changed: false, manual: 'The config is not a plain `defineConfig({ ... })` object.' }
  const objectStart = call.index + call[0].length - 1
  const objectEnd = closingIndex(source, objectStart)
  const plugins = /\bplugins\s*:\s*\[/.exec(source.slice(objectStart, objectEnd))
  if (objectEnd < 0 || (!hasPlugin && !plugins)) return { source, changed: false, manual: 'No `plugins: [...]` array was found in the config.' }
  const edits: Array<{ at: number, text: string }> = []
  if (!hasPreset) edits.push({ at: objectStart + 1, text: '\n  devtools: shopifyDevtoolsConfig,' })
  if (!hasPlugin && plugins) {
    const open = objectStart + plugins.index + plugins[0].length - 1
    const close = closingIndex(source, open) - 1
    const empty = source.slice(open + 1, close).trim() === ''
    const trailing = /,\s*$/.test(source.slice(open + 1, close))
    edits.push({ at: close, text: `${empty || trailing ? '' : ', '}shopifyDevtools()` })
  }
  let patched = source
  for (const edit of edits.sort((a, b) => b.at - a.at)) patched = patched.slice(0, edit.at) + edit.text + patched.slice(edit.at)
  if (!hasImport) {
    const imports = [...patched.matchAll(/^import[^;\n]*(?:from\s+)?['"][^'"]+['"];?[ \t]*$/gm)]
    const line = `import shopifyDevtools, { shopifyDevtoolsConfig } from '${PACKAGE_NAME}'${/;\s*$/.test(imports.at(-1)?.[0] ?? '') ? ';' : ''}\n`
    const last = imports.at(-1)
    const at = last ? last.index + last[0].length + 1 : 0
    patched = patched.slice(0, at) + line + patched.slice(at)
  }
  return { source: patched, changed: true }
}

export function patchGitignore(source: string): ConfigPatch {
  if (source.split(/\r?\n/).some((line) => /^\/?\.shopify-devtools\/?$/.test(line.trim()))) return { source, changed: false }
  const separator = source === '' || source.endsWith('\n') ? '' : '\n'
  return { source: `${source}${separator}\n# Shopify DevTools instrumented theme mirror\n${MIRROR_IGNORE}\n`, changed: true }
}

export interface InitResult { config?: string, configChanged: boolean, gitignoreChanged: boolean, manual?: string }

export function initProject(root: string): InitResult {
  const config = findViteConfig(root)
  if (!config) return { configChanged: false, gitignoreChanged: false, manual: 'No vite.config.{ts,mts,js,mjs} found in the current directory.' }
  const patch = patchViteConfig(readFileSync(config, 'utf8'))
  if (patch.changed) writeFileSync(config, patch.source)
  const gitignorePath = path.join(root, '.gitignore')
  const ignore = patchGitignore(existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '')
  if (ignore.changed) writeFileSync(gitignorePath, ignore.source)
  return { config, configChanged: patch.changed, gitignoreChanged: ignore.changed, manual: patch.manual }
}
