import { describe, expect, it } from 'vitest'
import { executable, parseCliArgs } from '../src/cli.js'

describe('CLI', () => {
  it('uses Windows command shims', () => {
    expect(executable('vite', 'win32')).toBe('vite.cmd')
    expect(executable('shopify', 'linux')).toBe('shopify')
  })

  it('separates wrapper options from Shopify flags', () => {
    expect(parseCliArgs(['--theme-path', 'theme', '--vite-port', '5174', '--environment', 'dev'])).toEqual({
      themePath: 'theme',
      vitePort: 5174,
      shopifyFlags: ['--environment', 'dev'],
    })
    expect(() => parseCliArgs(['--vite-port', 'nope'])).toThrow('between 1 and 65535')
  })
})
