import { fileURLToPath, URL } from 'node:url';
import { defaultAllowedOrigins, defineConfig, loadEnv } from 'vite';
import shopify from 'vite-plugin-shopify';
import shopifyDevtools, { shopifyDevtoolsConfig } from '@display-studio/vite-plugin-shopify-devtools';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isTunnelEnabled = env.SHOPIFY_VITE_TUNNEL === 'true';
  const storeDomain = env.SHOPIFY_STORE_DOMAIN;
  const corsOrigins = [
    defaultAllowedOrigins,
    'http://127.0.0.1:9292',
    'http://localhost:9292',
  ];

  if (storeDomain) {
    corsOrigins.push(`https://${storeDomain}`);
  }

  return {
    devtools: shopifyDevtoolsConfig,
    plugins: [shopify({ tunnel: isTunnelEnabled }), shopifyDevtools()],
    publicDir: 'public',
    build: {
      cssMinify: 'esbuild',
      // assets/ also holds the theme's static files (critical.css, icons), so never wipe it.
      emptyOutDir: false,
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
      cors: {
        origin: corsOrigins,
      },
    },
  };
});
