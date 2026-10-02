import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteVersion = process.env.VITE_VERSION || '8'
const temporary = mkdtempSync(join(tmpdir(), 'vite-plugin-shopify-devtools-compatibility-'))
const packDirectory = join(temporary, 'pack')
const consumer = join(temporary, 'consumer')
const cache = join(temporary, 'npm-cache')

function run(command, args, options, context) {
  try { return execFileSync(command, args, { stdio: 'inherit', ...options }) } catch (error) {
    throw new Error(`[compatibility: ${context}] command failed: ${command} ${args.join(' ')}`, { cause: error })
  }
}

try {
  mkdirSync(packDirectory)
  mkdirSync(consumer)
  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', packDirectory], {
    cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache },
  })
  const filename = JSON.parse(output)[0]?.filename
  if (!filename) throw new Error('[compatibility: pack] npm pack did not report a tarball filename')
  writeFileSync(join(consumer, 'package.json'), '{"name":"vite-compatibility-consumer","private":true,"type":"module"}\n')
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', join(packDirectory, filename), `vite@${viteVersion}`], {
    cwd: consumer, env: { ...process.env, npm_config_cache: cache },
  }, `Vite ${viteVersion} install`)
  const check = [
    "import { version, resolveConfig } from 'vite';",
    "import shopifyDevtools, { shopifyDevtoolsConfig } from '@display-studio/vite-plugin-shopify-devtools';",
    `if (${JSON.stringify(viteVersion)} === '8.3.0' && version !== '8.3.0') throw new Error('Expected Vite 8.3.0, received ' + version);`,
    "if (!version.startsWith('8.')) throw new Error('Expected Vite 8.x, received ' + version);",
    "const plugin = shopifyDevtools();",
    "const config = await resolveConfig({ configFile: false, logLevel: 'silent', devtools: shopifyDevtoolsConfig, plugins: [plugin] }, 'serve');",
    "if (config.command !== 'serve') throw new Error('Expected serve configuration');",
    "if (!config.plugins.some(({ name }) => name === plugin.name)) throw new Error('Plugin missing from resolved configuration');",
    "console.log(`[compatibility] Vite ${version} passed on Node ${process.version}.`);",
  ].join('\n')
  writeFileSync(join(consumer, 'check.mjs'), check)
  run(process.execPath, ['check.mjs'], { cwd: consumer }, `Vite ${viteVersion} configuration`)
} catch (error) {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
