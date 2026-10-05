import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const matrix = [
  ['vite-plugin-shopify@4.1.2', '8.3.0'],
  ['vite-plugin-shopify@4.1.2', '8'],
  ['vite-plugin-shopify@5.0.0', '8.3.0'],
  ['vite-plugin-shopify@5.0.0', '8'],
  ['vite-plugin-shopify-theme@0.1.2', '8.3.0'],
  ['vite-plugin-shopify-theme@0.1.2', '8'],
]
const requestedPlugin = process.env.THEME_PLUGIN
const requestedVite = process.env.VITE_VERSION
const combinations = process.env.COMPAT_CORE_ONLY === '1'
  ? [[undefined, requestedVite || '8']]
  : requestedPlugin || requestedVite
  ? matrix.filter(([plugin, vite]) => (!requestedPlugin || plugin === requestedPlugin) && (!requestedVite || vite === requestedVite))
  : matrix

if (combinations.length === 0) {
  throw new Error(`No compatibility combination matches THEME_PLUGIN=${requestedPlugin ?? ''} VITE_VERSION=${requestedVite ?? ''}`)
}

const temporary = mkdtempSync(join(tmpdir(), 'vite-plugin-shopify-devtools-compatibility-'))
const packDirectory = join(temporary, 'pack')
const cache = join(temporary, 'npm-cache')

function run(command, args, options, context) {
  try { return execFileSync(command, args, { stdio: 'inherit', ...options }) } catch (error) {
    throw new Error(`[compatibility: ${context}] command failed: ${command} ${args.join(' ')}`, { cause: error })
  }
}

function fixtureCheck(pluginSpec, viteSpec) {
  const packageName = pluginSpec?.slice(0, pluginSpec.lastIndexOf('@'))
  return `
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer, version } from 'vite'
${packageName ? `import themePlugin from ${JSON.stringify(packageName)}` : ''}
import shopifyDevtools, { shopifyDevtoolsConfig } from '@display-studio/vite-plugin-shopify-devtools'

const root = process.cwd()
const entry = ${JSON.stringify(packageName)} === 'vite-plugin-shopify-theme' ? 'frontend/theme.js' : 'frontend/entrypoints/theme.js'
const themeRoot = ${JSON.stringify(packageName)} === 'vite-plugin-shopify-theme' ? join(root, 'theme') : root
mkdirSync(join(root, 'frontend', ${JSON.stringify(packageName)} === 'vite-plugin-shopify-theme' ? '' : 'entrypoints'), { recursive: true })
mkdirSync(join(themeRoot, 'layout'), { recursive: true })
mkdirSync(join(themeRoot, 'snippets'), { recursive: true })
writeFileSync(join(root, entry), 'export const fixture = true\\n')
writeFileSync(join(themeRoot, 'layout/theme.liquid'), '<html><head></head><body></body></html>\\n')

const shopify = ${packageName ? `${JSON.stringify(packageName)} === 'vite-plugin-shopify-theme'
  ? themePlugin({ themePath: themeRoot, entry, devBranches: false, worktree: 'off', reload: false, maxDevProcesses: false })
  : themePlugin({ themeRoot })` : '[]'}
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'silent',
  devtools: shopifyDevtoolsConfig,
  build: ${packageName ? '{}' : `{ outDir: join(themeRoot, 'assets'), rollupOptions: { input: [join(root, entry)] } }`},
  plugins: [shopify, shopifyDevtools()],
  server: { middlewareMode: true },
})
try {
  if (${JSON.stringify(viteSpec)} === '8.3.0' && version !== '8.3.0') throw new Error('Expected Vite 8.3.0, received ' + version)
  if (!version.startsWith('8.')) throw new Error('Expected Vite 8.x, received ' + version)
  if (server.config.root !== root) throw new Error('Unexpected root: ' + server.config.root)
  if (resolve(server.config.build.outDir) !== resolve(themeRoot, 'assets')) throw new Error('Unexpected outDir: ' + server.config.build.outDir)
  const input = server.config.build.rolldownOptions?.input ?? server.config.build.rollupOptions?.input
  const entries = typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input ?? {})
  if (!entries.some(value => resolve(root, value) === resolve(root, entry))) throw new Error('Theme entry missing from resolved input: ' + JSON.stringify(input))
  const transformed = await server.transformRequest('/' + entry)
  if (!transformed?.code.includes('virtual:shopify-devtools/client')) throw new Error('Shopify DevTools client was not injected into ' + entry + ': ' + transformed?.code)
  if (server.config.server.middlewareMode !== true) throw new Error('Vite server is not running in middleware mode')
  console.log(${JSON.stringify(`[compatibility] ${pluginSpec ?? 'core plugin'}`)} + ' with Vite ' + version + ' passed on Node ' + process.version + '.')
} finally {
  await server.close()
}
`
}

try {
  mkdirSync(packDirectory)
  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', packDirectory], {
    cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache },
  })
  const filename = JSON.parse(output)[0]?.filename
  if (!filename) throw new Error('[compatibility: pack] npm pack did not report a tarball filename')

  for (const [pluginSpec, viteSpec] of combinations) {
    const consumer = join(temporary, `${(pluginSpec ?? 'core').replaceAll(/[^a-z0-9]+/gi, '-')}-vite-${viteSpec}`)
    mkdirSync(consumer)
    writeFileSync(join(consumer, 'package.json'), '{"name":"vite-compatibility-consumer","private":true,"type":"module"}\n')
    const dependencies = [join(packDirectory, filename), `vite@${viteSpec}`, ...(pluginSpec ? [pluginSpec] : [])]
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', ...dependencies], {
      cwd: consumer, env: { ...process.env, npm_config_cache: cache },
    }, `${pluginSpec} / Vite ${viteSpec} install`)
    writeFileSync(join(consumer, 'check.mjs'), fixtureCheck(pluginSpec, viteSpec))
    run(process.execPath, ['check.mjs'], { cwd: consumer }, `${pluginSpec} / Vite ${viteSpec} server and injection`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
