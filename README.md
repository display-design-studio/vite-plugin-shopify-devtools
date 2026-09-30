# vite-plugin-shopify-devtools

Development-only source inspection for Shopify Liquid themes using Vite. Hover or click rendered theme components, inspect their Liquid/DOM hierarchy, and open the defining section, theme block, or static snippet in your editor.

## Setup

```sh
npm install -D vite-plugin-shopify-devtools
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import shopify from 'vite-plugin-shopify'
import shopifyDevtools from 'vite-plugin-shopify-devtools'

export default defineConfig({
  plugins: [
    shopify(),
    shopifyDevtools({
      entry: 'frontend/entrypoints/ts/theme.ts',
      editor: undefined,
      allowedOrigins: [],
    }),
  ],
})
```

Run Shopify against the temporary instrumented theme and Vite against the real source tree:

```sh
npx shopify-devtools dev --environment development --live-reload full-page
```

Press `Alt+Shift+D` or the floating target button. Production builds are untouched because the Vite plugin has `apply: 'serve'`; source Liquid files are never rewritten.

## How it works

The CLI copies only Shopify theme directories to an OS temporary directory, instruments Liquid there with `@shopify/liquid-html-parser`, keeps the copy synchronized, and deletes it on shutdown. Static `{% render 'snippet' %}` calls in safe HTML contexts receive comment boundaries. Dynamic or unsafe renders fall back to their enclosing component. Sections and theme-block files get root boundaries; Shopify wrapper IDs and `block.shopify_attributes` provide runtime identity.

The open-editor endpoint requires a per-process bearer token, checks request origins, resolves real paths, and refuses files outside the theme root. Configure `SHOPIFY_STORE_DOMAIN` for a tunneled Shopify preview and add any explicit Vite tunnel origin to `allowedOrigins`.

## Scope

This MVP intentionally excludes Theme Editor iframe integration, Liquid profiling, cart debugging, variable serialization, and npm publication. A marker opens the component definition/root line, not the exact line of every internal HTML element.

## Playground

`playground/skeleton-theme` is a sanitized snapshot of Shopify's public Skeleton theme at commit `c72ec9209e3912f18387906f58dfd1f44b61c4ad`. It excludes `.git`, `.env`, `.shopify`, local `shopify.theme.toml`, and `node_modules`. See its `SNAPSHOT.md` for provenance and local setup.
