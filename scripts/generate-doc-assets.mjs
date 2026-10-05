import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import gifenc from 'gifenc'

const { GIFEncoder, applyPalette, quantize } = gifenc

const root = new URL('..', import.meta.url).pathname
const processes = []

const start = (command, args) => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
  processes.push(child)
  return child
}

const waitFor = async (url) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return } catch { /* Server is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const openPanel = async (page) => {
  await page.goto('http://127.0.0.1:9292')
  await page.locator('devframes-dock-embedded').waitFor({ state: 'attached' })
  await page.locator('devframes-dock-embedded').evaluate((host) => {
    const visit = (root) => {
      for (const element of root.querySelectorAll('*')) {
        if (element instanceof HTMLButtonElement && /shopify liquid/i.test(element.getAttribute('aria-label') ?? element.textContent ?? '')) return element
        if (element.shadowRoot) { const found = visit(element.shadowRoot); if (found) return found }
      }
    }
    visit(host.shadowRoot)?.click()
  })
  const panel = page.getByRole('region', { name: 'Shopify Liquid DevTools' })
  await panel.waitFor()
  await panel.getByRole('tree').getByText('product-card', { exact: false }).waitFor()
  return panel
}

try {
  await mkdir(new URL('../docs', import.meta.url), { recursive: true })
  start('bunx', ['vite', '--config', 'test/browser/fixture/vite.config.ts'])
  start(process.execPath, ['test/browser/fixture/storefront.mjs'])
  await Promise.all([waitFor('http://127.0.0.1:5173/@vite/client'), waitFor('http://127.0.0.1:9292')])

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const panel = await openPanel(page)
  await page.screenshot({ path: new URL('../docs/devtools-panel.png', import.meta.url).pathname })

  const frames = []
  frames.push(await page.screenshot())
  await panel.getByRole('searchbox', { name: 'Search components' }).fill('product')
  frames.push(await page.screenshot())
  await panel.getByRole('tree').getByText('product-card', { exact: false }).click()
  frames.push(await page.screenshot())
  const decoded = frames.map(frame => PNG.sync.read(frame))
  const gif = GIFEncoder()
  for (const [index, frame] of decoded.entries()) {
    const palette = quantize(frame.data, 128)
    gif.writeFrame(applyPalette(frame.data, palette), frame.width, frame.height, { palette, delay: index === decoded.length - 1 ? 1400 : 900, repeat: 0 })
  }
  gif.finish()
  await writeFile(new URL('../docs/devtools-demo.gif', import.meta.url), gif.bytes())

  await page.setViewportSize({ width: 1280, height: 640 })
  await page.evaluate(() => document.body.classList.add('social-preview'))
  await page.screenshot({ path: new URL('../docs/social-preview.png', import.meta.url).pathname })
  const social = await readFile(new URL('../docs/social-preview.png', import.meta.url))
  if (social.byteLength >= 1_000_000) throw new Error(`Social preview is ${social.byteLength} bytes; expected less than 1 MB`)
  await browser.close()
  console.log(`Generated docs assets (social preview: ${social.byteLength} bytes).`)
} finally {
  for (const child of processes) child.kill('SIGTERM')
}
