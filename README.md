# @display-studio/vite-plugin-shopify-devtools

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Build][build-src]][build-href]

Development-only source inspection for Shopify Liquid themes, integrated into the official Vite DevTools dock. Hover or click rendered theme components, inspect their Liquid/DOM hierarchy, and open the defining section, theme block, or static snippet in your editor.

![Liquid DevTools panel listing the sections, blocks and snippets of a Shopify page](https://raw.githubusercontent.com/display-design-studio/vite-plugin-shopify-devtools/main/docs/devtools-panel.png)

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

That is all: keep running your project the way you already do (Vite alongside `shopify theme dev`). The plugin works next to [`vite-plugin-shopify`](https://github.com/barrel/shopify-vite) and `vite-plugin-shopify-theme`, needs no extra script, and does not touch your theme files.

Open **Shopify Liquid** from the Vite DevTools dock. Use **Inspect page** in the panel header or the dedicated inspector action in the dock to pick a rendered component. Production builds are untouched because both the plugin and DevTools integration use `apply: 'serve'`, and source Liquid files are never rewritten.

### Navigating the component tree

Use the search field to filter by component name, theme-relative path, kind, JSON section key or name, and the **Template** or **Section group** badge. Matching entries keep their ancestors visible and expand their paths temporarily. Disclosure arrows collapse branches, and that state is saved for the current storefront origin.

The tree supports standard keyboard navigation: Up and Down move through visible entries, Right expands a branch or enters its first child, Left collapses it or moves to its parent, and Enter opens the focused component in your editor. Selecting an entry brings it into view in the tree without moving the storefront page. The details card can copy the relative source path, `file:line` location, and Shopify ID when one is available.

## What it detects

| Mode | Setup | Detects |
| --- | --- | --- |
| **Default** | none | Sections and section groups, matched to their `sections/*.liquid` file from the JSON templates and section groups of your theme. Blocks and snippets inside them are **inferred** (see below). |
| **Full mode** | start the theme through `shopify-devtools dev` | Sections, theme blocks, and static snippets, including their nesting, read exactly from markers. |

### Inferred blocks and snippets

Shopify leaves no trace of blocks and snippets in the HTML it renders, so in the default mode the plugin works them out. The server reads your Liquid, follows the static `{% render 'snippet' %}` calls and the blocks of each section, and records the markup each file emits first (tag, static classes, static `id` and `data-*` attributes). The panel then looks for that markup inside the section on the page and nests what it finds. Inferred entries are labelled **inferred**.

It is a best effort, tuned to prefer showing nothing over showing something wrong:

- Snippets that print no element of their own, or whose first element has no class or attribute to recognise it by, are not shown.
- Two different components with identical markup inside the same parent are left out.
- Markup that JavaScript rewrites after the page loads (Vue or React islands, for example) cannot be matched.
- Dynamic parts of a class list are ignored: `class="card card--{{ size }}"` is recognised by `card`.

Use the full mode when you need the exact tree. On a page served in full mode you can also measure how close the inference gets by running `await shopifyDevtools.compareInference()` in the browser console: it returns precision, recall, and the entries that were wrongly added or missed.

### Full mode

Blocks and snippets leave no trace in the HTML that Shopify renders, so the full tree needs markers in the Liquid. `shopify-devtools dev` writes them into a temporary copy of your theme (your source files are never modified), serves that copy through `shopify theme dev`, and starts `vite` for you. It forwards its flags to Shopify, so it replaces your usual dev script (for example one that runs both with `concurrently`):

```json
{
  "scripts": {
    "dev": "shopify-devtools dev --environment development",
    "dev:plain": "concurrently \"shopify theme dev\" \"vite\""
  }
}
```

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

## Using it with Vue

The plugin only inspects the Shopify side of your theme (sections, blocks, snippets); it never looks at Vue components. Vue tooling can sit next to it:

- **`@vitejs/plugin-vue`** works as usual.
- **Vue DevTools 8** (`vite-plugin-vue-devtools@8`) works. Shopify serves your HTML, so there is no `index.html` to inject into: point `appendTo` at your JavaScript entry. Its panel opens with Alt+Shift+D and its button sits next to the Shopify one.

  ```ts
  import vueDevTools from 'vite-plugin-vue-devtools'

  export default defineConfig({
    devtools: shopifyDevtoolsConfig,
    plugins: [shopify(), vue(), vueDevTools({ appendTo: 'frontend/entrypoints/theme.ts' }), shopifyDevtools()],
  })
  ```

- **Vue DevTools 9 (beta)** shares the Vite DevTools dock with this plugin and its entry shows up there, but its panel cannot reach the page yet. The panel is an iframe served by Vite while the page comes from Shopify, and Vue's connection between the two only accepts the same origin, so the component tree stays empty. Use version 8 for now. The plugin does rewrite root-relative iframe dock URLs to point at the Vite server, which makes other iframe-based docks work on a Shopify-hosted page.

To add options of your own to the `devtools` setting, spread the preset: `devtools: { ...shopifyDevtoolsConfig, clientAuth: false }`.

## Scope

This MVP intentionally excludes Theme Editor iframe integration, Liquid profiling, cart debugging, and variable serialization. A marker opens the component definition/root line, not the exact line of every internal HTML element.

The dock button, logo, and favicon use the full-color Shopify bag (`assets/shopify/shopify-glyph.svg`) on both themes. The black and white glyph variants stay in `assets/shopify/` for monochrome treatments.

## Playground

`playground/skeleton-theme` is a snapshot of Shopify's official [Skeleton theme](https://github.com/Shopify/skeleton-theme) (`main`, commit `a4f32d393b9eadf6c4403318ca39116832e5d1df`) with Vite set up like the Display starter (one CSS and one TS entrypoint) and wired to this plugin. It excludes `.git`, `.env`, `.shopify`, local `shopify.theme.toml`, and `node_modules`. See its `SNAPSHOT.md` for provenance and local setup.

<!-- Badges -->

[npm-version-src]: https://npmx.dev/api/registry/badge/version/@display-studio/vite-plugin-shopify-devtools
[npm-version-href]: https://npmx.dev/package/@display-studio/vite-plugin-shopify-devtools
[npm-downloads-src]: https://npmx.dev/api/registry/badge/downloads/@display-studio/vite-plugin-shopify-devtools
[npm-downloads-href]: https://npmx.dev/package/@display-studio/vite-plugin-shopify-devtools
[build-src]: https://img.shields.io/github/actions/workflow/status/display-design-studio/vite-plugin-shopify-devtools/ci.yml?branch=main&style=flat-square&label=build
[build-href]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/actions/workflows/ci.yml
