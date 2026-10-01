import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import shopify from 'vite-plugin-shopify';
import shopifyDevtools, { shopifyDevtoolsConfig } from 'vite-plugin-shopify-devtools';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isTunnelEnabled = env.SHOPIFY_VITE_TUNNEL === 'true';
  return {
    devtools: shopifyDevtoolsConfig,
    plugins: [
      shopify({ tunnel: isTunnelEnabled }),
      shopifyDevtools(),
      tailwindcss(),
    ],
    publicDir: 'public',
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
  };
});
