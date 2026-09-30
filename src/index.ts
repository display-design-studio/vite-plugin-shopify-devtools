import crypto from 'node:crypto'
import { access, realpath } from 'node:fs/promises'
import path from 'node:path'
import launchEditorProcess from 'launch-editor'
import type { Plugin, ViteDevServer } from 'vite'

const CLIENT_ID = '\0virtual:shopify-devtools/client'

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
  const specifiedEditor = editor || process.env.SHOPIFY_DEVTOOLS_EDITOR || process.env.EDITOR
  const target = `${candidate}:${line}:1`
  try {
    await launchOnce(target, specifiedEditor)
  } catch (error) {
    if (specifiedEditor) throw error
    const installedEditor = await findInstalledMacEditor()
    if (!installedEditor) throw error
    await launchOnce(target, installedEditor)
  }
  return candidate
}

async function launchOnce(target: string, editor?: string): Promise<void> {
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

async function findInstalledMacEditor(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return
  const candidates = [
    '/Applications/Zed.app/Contents/MacOS/zed',
    '/Applications/Cursor.app/Contents/MacOS/Cursor',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ]
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Try the next supported editor. */ }
  }
}

export default function shopifyDevtools(options: ShopifyDevtoolsOptions = {}): Plugin {
  const entry = options.entry ?? 'frontend/entrypoints/ts/theme.ts'
  const token = crypto.randomBytes(24).toString('base64url')
  let serve = false
  return {
    name: 'vite-plugin-shopify-devtools',
    enforce: 'pre',
    apply: 'serve',
    configResolved(config) { serve = config.command === 'serve' },
    resolveId(id) { if (id === 'virtual:shopify-devtools/client') return CLIENT_ID },
    load(id) {
      if (id !== CLIENT_ID) return
      return `globalThis.__SHOPIFY_DEVTOOLS_CONFIG__={token:${JSON.stringify(token)},endpoint:new URL(import.meta.url).origin+'/__shopify-devtools/open'};await import(${JSON.stringify(new URL('./client.js', import.meta.url).href)});`
    },
    transform(code, id) {
      if (!serve) return
      const clean = id.split('?')[0].split(path.sep).join('/')
      if (!clean.endsWith(entry.split(path.sep).join('/'))) return
      return { code: `import 'virtual:shopify-devtools/client';\n${code}`, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/__shopify-devtools/open', async (request, response) => {
        response.setHeader('content-type', 'application/json')
        if (request.method !== 'POST') { response.statusCode = 405; response.end('{"error":"Method not allowed"}'); return }
        if (!isAllowedOrigin(request.headers.origin, server, options.allowedOrigins ?? [])) { response.statusCode = 403; response.end('{"error":"Origin not allowed"}'); return }
        if (request.headers.authorization !== `Bearer ${token}`) { response.statusCode = 401; response.end('{"error":"Invalid token"}'); return }
        let body = ''
        request.on('data', (chunk) => { if (body.length < 16_384) body += chunk })
        request.on('end', async () => {
          try {
            const payload = JSON.parse(body) as { file?: unknown; line?: unknown }
            if (typeof payload.file !== 'string' || !Number.isInteger(payload.line) || Number(payload.line) < 1) throw new Error('Invalid payload')
            const openedFile = await launchEditor(server.config.root, payload.file, Number(payload.line), options.editor)
            response.end(JSON.stringify({ ok: true, file: openedFile, line: Number(payload.line) }))
          } catch (error) {
            response.statusCode = 400; response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Bad request' }))
          }
        })
      })
    },
  }
}

export { createThemeMirror } from './mirror.js'
export { instrumentLiquid } from './instrument.js'
