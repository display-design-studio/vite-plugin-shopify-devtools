import { describe, expect, it } from 'vitest'
import { executable, parseCliArgs, parseMcpArgs } from '../src/cli.js'

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

  it('accepts only a theme path for the MCP server', () => {
    expect(parseMcpArgs([])).toEqual({ themePath: undefined })
    expect(parseMcpArgs(['--theme-path', 'theme'])).toEqual({ themePath: 'theme' })
    expect(() => parseMcpArgs(['--vite-port', '5174'])).toThrow('Unknown MCP option')
    expect(() => parseMcpArgs(['--theme-path'])).toThrow('requires a directory')
  })
})
