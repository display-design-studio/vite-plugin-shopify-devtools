import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagnose, formatChecks, gitignoreCovers } from '../src/doctor.js'
import { shopifyDevtoolsConfig } from '../src/index.js'

const theme = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'devtools-doctor-'))
  for (const directory of ['layout', 'sections', 'snippets', 'templates', 'assets']) mkdirSync(path.join(root, directory))
  writeFileSync(path.join(root, 'vite.config.ts'), '')
  writeFileSync(path.join(root, '.gitignore'), '.shopify-devtools/\n')
  writeFileSync(path.join(root, 'shopify.theme.toml'), '')
  return root
}
const byName = (checks: ReturnType<typeof diagnose>, name: string) => checks.find((check) => check.name === name)

describe('doctor', () => {
  it('passes a healthy setup', () => {
    const root = theme()
    const checks = diagnose(root, { root, devtools: { enabled: true, config: shopifyDevtoolsConfig }, build: { outDir: 'assets', rolldownOptions: { input: { 'theme.ts': 'frontend/theme.ts' } } } }, '8.3.1')
    expect(checks.filter((check) => check.status !== 'ok')).toEqual([])
    expect(formatChecks(checks)).toContain('✓ Vite version: Vite 8.3.1')
  })

  it('flags each common problem', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'devtools-bad-'))
    const checks = diagnose(root, { root, devtools: undefined, build: {} }, '8.2.0')
    for (const name of ['Vite version', 'Vite config', 'Devtools preset']) expect(byName(checks, name)?.status, name).toBe('fail')
    for (const name of ['Theme root', 'JavaScript entry', '.gitignore', 'shopify.theme.toml']) expect(byName(checks, name)?.status, name).toBe('warn')
  })

  it('reports a config that fails to load', () => {
    const root = theme()
    expect(byName(diagnose(root, new Error('boom'), '8.3.1'), 'Config loads')).toMatchObject({ status: 'fail', message: expect.stringContaining('boom') })
  })

  it('recognises ignore patterns', () => {
    expect(gitignoreCovers('/.shopify-devtools')).toBe(true)
    expect(gitignoreCovers('.shopify-devtools/theme')).toBe(true)
    expect(gitignoreCovers('node_modules')).toBe(false)
  })
})
