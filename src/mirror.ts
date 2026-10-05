import { constants } from 'node:fs'
import { copyFile as cloneFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import chokidar, { type FSWatcher } from 'chokidar'
import ignore, { type Ignore } from 'ignore'
import { instrumentLiquid } from './instrument.js'

export const THEME_DIRECTORIES = ['assets', 'blocks', 'config', 'layout', 'listings', 'locales', 'sections', 'snippets', 'templates'] as const
export const THEME_ROOT_FILES = ['shopify.theme.toml'] as const

export interface ThemeMirror { root: string; close(): Promise<void> }
export interface ThemeMirrorOptions { root?: string; keep?: boolean }

const posix = (value: string): string => value.split(path.sep).join('/')

async function loadIgnore(themeRoot: string, shadowRoot: string): Promise<Ignore> {
  const matcher = ignore().add(['.git/', '.shopify/', '.shopify-devtools/', 'node_modules/'])
  try { matcher.add(await readFile(path.join(themeRoot, '.shopifyignore'), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const generated = relativeFile(themeRoot, shadowRoot)
  if (generated) matcher.add(generated + '/')
  return matcher
}

function relativeFile(themeRoot: string, absolute: string): string | undefined {
  const relative = posix(path.relative(themeRoot, absolute))
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return
  return relative
}

async function copyFile(themeRoot: string, shadowRoot: string, absolute: string, matcher: Ignore): Promise<void> {
  const relative = relativeFile(themeRoot, absolute)
  if (!relative || matcher.ignores(relative)) return
  const target = path.join(shadowRoot, relative)
  await mkdir(path.dirname(target), { recursive: true })
  if (absolute.endsWith('.liquid')) {
    const source = await readFile(absolute, 'utf8')
    await writeFile(target, instrumentLiquid(source, relative), 'utf8')
  } else {
    try { await cloneFile(absolute, target, constants.COPYFILE_FICLONE) } catch { await cloneFile(absolute, target) }
  }
}

async function seedDirectory(themeRoot: string, shadowRoot: string, directory: string, matcher: Ignore): Promise<boolean> {
  const source = path.join(themeRoot, directory)
  let entries
  try { entries = await readdir(source, { recursive: true, withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    await copyFile(themeRoot, shadowRoot, path.join(entry.parentPath ?? source, entry.name), matcher)
  }
  return true
}

export async function createThemeMirror(themeRoot: string, options: ThemeMirrorOptions = {}): Promise<ThemeMirror> {
  const root = options.root ? path.resolve(options.root) : await mkdtemp(path.join(os.tmpdir(), 'shopify-devtools-'))
  if (options.root) { await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true }) }
  const matcher = await loadIgnore(themeRoot, root)
  const watched: string[] = []
  for (const directory of THEME_DIRECTORIES) {
    if (await seedDirectory(themeRoot, root, directory, matcher)) watched.push(path.join(themeRoot, directory))
  }
  for (const filename of THEME_ROOT_FILES) {
    const source = path.join(themeRoot, filename)
    try { if ((await stat(source)).isFile()) { await copyFile(themeRoot, root, source, matcher); watched.push(source) } } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  const watcher: FSWatcher = chokidar.watch(watched, { ignoreInitial: true, usePolling: true, interval: 120 })
  watcher.on('add', (file) => void copyFile(themeRoot, root, file, matcher))
  watcher.on('change', (file) => void copyFile(themeRoot, root, file, matcher))
  watcher.on('unlink', (file) => { const relative = relativeFile(themeRoot, file); if (relative) void rm(path.join(root, relative), { force: true }) })
  watcher.on('addDir', (directory) => { const relative = relativeFile(themeRoot, directory); if (relative && !matcher.ignores(`${relative}/`)) void mkdir(path.join(root, relative), { recursive: true }) })
  watcher.on('unlinkDir', (directory) => { const relative = relativeFile(themeRoot, directory); if (relative) void rm(path.join(root, relative), { recursive: true, force: true }) })
  await new Promise<void>((resolve, reject) => { watcher.once('ready', resolve); watcher.once('error', reject) })

  return { root, async close() { await watcher.close(); if (!options.keep) await rm(root, { recursive: true, force: true }) } }
}
