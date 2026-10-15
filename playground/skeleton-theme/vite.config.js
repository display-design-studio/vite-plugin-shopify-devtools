import shopifyDevtools, { shopifyDevtoolsConfig } from '@display-studio/vite-plugin-shopify-devtools';
import shopify from '@display-studio/vite-plugin-shopify-theme';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  devtools: shopifyDevtoolsConfig,
  plugins: [
    shopify({
      entries: {
        'main.css': 'frontend/entrypoints/css/main.css',
        'theme.ts': 'frontend/entrypoints/ts/theme.ts',
      },
    }),
    shopifyDevtools({ instrument: 'copy' })  ],
  build: {
    cssMinify: 'esbuild',
  },
  resolve: {
    alias: {
      '@ts': fileURLToPath(new URL('./frontend/entrypoints/ts', import.meta.url)),
      '@css': fileURLToPath(new URL('./frontend/entrypoints/css', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
