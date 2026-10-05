import { defineRpcFunction } from '@vitejs/devtools-kit'
import launchEditorProcess from 'launch-editor'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import path from 'node:path'
import { defaultAllowedOrigins, loadEnv, version as viteVersion, type Plugin, type ViteDevServer } from 'vite'
import { INSPECT_ICON } from './inspect-icon.js'
import { resolveSections } from './sections.js'
import { invalidateGraph } from './graph.js'
import { createThemeMirror, type ThemeMirror } from './mirror.js'
import { instrumentInPlace, recoverInPlace, type InPlaceInstrumentation } from './in-place.js'

const CLIENT_ID = '\0virtual:shopify-devtools/client'
const RENDERER_PUBLIC_ID = 'virtual:shopify-devtools/renderer'
const RENDERER_ID = `\0${RENDERER_PUBLIC_ID}`
const RENDERER_URL = `/@id/__x00__${RENDERER_PUBLIC_ID}`
const ACTION_PUBLIC_ID = 'virtual:shopify-devtools/action'
const ACTION_ID = `\0${ACTION_PUBLIC_ID}`
const ACTION_URL = `/@id/__x00__${ACTION_PUBLIC_ID}`
// Collapsed, Vite DevTools shows its logo at 12px (`w-3 h-3`) in a 22px pill. The open dock is
// `barHeight` tall (34px) with 20px icons (`w-5 h-5`) and a .5rem radius; a square of that height
// with a 20px centered logo keeps the same size and padding.
const DOCK_CSS = '.bg-dock-glass,#devframes-anchor #devframes-dock{background-color:#fff;backdrop-filter:none}.dark .bg-dock-glass,.dark #devframes-anchor #devframes-dock{background-color:#111}#devframes-anchor.devframes-minimized #devframes-dock{--devframes-dock-minimized-size:var(--devframes-dock-height,34px);border-radius:.5rem}#devframes-anchor.devframes-minimized #devframes-dock>div:first-child{width:20px;height:20px}'
const MINIMIZED_SIZE_SCRIPT = `const applyMinimizedSize=()=>{const host=document.querySelector('devframes-dock-embedded');if(!host?.shadowRoot)return false;if(!host.shadowRoot.querySelector('style[data-shopify-devtools]')){const style=document.createElement('style');style.dataset.shopifyDevtools='';style.textContent=${JSON.stringify(DOCK_CSS)};host.shadowRoot.append(style)}return true};if(!applyMinimizedSize()){const observer=new MutationObserver(()=>{if(applyMinimizedSize())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),10000)}`
const svgDataUri = (name: string): string => {
  const source = readFileSync(new URL(`../assets/shopify/${name}`, import.meta.url))
  return `data:image/svg+xml;base64,${source.toString('base64')}`
}

// The full-color bag reads on both themes, so light and dark share one file.
const SHOPIFY_GLYPH = {
  light: svgDataUri('shopify-glyph.svg'),
  dark: svgDataUri('shopify-glyph.svg'),
} as const

export const shopifyDevtoolsBranding = {
  productName: 'Shopify Liquid DevTools',
  logo: SHOPIFY_GLYPH,
  wordmark: SHOPIFY_GLYPH,
  favicon: SHOPIFY_GLYPH.light,
  primaryColor: '#4ac93e',
  tagline: 'DevTools for Shopify Liquid themes',
  windowTitle: 'Shopify Liquid DevTools',
} as const

/**
 * Preset for the `devtools` option of the Vite config. Vite reads `devtools`
 * before plugin `config` hooks run, so a plugin cannot set it for the user.
 */
export const shopifyDevtoolsConfig = {
  apply: 'serve',
  embeddedVisibility: 'normal',
  // Shopify serves the page from another origin: Vite+'s optional launchers use
  // root-relative icon URLs that would resolve against the Shopify origin.
  builtinDevTools: false,
  branding: shopifyDevtoolsBranding,
} as const

// Vite deep-clones the `devtools` option, so object identity cannot be compared.
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const MIN_VITE = { major: 8, minor: 3 }

/** Vite only reads the `devtools` option from 8.3; older versions ignore it and never serve `/__devtools/`. */
export function viteVersionWarning(version: string): string | undefined {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  if (major > MIN_VITE.major || (major === MIN_VITE.major && minor >= MIN_VITE.minor)) return
  return `Shopify Liquid DevTools requires Vite ${MIN_VITE.major}.${MIN_VITE.minor} or newer, but Vite ${version} is installed. This Vite version ignores the \`devtools\` option, so the DevTools connection returns 404. Upgrade \`vite\` in your project.`
}

export function devtoolsConfigWarning(devtools: unknown): string | undefined {
  const expected = 'Add `devtools: shopifyDevtoolsConfig` to your Vite config (import it from @display-studio/vite-plugin-shopify-devtools).'
  // Vite resolves the option to `{ enabled, apply, config }`; the preset itself sits under `config`.
  const wrapper = devtools as { enabled?: boolean, config?: object } | undefined
  if (!devtools || wrapper?.enabled === false) return `Vite DevTools is disabled, so Shopify Liquid DevTools will not appear. ${expected}`
  const resolved = (wrapper?.config ?? devtools) as { builtinDevTools?: boolean, branding?: { logo?: unknown } }
  if (resolved.builtinDevTools !== false || !sameValue(resolved.branding?.logo, shopifyDevtoolsBranding.logo)) {
    return `Vite DevTools needs inline branding and \`builtinDevTools: false\` on Shopify-hosted pages, otherwise icons request root-relative URLs from the Shopify origin. ${expected}`
  }
}

type DockEntry = { id: string; type?: string; url?: unknown }

/**
 * Iframe docks from other plugins (Vue DevTools 9, for one) point at a path on the Vite server, like
 * `/__devtools__/`. The page is served by Shopify, so the browser would request that path from Shopify.
 */
export function absoluteDockUrl(entry: DockEntry, origin: string): string | undefined {
  if (entry.type !== 'iframe' || typeof entry.url !== 'string') return
  if (!entry.url.startsWith('/') || entry.url.startsWith('//')) return
  return `${origin.replace(/\/+$/, '')}${entry.url}`
}

/** The origin the browser reaches the Vite server on: the configured public one, else where it listens. */
export function viteOrigin(server: Pick<ViteDevServer, 'config' | 'resolvedUrls'>): string | undefined {
  return server.config.server.origin ?? server.resolvedUrls?.local[0]
}

export interface ShopifyDevtoolsOptions {
  entry?: string
  editor?: string
  allowedOrigins?: string[]
  /** Exact marker mode. Copy is safe and recommended; in-place rewrites sources temporarily. */
  instrument?: false | 'copy' | 'in-place'
  /** Theme directory when it cannot be derived from vite-plugin-shopify's assets outDir. */
  themeRoot?: string
}

const SHOPIFY_CLI_ORIGINS = ['http://127.0.0.1:9292', 'http://localhost:9292']
const MYSHOPIFY_ORIGIN = /^https?:\/\/([^.]+\.)*myshopify\.com(:\d+)?$/

const storeOrigin = (store: string): string | undefined => {
  const host = store.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return host ? `https://${host}` : undefined
}

/** Origins that may load the DevTools bootstrap from Vite: Shopify CLI preview, the store, and user extras. */
export function resolveAllowedOrigins(root: string, env: Record<string, string | undefined>, extra: string[] = []): Array<string | RegExp> {
  const stores = [env.SHOPIFY_STORE_DOMAIN, env.SHOPIFY_FLAG_STORE]
  try {
    const toml = readFileSync(path.join(root, 'shopify.theme.toml'), 'utf8')
    for (const match of toml.matchAll(/^\s*store\s*=\s*["']([^"']+)["']/gm)) stores.push(match[1])
  } catch { /* No shopify.theme.toml: rely on env and defaults. */ }
  const origins = new Set<string>([...SHOPIFY_CLI_ORIGINS, ...extra])
  for (const store of stores) {
    const origin = store && storeOrigin(store)
    if (origin) origins.add(origin)
  }
  return [defaultAllowedOrigins, MYSHOPIFY_ORIGIN, ...origins]
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

/** vite-plugin-shopify builds into `<themeRoot>/assets`, so the theme root is the parent of that outDir. */
export function resolveThemeRoot(config: { root: string, build?: { outDir?: string } }): string {
  const outDir = config.build?.outDir && path.resolve(config.root, config.build.outDir)
  return outDir && path.basename(outDir) === 'assets' ? path.dirname(outDir) : config.root
}

const SCRIPT_ENTRY = /\.[cm]?[jt]sx?$/

const toPosix = (value: string): string => value.split(path.sep).join('/')

/** Collects the script entrypoints from Vite's resolved build input (as set by vite-plugin-shopify). */
export function resolveEntrypoints(root: string, build: { rollupOptions?: { input?: unknown }, rolldownOptions?: { input?: unknown } } | undefined): string[] {
  const input = build?.rolldownOptions?.input ?? build?.rollupOptions?.input
  const values = typeof input === 'string' ? [input]
    : Array.isArray(input) ? input
    : input && typeof input === 'object' ? Object.values(input)
    : []
  return values
    .filter((value): value is string => typeof value === 'string' && SCRIPT_ENTRY.test(value))
    .map((value) => toPosix(path.resolve(root, value)))
}

export default function shopifyDevtools(options: ShopifyDevtoolsOptions = {}): Plugin {
  const explicitEntry = options.entry ? toPosix(options.entry) : undefined
  let entrypoints = new Set<string>()
  let serve = false
  let docks: { views?: Map<string, unknown>; update(entry: never): void; events?: { on(event: 'docks:entry:updated', handler: (entry: DockEntry) => void): unknown } } | undefined
  let origin: string | undefined
  let broadcastSourcesChanged: (() => void) | undefined
  let instrumentation: ThemeMirror | InPlaceInstrumentation | undefined
  let instrumentationRoot: string | undefined
  const closeInstrumentation = async (): Promise<void> => {
    const active = instrumentation
    instrumentation = undefined
    await active?.close()
  }
  const fixDock = (entry: DockEntry): void => {
    const url = origin ? absoluteDockUrl(entry, origin) : undefined
    if (url) docks?.update({ ...entry, url } as never)
  }
  return {
    name: 'vite-plugin-shopify-devtools',
    enforce: 'pre',
    apply: 'serve',
    config(userConfig, { mode }) {
      const root = path.resolve(userConfig.root ?? process.cwd())
      const env = { ...loadEnv(mode, userConfig.envDir === false ? root : path.resolve(root, userConfig.envDir ?? ''), ''), ...process.env }
      return { server: { cors: { origin: resolveAllowedOrigins(root, env, options.allowedOrigins) } } }
    },
    devtools: {
      setup(context) {
        broadcastSourcesChanged = () => context.rpc.broadcast({ method: 'shopify-devtools:sources-changed', args: [], optional: true } as never)
        docks = context.docks as unknown as typeof docks
        docks?.events?.on('docks:entry:updated', fixDock)
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
              const file = await launchEditor(resolveThemeRoot(context.viteConfig), input.file, input.line, options.editor)
              return { ok: true as const, file, line: input.line }
            },
          }),
        }) as never)
        context.rpc.register(defineRpcFunction({
          name: 'shopify-devtools:resolve-sections',
          type: 'action',
          setup: () => ({
            handler: (input: { ids: unknown; pageType?: unknown }) => resolveSections(resolveThemeRoot(context.viteConfig), input?.ids, input?.pageType),
          }),
        }) as never)
      },
    },
    configureServer(server) {
      const warning = viteVersionWarning(viteVersion) ?? devtoolsConfigWarning((server.config as { devtools?: unknown }).devtools)
      if (warning) server.config.logger.warn(`[shopify-devtools] ${warning}`)
      // Docks registered by other plugins may already exist, or arrive later; fix both once the origin is known.
      const ready = (): void => {
        origin = viteOrigin(server)
        for (const entry of docks?.views?.values() ?? []) fixDock(entry as DockEntry)
      }
      if (server.httpServer?.listening) ready(); else server.httpServer?.once('listening', ready)
      const themeRoot = resolveThemeRoot(server.config)
      const changed = (file: string): void => {
        const relative = toPosix(path.relative(themeRoot, file))
        if (relative.startsWith('../') || path.isAbsolute(relative)) return
        if (/^(templates(?:\/customers)?\/[^/]+\.json|sections\/[^/]+\.json|(?:sections|blocks|snippets)\/[^/]+\.liquid)$/.test(relative)) {
          if (relative.endsWith('.liquid')) invalidateGraph(file)
          broadcastSourcesChanged?.()
        }
      }
      server.watcher?.on('add', changed)
      server.watcher?.on('change', changed)
      server.watcher?.on('unlink', changed)
      return () => { void closeInstrumentation() }
    },
    async configResolved(config) {
      serve = config.command === 'serve'
      entrypoints = new Set(resolveEntrypoints(config.root, config.build as never))
      if (!serve) return
      if (!explicitEntry && entrypoints.size === 0) {
        throw new Error('[shopify-devtools] No JavaScript entry was found in Vite build.input, so the DevTools client cannot be injected. Add a script entry to vite-plugin-shopify or set shopifyDevtools({ entry: "path/to/entry.ts" }).')
      }
      const themeRoot = path.resolve(options.themeRoot ?? resolveThemeRoot(config))
      if (options.instrument === 'copy') {
        instrumentationRoot = path.join(themeRoot, '.shopify-devtools', 'theme')
        instrumentation = await createThemeMirror(themeRoot, { root: instrumentationRoot })
        config.logger.info(`[shopify-devtools] Full-mode mirror ready at ${instrumentationRoot}. Run Shopify CLI with SHOPIFY_FLAG_PATH=${instrumentationRoot}`)
      } else if (options.instrument === 'in-place') {
        instrumentation = await instrumentInPlace(themeRoot)
        config.logger.warn('[shopify-devtools] Full mode is instrumenting theme Liquid files in place. Originals are journalled and will be restored when Vite exits.')
      } else if (await recoverInPlace(themeRoot)) {
        config.logger.warn('[shopify-devtools] Recovered source files left instrumented by an earlier interrupted run.')
      }
    },
    async closeBundle() { await closeInstrumentation() },
    resolveId(id) {
      if (id === 'virtual:shopify-devtools/client') return CLIENT_ID
      if (id === RENDERER_PUBLIC_ID || id === RENDERER_ID) return RENDERER_ID
      if (id === ACTION_PUBLIC_ID || id === ACTION_ID) return ACTION_ID
    },
    load(id) {
      if (id === CLIENT_ID) return `const origin=new URL(import.meta.url).origin;const connectionUrl=origin+'/__devtools/__connection.json';const connectionResponse=await fetch(connectionUrl);if(!connectionResponse.ok)throw new Error('Unable to load Vite DevTools connection metadata ('+connectionResponse.status+') from '+connectionUrl+'. Check that Vite 8.3 or newer is installed and that devtools: shopifyDevtoolsConfig is set in your Vite config.');const connectionMeta=await connectionResponse.json();globalThis.__DEVFRAME_CONNECTION__={connectionMeta,metaBaseUrl:connectionResponse.url||connectionUrl,authToken:connectionMeta.authToken};const devtoolsClient=origin+'/__devtools/embedded.js';await import(/* @vite-ignore */devtoolsClient);${MINIMIZED_SIZE_SCRIPT}`
      if (id === RENDERER_ID) return `export { default } from ${JSON.stringify(new URL('./client.js', import.meta.url).href)};`
      if (id === ACTION_ID) return `export { default } from ${JSON.stringify(new URL('./action.js', import.meta.url).href)};`
    },
    transform(code, id) {
      if (!serve) return
      const clean = toPosix(id.split('?')[0])
      const matches = explicitEntry ? clean.endsWith(explicitEntry) : entrypoints.has(clean)
      if (!matches) return
      return { code: `import 'virtual:shopify-devtools/client';\n${code}`, map: null }
    },
  }
}

export { instrumentLiquid } from './instrument.js'
export { createThemeMirror } from './mirror.js'
