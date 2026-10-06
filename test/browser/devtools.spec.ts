import { expect, test } from '@playwright/test'

test('injects the client across origins and exposes the inferred tree', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-theme-entry', 'loaded')
  await expect(page.locator('devframes-dock-embedded')).toBeAttached()
  expect(requests.some(url => url.startsWith('http://127.0.0.1:5173/__devtools/'))).toBe(true)
  expect(new URL(page.url()).origin).toBe('http://127.0.0.1:9292')

  const dock = page.locator('devframes-dock-embedded')
  const opened = await dock.evaluate((host) => {
    const visit = (root: ShadowRoot | Element): HTMLButtonElement | undefined => {
      for (const element of root.querySelectorAll('*')) {
        if (element instanceof HTMLButtonElement && /shopify liquid/i.test(element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent ?? '')) return element
        if (element.shadowRoot) { const found = visit(element.shadowRoot); if (found) return found }
      }
    }
    const button = visit(host.shadowRoot!)
    button?.click()
    return Boolean(button)
  })
  expect(opened).toBe(true)

  const panel = page.getByRole('region', { name: 'Shopify Liquid DevTools' })
  await expect(panel).toBeVisible()
  const tree = panel.getByRole('tree', { name: 'Liquid components' })
  await expect(tree).toContainText('hello-world')
  await expect(tree).toContainText('inference-demo')
  await expect(tree).toContainText('demo-card')
  await expect(tree).toContainText('demo-badge')
  await expect(tree).toContainText('demo-button')
  await expect(tree).toContainText('group')
  await panel.getByRole('searchbox', { name: 'Search components' }).fill('demo-card')
  await expect(tree).toContainText('demo-card')
  await tree.getByText('demo-card', { exact: false }).first().click()
  await expect(panel.getByRole('main')).toContainText('snippets/demo-card.liquid')
})
