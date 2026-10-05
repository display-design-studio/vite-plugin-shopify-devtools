import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['benchmarks/inference.test.ts'], environment: 'jsdom' } })
