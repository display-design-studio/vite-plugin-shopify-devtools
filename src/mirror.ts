import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import chokidar, { type FSWatcher } from 'chokidar'
import { instrumentLiquid } from './instrument.js'

export const THEME_DIRECTORIES = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'] as const
export const THEME_ROOT_FILES = ['shopify.theme.toml'] as const

export interface ThemeMirror { root: string; close(): Promise<void> }

async function copyFile(themeRoot: string, shadowRoot: string, absolute: string): Promise<void> {
  const relative = path.relative(themeRoot, absolute)
  if (relative.startsWith('..')) return
  const target = path.join(shadowRoot, relative)
  await mkdir(path.dirname(target), { recursive: true })
  if (absolute.endsWith('.liquid')) {
    const source = await readFile(absolute, 'utf8')
    await writeFile(target, instrumentLiquid(source, relative), 'utf8')
  } else await cp(absolute, target)
}

export async function createThemeMirror(themeRoot: string): Promise<ThemeMirror> {
  const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), 'shopify-devtools-')))
  const watched: string[] = []
  for (const directory of THEME_DIRECTORIES) {
    const source = path.join(themeRoot, directory)
    try {
      if ((await stat(source)).isDirectory()) { await cp(source, path.join(root, directory), { recursive: true }); watched.push(source) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  for (const filename of THEME_ROOT_FILES) {
    const source = path.join(themeRoot, filename)
    try {
      if ((await stat(source)).isFile()) { await cp(source, path.join(root, filename)); watched.push(source) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  for (const directory of ['sections', 'blocks', 'snippets']) {
    const base = path.join(themeRoot, directory)
    const files: string[] = []
    try {
      const { glob } = await import('node:fs/promises')
      for await (const file of glob('**/*.liquid', { cwd: base })) files.push(file)
    } catch { /* Optional theme directory. */ }
    for (const file of files) await copyFile(themeRoot, root, path.join(base, file))
  }

  // Polling avoids exhausting per-process file-descriptor limits on large themes and CI hosts.
  // Only existing directories are watched: chokidar 5 stops reporting changes when any watched path is missing.
  const watcher: FSWatcher = chokidar.watch(watched, {
    ignoreInitial: true,
    usePolling: true,
    interval: 120,
  })
  watcher.on('add', (file) => void copyFile(themeRoot, root, file))
  watcher.on('change', (file) => void copyFile(themeRoot, root, file))
  watcher.on('unlink', (file) => void rm(path.join(root, path.relative(themeRoot, file)), { force: true }))
  watcher.on('addDir', (directory) => void mkdir(path.join(root, path.relative(themeRoot, directory)), { recursive: true }))
  watcher.on('unlinkDir', (directory) => void rm(path.join(root, path.relative(themeRoot, directory)), { recursive: true, force: true }))
  await new Promise<void>((resolve, reject) => {
    watcher.once('ready', resolve)
    watcher.once('error', reject)
  })

  return { root, async close() { await watcher.close(); await rm(root, { recursive: true, force: true }) } }
}
