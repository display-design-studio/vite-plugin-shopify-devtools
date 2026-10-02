import { deepStrictEqual, match, strictEqual } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = '@display-studio/vite-plugin-shopify-devtools'

const stableFiles = [
  'LICENSE',
  'README.md',
  'assets/shopify/shopify-glyph-black.svg',
  'assets/shopify/shopify-glyph-white.svg',
  'assets/shopify/shopify-glyph.svg',
  'dist/action.d.ts',
  'dist/action.js',
  'dist/cli.d.ts',
  'dist/cli.js',
  'dist/client.d.ts',
  'dist/client.js',
  'dist/index.d.ts',
  'dist/index.js',
  'package.json',
]
const chunkPattern = /^dist\/chunk-[A-Z0-9]{8}\.js$/
const rootExports = [
  'absoluteDockUrl', 'createThemeMirror', 'default', 'devtoolsConfigWarning', 'instrumentLiquid',
  'launchEditor', 'resolveAllowedOrigins', 'resolveEntrypoints', 'resolveThemeFile', 'resolveThemeRoot',
  'shopifyDevtoolsBranding', 'shopifyDevtoolsConfig', 'viteOrigin', 'viteVersionWarning',
]

function stage(name, operation) {
  try { return operation() } catch (error) {
    throw new Error(`[pack: ${name}] ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

function validateFiles(files) {
  const stable = files.filter((file) => !chunkPattern.test(file)).sort()
  const chunks = files.filter((file) => chunkPattern.test(file))
  deepStrictEqual(stable, stableFiles, 'published stable file list differs from the package contract')
  strictEqual(chunks.length > 0, true, 'package must contain at least one hashed JavaScript chunk')
  strictEqual(new Set(files).size, files.length, 'published file list contains duplicates')
}

function validateMetadata(manifest) {
  strictEqual(manifest.name, packageName, 'package name differs')
  strictEqual(manifest.version, '0.3.0', 'package version differs')
  strictEqual(manifest.type, 'module', 'package must remain ESM')
  strictEqual(manifest.license, 'MIT', 'package license must remain MIT')
  deepStrictEqual(manifest.files, ['dist', 'assets', 'README.md', 'LICENSE'], 'files allowlist differs')
  deepStrictEqual(manifest.engines, { node: '^20.19.0 || >=22.12.0' }, 'Node engine differs')
  deepStrictEqual(manifest.peerDependencies, { vite: '^8.3.0' }, 'Vite peer range differs')
  deepStrictEqual(manifest.bin, { 'shopify-devtools': 'dist/cli.js' }, 'CLI map differs')
  deepStrictEqual(manifest.exports, {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './devtools-client': { types: './dist/client.d.ts', import: './dist/client.js' },
    './devtools-action': { types: './dist/action.d.ts', import: './dist/action.js' },
  }, 'export map differs')
  strictEqual(manifest.scripts?.prepublishOnly, 'bun run check', 'prepublishOnly guard differs')
  deepStrictEqual(manifest.publishConfig, { access: 'public' }, 'publish configuration differs')
  deepStrictEqual(manifest.repository, {
    type: 'git', url: 'git+https://github.com/display-design-studio/vite-plugin-shopify-devtools.git',
  }, 'repository metadata differs')
  strictEqual(manifest.homepage, 'https://github.com/display-design-studio/vite-plugin-shopify-devtools#readme', 'homepage metadata differs')
  deepStrictEqual(manifest.bugs, { url: 'https://github.com/display-design-studio/vite-plugin-shopify-devtools/issues' }, 'issue tracker metadata differs')
  deepStrictEqual(manifest.dependencies, {
    '@shopify/liquid-html-parser': '^2.9.0',
    '@vitejs/devtools': '^0.7.6',
    '@vitejs/devtools-kit': '^0.7.6',
    chokidar: '^5.0.0',
    'launch-editor': '^2.14.1',
  }, 'runtime dependencies differ')
}

function validateImports(consumer) {
  const code = [
    `import * as root from ${JSON.stringify(packageName)};`,
    `import * as action from ${JSON.stringify(`${packageName}/devtools-action`)};`,
    'globalThis.HTMLElement = class HTMLElement {};',
    'globalThis.customElements = { get() {}, define() {} };',
    `const client = await import(${JSON.stringify(`${packageName}/devtools-client`)});`,
    'console.log(JSON.stringify({ root: Object.keys(root).sort(), action: Object.keys(action).sort(), client: Object.keys(client).sort() }));',
  ].join('\n')
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: consumer, encoding: 'utf8' }))
  deepStrictEqual(result.root, rootExports, 'root runtime exports differ')
  deepStrictEqual(result.action, ['default'], 'action runtime exports differ')
  deepStrictEqual(result.client, ['ShopifyDevtools', 'componentTree', 'deepestAtPoint', 'deepestForTarget', 'default', 'resolveTheme'], 'client runtime exports differ')
}

function validateCli(consumer) {
  const bin = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'shopify-devtools.cmd' : 'shopify-devtools')
  strictEqual(existsSync(bin), true, 'installed CLI shim is missing')
  const result = spawnSync(bin, [], { cwd: consumer, encoding: 'utf8' })
  strictEqual(result.status, 1, `CLI without arguments exited with ${result.status}`)
  strictEqual(result.signal, null, `CLI without arguments exited on signal ${result.signal}`)
  strictEqual(result.stdout, '', 'CLI usage must not be written to stdout')
  match(result.stderr, /^Usage: shopify-devtools dev \[shopify theme dev flags\]\s*$/, 'CLI usage differs')
}

const temporary = mkdtempSync(join(tmpdir(), 'vite-plugin-shopify-devtools-pack-'))
try {
  const packDirectory = join(temporary, 'pack')
  const consumer = join(temporary, 'consumer')
  const cache = join(temporary, 'npm-cache')
  mkdirSync(packDirectory)
  mkdirSync(consumer)
  const pack = stage('pack', () => {
    const output = execFileSync('npm', ['pack', '--json', '--pack-destination', packDirectory], {
      cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache, npm_config_dry_run: 'false' },
    })
    const result = JSON.parse(output)[0]
    if (!result?.filename || !Array.isArray(result.files)) throw new Error('npm pack returned an invalid manifest')
    validateFiles(result.files.map(({ path }) => path))
    return result
  })
  writeFileSync(join(consumer, 'package.json'), '{"name":"package-contract-consumer","private":true,"type":"module"}\n')
  stage('install', () => execFileSync('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    '--save-exact', join(packDirectory, pack.filename), 'vite@8.3.0',
  ], { cwd: consumer, stdio: 'pipe', env: { ...process.env, npm_config_cache: cache, npm_config_dry_run: 'false' } }))
  const packageDirectory = join(consumer, 'node_modules', '@display-studio', 'vite-plugin-shopify-devtools')
  stage('metadata', () => {
    validateMetadata(JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')))
    for (const name of ['shopify-glyph-black.svg', 'shopify-glyph-white.svg', 'shopify-glyph.svg']) {
      match(readFileSync(join(packageDirectory, 'assets', 'shopify', name), 'utf8'), /<svg\b/, `asset ${name} is not SVG`)
    }
  })
  stage('imports', () => validateImports(consumer))
  stage('CLI', () => validateCli(consumer))
  console.log(`Package contract passed: ${pack.files.length} files, ${pack.size} bytes, installed and imported.`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
