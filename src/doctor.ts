import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveConfig, version as viteVersion } from 'vite'
import { devtoolsConfigWarning, resolveEntrypoints, resolveThemeRoot, viteVersionWarning } from './index.js'
import { findViteConfig } from './init.js'

export type CheckStatus = 'ok' | 'warn' | 'fail'
export interface Check { name: string, status: CheckStatus, message: string }

const THEME_DIRECTORIES = ['layout', 'sections', 'snippets', 'templates']

export function gitignoreCovers(source: string): boolean {
  return source.split(/\r?\n/).some((line) => /^\/?\.shopify-devtools(\/.*)?$/.test(line.trim()))
}

/** Static checks that need no running server. `config` is Vite's resolved config, or the error from resolving it. */
export function diagnose(root: string, config: { root: string, devtools?: unknown, build?: unknown } | Error | undefined, version = viteVersion): Check[] {
  const checks: Check[] = []
  const add = (name: string, status: CheckStatus, message: string): void => { checks.push({ name, status, message }) }
  const versionWarning = viteVersionWarning(version)
  add('Vite version', versionWarning ? 'fail' : 'ok', versionWarning ?? `Vite ${version}`)
  const configFile = findViteConfig(root)
  if (!configFile) add('Vite config', 'fail', 'No vite.config.{ts,mts,js,mjs} in the current directory. Run `shopify-devtools init` in your theme.')
  else add('Vite config', 'ok', path.basename(configFile))
  if (config instanceof Error) {
    add('Config loads', 'fail', `Vite could not resolve the config: ${config.message}`)
    return checks
  }
  if (!config) return checks
  const devtoolsWarning = devtoolsConfigWarning(config.devtools)
  add('Devtools preset', devtoolsWarning ? 'fail' : 'ok', devtoolsWarning ?? '`devtools: shopifyDevtoolsConfig` is set')
  const themeRoot = resolveThemeRoot(config as { root: string, build?: { outDir?: string } })
  const missing = THEME_DIRECTORIES.filter((directory) => !existsSync(path.join(themeRoot, directory)))
  add('Theme root', missing.length ? 'warn' : 'ok', missing.length ? `${themeRoot} is missing ${missing.join(', ')}. Set the \`themeRoot\` option if this is not the theme.` : themeRoot)
  const entries = resolveEntrypoints(config.root, config.build as never)
  add('JavaScript entry', entries.length ? 'ok' : 'warn', entries.length ? `${entries.length} found (the first is ${path.relative(config.root, entries[0])})` : 'None in build.input. Add a script entry or set `shopifyDevtools({ entry })`.')
  const ignorePath = path.join(root, '.gitignore')
  const ignored = existsSync(ignorePath) && gitignoreCovers(readFileSync(ignorePath, 'utf8'))
  add('.gitignore', ignored ? 'ok' : 'warn', ignored ? '.shopify-devtools/ is ignored' : 'Add `.shopify-devtools/` so the full-mode mirror is not committed (`shopify-devtools init` does it).')
  const toml = path.join(themeRoot, 'shopify.theme.toml')
  add('shopify.theme.toml', existsSync(toml) ? 'ok' : 'warn', existsSync(toml) ? 'found' : 'Not found. Without a store domain, add your preview origin to the Vite DevTools `allowedOrigins` option.')
  return checks
}

export async function runDoctor(root = process.cwd()): Promise<Check[]> {
  let config: Awaited<ReturnType<typeof resolveConfig>> | Error | undefined
  try { config = await resolveConfig({ root }, 'serve') } catch (error) { config = error instanceof Error ? error : new Error(String(error)) }
  return diagnose(root, config)
}

export function formatChecks(checks: Check[]): string {
  const marks: Record<CheckStatus, string> = { ok: '✓', warn: '!', fail: '✗' }
  return checks.map((check) => `${marks[check.status]} ${check.name}: ${check.message}`).join('\n')
}
