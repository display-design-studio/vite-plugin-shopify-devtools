import { URL } from 'node:url'
import { defineConfig } from 'vite'
import shopifyDevtools, { shopifyDevtoolsConfig } from '../../../dist/public.js'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  devtools: { ...shopifyDevtoolsConfig, clientAuth: false },
  // The plugin derives the theme root used by its RPC from Vite's output
  // directory, matching how Shopify Vite integrations are configured.
  build: {
    rollupOptions: { input: 'entry.ts' },
    outDir: new URL('../../../playground/skeleton-theme/assets/', import.meta.url).pathname,
  },
  plugins: [shopifyDevtools({ themeRoot: new URL('../../../playground/skeleton-theme/', import.meta.url).pathname })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
