import { defineConfig } from 'vite'
import shopifyDevtools, { shopifyDevtoolsConfig } from '../../../dist/public.js'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  devtools: { ...shopifyDevtoolsConfig, clientAuth: false },
  build: { rollupOptions: { input: 'entry.ts' }, outDir: 'theme/assets' },
  plugins: [shopifyDevtools({ themeRoot: new URL('./theme', import.meta.url).pathname })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
