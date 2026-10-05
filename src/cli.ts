#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'
import { resolveThemeRoot } from './index.js'
import { createThemeMirror } from './mirror.js'

export function executable(name: string, platform = process.platform): string {
  return platform === 'win32' ? `${name}.cmd` : name
}

function run(command: string, args: string[], cwd: string): ChildProcess {
  return spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
}

export interface CliOptions { themePath?: string; vitePort?: number; shopifyFlags: string[] }

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = { shopifyFlags: [] }
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--theme-path') {
      const value = args[++index]
      if (!value) throw new Error('--theme-path requires a directory')
      options.themePath = value
    } else if (flag === '--vite-port') {
      const value = Number(args[++index])
      if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error('--vite-port requires a port between 1 and 65535')
      options.vitePort = value
    } else options.shopifyFlags.push(flag)
  }
  return options
}

export async function portAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

function flagValue(flags: string[], long: string): string | undefined {
  const equals = flags.find((flag) => flag.startsWith(`${long}=`))
  if (equals) return equals.slice(long.length + 1)
  const index = flags.indexOf(long)
  return index >= 0 ? flags[index + 1] : undefined
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...rawFlags] = argv
  if (command !== 'dev') {
    console.error('Usage: shopify-devtools dev [--theme-path path] [--vite-port port] [shopify theme dev flags]')
    process.exitCode = 1
    return
  }
  const options = parseCliArgs(rawFlags)
  const flags = options.shopifyFlags
  let themeRoot = options.themePath ? path.resolve(options.themePath) : process.cwd()
  if (!options.themePath) {
    try { themeRoot = resolveThemeRoot(await resolveConfig({}, 'serve')) } catch { /* Fall back to the working directory. */ }
  }
  const shopifyPort = Number(flagValue(flags, '--port') ?? process.env.SHOPIFY_FLAG_PORT ?? 9292)
  if (Number.isInteger(shopifyPort) && !await portAvailable(shopifyPort)) throw new Error(`Shopify preview port ${shopifyPort} is already in use. Stop that process or pass --port <free-port>.`)
  if (options.vitePort && !await portAvailable(options.vitePort)) throw new Error(`Vite port ${options.vitePort} is already in use. Stop that process or pass --vite-port <free-port>.`)
  const mirror = await createThemeMirror(themeRoot)
  const vite = run(executable('vite'), options.vitePort ? ['--port', String(options.vitePort), '--strictPort'] : [], themeRoot)
  const shopify = run(executable('shopify'), ['theme', 'dev', '--path', mirror.root, ...flags], themeRoot)
  let closing = false
  const close = async (code = 0): Promise<void> => {
    if (closing) return
    closing = true
    vite.kill('SIGTERM'); shopify.kill('SIGTERM')
    await mirror.close()
    process.exitCode = code
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void close())
  vite.once('exit', (code) => void close(code ?? 1))
  shopify.once('exit', (code) => void close(code ?? 1))
  vite.once('error', (error) => { console.error(error); void close(1) })
  shopify.once('error', (error) => { console.error(error); void close(1) })
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void main().catch((error) => { console.error(error); process.exitCode = 1 })
}
