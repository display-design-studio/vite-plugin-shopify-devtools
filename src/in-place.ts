import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { instrumentLiquid } from './instrument.js'

interface JournalEntry { file: string; original: string; instrumented: string; previous?: string }
interface Journal { version: 1; entries: JournalEntry[] }
export interface InPlaceInstrumentation { close(): Promise<void> }

export const JOURNAL_DIRECTORY = '.shopify-devtools'
export const JOURNAL_FILE = 'in-place-journal.json'
const journalPath = (root: string): string => path.join(root, JOURNAL_DIRECTORY, JOURNAL_FILE)

async function liquidFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const directory of ['sections', 'blocks', 'snippets']) {
    const base = path.join(root, directory)
    try {
      for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.liquid')) files.push(path.join(entry.parentPath ?? base, entry.name))
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return files
}

async function writeJournal(root: string, journal: Journal): Promise<void> {
  const directory = path.join(root, JOURNAL_DIRECTORY)
  const target = journalPath(root)
  const temporary = `${target}.tmp`
  await mkdir(directory, { recursive: true })
  await writeFile(temporary, JSON.stringify(journal, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

export async function recoverInPlace(root: string): Promise<boolean> {
  let journal: Journal
  try { journal = JSON.parse(await readFile(journalPath(root), 'utf8')) as Journal } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (journal.version !== 1 || !Array.isArray(journal.entries)) throw new Error('Invalid Shopify DevTools in-place journal; restore files manually before continuing.')
  const resolvedRoot = path.resolve(root)
  for (const entry of journal.entries) {
    const target = path.resolve(root, entry.file)
    if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Unsafe path in Shopify DevTools journal')
    let current: string | undefined
    try { current = await readFile(target, 'utf8') } catch { /* Restore a deleted instrumented file. */ }
    if (current !== undefined && current !== entry.instrumented && current !== entry.original && current !== entry.previous) {
      throw new Error(`Cannot recover ${entry.file}: it changed after instrumentation. Resolve it manually, then remove ${JOURNAL_DIRECTORY}/${JOURNAL_FILE}.`)
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, entry.original, 'utf8')
  }
  await rm(journalPath(root), { force: true })
  return true
}

export async function instrumentInPlace(root: string): Promise<InPlaceInstrumentation> {
  await recoverInPlace(root)
  const entries = new Map<string, JournalEntry>()
  for (const absolute of await liquidFiles(root)) {
    const file = path.relative(root, absolute).split(path.sep).join('/')
    const original = await readFile(absolute, 'utf8')
    const instrumented = instrumentLiquid(original, file)
    if (instrumented !== original) entries.set(file, { file, original, instrumented })
  }
  await writeJournal(root, { version: 1, entries: [...entries.values()] })
  for (const entry of entries.values()) await writeFile(path.join(root, entry.file), entry.instrumented, 'utf8')
  const watched: string[] = []
  for (const directory of ['sections', 'blocks', 'snippets']) {
    const candidate = path.join(root, directory)
    try { if ((await stat(candidate)).isDirectory()) watched.push(candidate) } catch { /* Optional theme directory. */ }
  }
  const watcher: FSWatcher = chokidar.watch(watched, {
    ignoreInitial: true,
    usePolling: true,
    interval: 120,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })
  let queue = Promise.resolve()
  const update = (absolute: string): void => {
    queue = queue.then(async () => {
      const file = path.relative(root, absolute).split(path.sep).join('/')
      if (!file.endsWith('.liquid')) return
      const original = await readFile(absolute, 'utf8')
      const previous = entries.get(file)
      if (original === previous?.instrumented) return
      const instrumented = instrumentLiquid(original, file)
      if (instrumented === original) entries.delete(file)
      else entries.set(file, { file, original, instrumented, previous: previous?.instrumented })
      await writeJournal(root, { version: 1, entries: [...entries.values()] })
      if (instrumented !== original) {
        await writeFile(absolute, instrumented, 'utf8')
        entries.set(file, { file, original, instrumented })
        await writeJournal(root, { version: 1, entries: [...entries.values()] })
      }
    })
  }
  watcher.on('add', update)
  watcher.on('change', update)
  watcher.on('unlink', (absolute) => {
    queue = queue.then(async () => {
      entries.delete(path.relative(root, absolute).split(path.sep).join('/'))
      await writeJournal(root, { version: 1, entries: [...entries.values()] })
    })
  })
  await new Promise<void>((resolve, reject) => { watcher.once('ready', resolve); watcher.once('error', reject) })
  let closed = false
  return { async close() { if (closed) return; closed = true; await watcher.close(); await queue; await recoverInPlace(root) } }
}
