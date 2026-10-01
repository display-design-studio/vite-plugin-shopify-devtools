import { readFileSync } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import launchEditorProcess from 'launch-editor'
import { defineRpcFunction } from '@vitejs/devtools-kit'
import { defaultAllowedOrigins, type Plugin, type ViteDevServer } from 'vite'
import { INSPECT_ICON } from './inspect-icon.js'

const CLIENT_ID = '\0virtual:shopify-devtools/client'
const RENDERER_PUBLIC_ID = 'virtual:shopify-devtools/renderer'
const RENDERER_ID = `\0${RENDERER_PUBLIC_ID}`
const RENDERER_URL = `/@id/__x00__${RENDERER_PUBLIC_ID}`
const ACTION_PUBLIC_ID = 'virtual:shopify-devtools/action'
const ACTION_ID = `\0${ACTION_PUBLIC_ID}`
const ACTION_URL = `/@id/__x00__${ACTION_PUBLIC_ID}`
const svgDataUri = (name: string): string => {
  const source = readFileSync(new URL(`../assets/shopify/${name}`, import.meta.url))
  return `data:image/svg+xml;base64,${source.toString('base64')}`
}

const SHOPIFY_GLYPH = {
  light: svgDataUri('shopify-glyph-black.svg'),
  dark: svgDataUri('shopify-glyph-white.svg'),
} as const

export const shopifyDevtoolsBranding = {
  productName: 'Shopify Liquid DevTools',
  logo: SHOPIFY_GLYPH,
  wordmark: SHOPIFY_GLYPH,
  favicon: SHOPIFY_GLYPH.light,
  primaryColor: '#5e8e3e',
  windowTitle: 'Shopify Liquid DevTools',
} as const

export interface ShopifyDevtoolsOptions {
  entry?: string
  editor?: string
  allowedOrigins?: string[]
}

export function isAllowedOrigin(origin: string | undefined, server: Pick<ViteDevServer, 'config'>, configured: string[]): boolean {
  if (!origin) return true
  if (configured.includes(origin)) return true
  try {
    const parsed = new URL(origin)
    const host = server.config.server.host
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return true
    if (process.env.SHOPIFY_STORE_DOMAIN === parsed.hostname) return true
    return typeof host === 'string' && parsed.hostname === host
  } catch { return false }
}

export async function resolveThemeFile(root: string, file: string): Promise<string> {
  const resolvedRoot = await realpath(root)
  const candidate = await realpath(path.resolve(root, file))
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('File is outside the theme root')
  return candidate
}

export async function launchEditor(root: string, file: string, line: number, editor?: string): Promise<string> {
  const candidate = await resolveThemeFile(root, file)
  const configuredEditor = editor || process.env.SHOPIFY_DEVTOOLS_EDITOR || process.env.EDITOR
  const specifiedEditor = configuredEditor || await findInstalledMacEditor()
  const target = `${candidate}:${line}:1`
  await launchOnce(target, specifiedEditor)
  return candidate
}

async function launchOnce(target: string, editor?: string): Promise<void> {
  if (editor?.endsWith('/Zed.app/Contents/MacOS/cli')) {
    await launchZedCli(editor, target)
    return
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error); else resolve()
    }
    const timer = setTimeout(() => finish(), 500)
    launchEditorProcess(target, editor, (_file, message) => {
      finish(new Error(message || 'No supported editor could be detected. Configure the editor option or SHOPIFY_DEVTOOLS_EDITOR.'))
    })
  })
}

async function launchZedCli(editor: string, target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [target], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Zed editor exited with code ${code ?? 'unknown'}`))
    })
  })
}

async function findInstalledMacEditor(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return
  const candidates = [
    '/usr/local/bin/zed',
    '/opt/homebrew/bin/zed',
    '/opt/local/bin/zed',
    '/Applications/Zed.app/Contents/MacOS/cli',
    '/Applications/Cursor.app/Contents/MacOS/Cursor',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ]
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Try the next supported editor. */ }
  }
}

export default function shopifyDevtools(options: ShopifyDevtoolsOptions = {}): Plugin {
  const entry = options.entry ?? 'frontend/entrypoints/ts/theme.ts'
  let serve = false
  return {
    name: 'vite-plugin-shopify-devtools',
    enforce: 'pre',
    apply: 'serve',
    config() {
      if (!options.allowedOrigins?.length) return
      return { server: { cors: { origin: [defaultAllowedOrigins, ...options.allowedOrigins] } } }
    },
    devtools: {
      setup(context) {
        // Vite's built-in group uses an absolute /__devtools-assets URL. In a
        // Shopify-hosted document that URL targets Shopify instead of Vite.
        context.docks.register({
          id: 'viteplus',
          type: 'group',
          title: 'Vite+',
          category: 'framework',
          icon: 'ph:lightning-duotone',
          visibility: 'false',
        }, true)
        context.docks.register({
          id: 'shopify-liquid',
          title: 'Shopify Liquid',
          icon: SHOPIFY_GLYPH,
          type: 'custom-render',
          category: 'app',
          renderer: {
            importFrom: RENDERER_URL,
            importName: 'default',
          },
        })
        context.docks.register({
          id: 'shopify-liquid:inspect',
          title: 'Inspect Liquid component',
          icon: INSPECT_ICON,
          type: 'action',
          category: 'app',
          action: {
            importFrom: ACTION_URL,
            importName: 'default',
          },
        })
        context.rpc.register(defineRpcFunction({
          name: 'shopify-devtools:open-in-editor',
          type: 'action',
          setup: () => ({
            handler: async (input: { file: string; line: number }) => {
              if (!input || typeof input.file !== 'string' || !Number.isInteger(input.line) || input.line < 1) throw new Error('Invalid payload')
              const file = await launchEditor(context.viteConfig.root, input.file, input.line, options.editor)
              return { ok: true as const, file, line: input.line }
            },
          }),
        }) as never)
      },
    },
    configResolved(config) { serve = config.command === 'serve' },
    resolveId(id) {
      if (id === 'virtual:shopify-devtools/client') return CLIENT_ID
      if (id === RENDERER_PUBLIC_ID || id === RENDERER_ID) return RENDERER_ID
      if (id === ACTION_PUBLIC_ID || id === ACTION_ID) return ACTION_ID
    },
    load(id) {
      if (id === CLIENT_ID) return `const origin=new URL(import.meta.url).origin;const connectionUrl=origin+'/__devtools/__connection.json';const connectionResponse=await fetch(connectionUrl);if(!connectionResponse.ok)throw new Error('Unable to load Vite DevTools connection metadata ('+connectionResponse.status+')');const connectionMeta=await connectionResponse.json();globalThis.__DEVFRAME_CONNECTION__={connectionMeta,metaBaseUrl:connectionResponse.url||connectionUrl,authToken:connectionMeta.authToken};const devtoolsClient=origin+'/__devtools/embedded.js';await import(/* @vite-ignore */devtoolsClient);`
      if (id === RENDERER_ID) return `export { default } from ${JSON.stringify(new URL('./client.js', import.meta.url).href)};`
      if (id === ACTION_ID) return `export { default } from ${JSON.stringify(new URL('./action.js', import.meta.url).href)};`
    },
    transform(code, id) {
      if (!serve) return
      const clean = id.split('?')[0].split(path.sep).join('/')
      if (!clean.endsWith(entry.split(path.sep).join('/'))) return
      return { code: `import 'virtual:shopify-devtools/client';\n${code}`, map: null }
    },
  }
}

export { createThemeMirror } from './mirror.js'
export { instrumentLiquid } from './instrument.js'
