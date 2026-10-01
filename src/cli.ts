#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import { resolveConfig } from 'vite'
import { resolveThemeRoot } from './index.js'
import { createThemeMirror } from './mirror.js'

function run(command: string, args: string[], cwd: string): ChildProcess {
  return spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
}

async function main(): Promise<void> {
  const [command, ...flags] = process.argv.slice(2)
  if (command !== 'dev') {
    console.error('Usage: shopify-devtools dev [shopify theme dev flags]')
    process.exitCode = 1
    return
  }
  let themeRoot = process.cwd()
  try { themeRoot = resolveThemeRoot(await resolveConfig({}, 'serve')) } catch { /* Fall back to the working directory. */ }
  const mirror = await createThemeMirror(themeRoot)
  const vite = run(process.platform === 'win32' ? 'vite.cmd' : 'vite', [], themeRoot)
  const shopify = run(process.platform === 'win32' ? 'shopify.cmd' : 'shopify', ['theme', 'dev', '--path', mirror.root, ...flags], themeRoot)
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

void main().catch((error) => { console.error(error); process.exitCode = 1 })
