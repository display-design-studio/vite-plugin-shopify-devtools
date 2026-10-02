# @display-studio/vite-plugin-shopify-devtools

[![npm version](https://img.shields.io/npm/v/@display-studio/vite-plugin-shopify-devtools.svg)](https://www.npmjs.com/package/@display-studio/vite-plugin-shopify-devtools)
[![license](https://img.shields.io/npm/l/@display-studio/vite-plugin-shopify-devtools.svg)](LICENSE)

Development-only source inspection for Shopify Liquid themes, integrated into the official Vite DevTools dock. Hover or click rendered theme components, inspect their Liquid/DOM hierarchy, and open the defining section, theme block, or static snippet in your editor.

## Setup

```sh
npm install -D @display-studio/vite-plugin-shopify-devtools
```

Vite 8.3 or newer is required, and it must be a direct dependency of your project (`npm install -D vite@^8.3`). Older Vite versions ignore the `devtools` option, so the browser console shows `Unable to load Vite DevTools connection metadata (404)`. Check your Vite version if you see it. The plugin enables Vite DevTools for `vite serve` and injects its embedded client through the configured JavaScript entry because Shopify, rather than Vite, serves the theme HTML.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import shopify from 'vite-plugin-shopify'
import shopifyDevtools, { shopifyDevtoolsConfig } from '@display-studio/vite-plugin-shopify-devtools'

export default defineConfig({
  devtools: shopifyDevtoolsConfig,
  plugins: [
    shopify(),
    shopifyDevtools({
      // Optional: force Zed instead of relying on environment variables or
      // installed-editor detection.
      editor: 'zed',
    }),
  ],
})
```

Run Shopify against the temporary instrumented theme and Vite against the real source tree:

```sh
npx shopify-devtools dev --environment development --live-reload full-page
```

Open **Shopify Liquid** from the Vite DevTools dock. Use **Inspect page** in the panel header or the dedicated inspector action in the dock to pick a rendered component. Production builds are untouched because both the plugin and DevTools integration use `apply: 'serve'`; source Liquid files are never rewritten.

## How it works

The Vite plugin registers a native `custom-render` panel through `devtools.setup`, so the component tree and inspector live inside Vite's shared dock rather than a separate imitation toolbar. The CLI copies only Shopify theme directories to an OS temporary directory, instruments Liquid there with `@shopify/liquid-html-parser`, keeps the copy synchronized, and deletes it on shutdown. Static `{% render 'snippet' %}` calls in safe HTML contexts receive comment boundaries. Dynamic or unsafe renders fall back to their enclosing component. Sections and theme-block files get root boundaries; Shopify wrapper IDs and `block.shopify_attributes` provide runtime identity.

Open in editor uses the authenticated Vite DevTools RPC connection. The server resolves real paths and refuses files outside the theme root before launching the editor. See [Choosing an editor](#choosing-an-editor) for how the editor is selected. The cross-origin DevTools bootstrap is allowed automatically for the Shopify CLI preview (`127.0.0.1:9292`, `localhost:9292`), `*.myshopify.com`, and the store from `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_FLAG_STORE`, or `shopify.theme.toml`. Only custom domains or tunnels need `allowedOrigins`.

### Choosing an editor

The editor is picked in this order:

1. the `editor` plugin option, e.g. `editor: 'atom'`
2. the `SHOPIFY_DEVTOOLS_EDITOR` environment variable, e.g. `SHOPIFY_DEVTOOLS_EDITOR=subl`
3. the `EDITOR` environment variable, e.g. `EDITOR=code`
4. on macOS only: auto-detection of Zed, Cursor, or Visual Studio Code (in that order)

Set one of the first three if you use a different editor, have several installed, or are not on macOS (there is no auto-detection on Linux or Windows). Files open at the component's line in any editor supported by [`launch-editor`](https://github.com/yyx990803/launch-editor), including Atom, Sublime Text, VS Code, WebStorm, Vim, and Emacs.

Terminal editors (`vim`, `emacs`, `nano`) run inside the terminal where Vite is running and take it over until you quit. Prefer a GUI editor or a windowed variant such as `gvim` or `mvim`.

## Scope

This MVP intentionally excludes Theme Editor iframe integration, Liquid profiling, cart debugging, and variable serialization. A marker opens the component definition/root line, not the exact line of every internal HTML element.

The dock button, logo, and favicon use the full-color Shopify bag (`assets/shopify/shopify-glyph.svg`) on both themes. The black and white glyph variants stay in `assets/shopify/` for monochrome treatments.

## Playground

`playground/skeleton-theme` is a snapshot of Shopify's official [Skeleton theme](https://github.com/Shopify/skeleton-theme) (`main`, commit `a4f32d393b9eadf6c4403318ca39116832e5d1df`) with Vite set up like the Display starter (one CSS and one TS entrypoint) and wired to this plugin. It excludes `.git`, `.env`, `.shopify`, local `shopify.theme.toml`, and `node_modules`. See its `SNAPSHOT.md` for provenance and local setup.
