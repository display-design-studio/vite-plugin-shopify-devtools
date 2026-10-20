import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagnose, formatChecks, gitignoreCovers, installedVersion, versionAtLeast } from '../src/doctor.js'
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

  it('checks the installed theme plugin version only when it is present', () => {
    const withPlugin = (version: string): string => {
      const root = theme()
      const directory = path.join(root, 'node_modules', '@display-studio', 'vite-plugin-shopify-theme')
      mkdirSync(directory, { recursive: true })
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version }))
      return root
    }
    const run = (root: string) => diagnose(root, new Error('skip'), '8.3.1')
    expect(byName(run(theme()), 'Theme plugin')).toBeUndefined()
    expect(byName(run(withPlugin('0.7.1')), 'Theme plugin')).toMatchObject({ status: 'ok', message: 'vite-plugin-shopify-theme 0.7.1' })
    expect(byName(run(withPlugin('0.8.0')), 'Theme plugin')?.status).toBe('ok')
    const old = byName(run(withPlugin('0.7.0')), 'Theme plugin')
    expect(old?.status).toBe('warn')
    expect(old?.message).toContain('0.7.0 ends the process before Vite closes the server')
    expect(old?.message).toContain('Install 0.7.1 or later')
  })

  it('compares versions and finds a package in a parent node_modules', () => {
    expect(versionAtLeast('0.7.1', [0, 7, 1])).toBe(true)
    expect(versionAtLeast('0.7.0', [0, 7, 1])).toBe(false)
    expect(versionAtLeast('0.10.0', [0, 7, 1])).toBe(true)
    expect(versionAtLeast('1.0.0', [0, 7, 1])).toBe(true)
    expect(versionAtLeast('not-a-version', [0, 7, 1])).toBe(false)
    const root = theme()
    mkdirSync(path.join(root, 'node_modules', 'some-package'), { recursive: true })
    writeFileSync(path.join(root, 'node_modules', 'some-package', 'package.json'), JSON.stringify({ version: '2.3.4' }))
    const nested = path.join(root, 'workspace')
    mkdirSync(nested)
    expect(installedVersion(nested, 'some-package')).toBe('2.3.4')
    expect(installedVersion(nested, 'missing-package-name-xyz')).toBeUndefined()
  })

  it('recognises ignore patterns', () => {
    expect(gitignoreCovers('/.shopify-devtools')).toBe(true)
    expect(gitignoreCovers('.shopify-devtools/theme')).toBe(true)
    expect(gitignoreCovers('node_modules')).toBe(false)
  })
})
