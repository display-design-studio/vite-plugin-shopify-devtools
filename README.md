# vite-plugin-shopify-devtools

Development-only source inspection for Shopify Liquid themes, integrated into the official Vite DevTools dock. Hover or click rendered theme components, inspect their Liquid/DOM hierarchy, and open the defining section, theme block, or static snippet in your editor.

## Setup

```sh
npm install -D vite-plugin-shopify-devtools
```

Vite 8.3 or newer is required. The plugin enables Vite DevTools for `vite serve` and injects its embedded client through the configured JavaScript entry because Shopify, rather than Vite, serves the theme HTML.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import shopify from 'vite-plugin-shopify'
import shopifyDevtools, { shopifyDevtoolsBranding } from 'vite-plugin-shopify-devtools'

export default defineConfig({
  devtools: {
    apply: 'serve',
    embeddedVisibility: 'normal',
    // Shopify serves the page from another origin. Disable Vite+'s optional
    // launchers, whose icons use root-relative URLs on the page origin.
    builtinDevTools: false,
    // Inline branding prevents root-relative asset requests on Shopify.
    branding: shopifyDevtoolsBranding,
  },
  plugins: [
    shopify(),
    shopifyDevtools({
      // Optional: force Zed instead of relying on environment variables or
      // installed-editor detection.
      editor: 'zed',
      allowedOrigins: [],
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

Open in editor uses the authenticated Vite DevTools RPC connection. The server resolves real paths and refuses files outside the theme root before launching the editor. Editor selection follows `editor` in the plugin options, then `SHOPIFY_DEVTOOLS_EDITOR`, then `EDITOR`. On macOS, when none of those are set, the plugin auto-detects Zed, Cursor, or Visual Studio Code (in that order). For example, use `editor: 'zed'` to select Zed explicitly. Configure `SHOPIFY_STORE_DOMAIN` for a tunneled Shopify preview and add any explicit Vite tunnel origin to `allowedOrigins` for the cross-origin DevTools bootstrap.

## Scope

This MVP intentionally excludes Theme Editor iframe integration, Liquid profiling, cart debugging, variable serialization, and npm publication. A marker opens the component definition/root line, not the exact line of every internal HTML element.

Official Shopify glyph variants are kept in `assets/shopify/` for the dock button and future light/dark treatments.

## Roadmap / TODO

### A. Less user configuration

Target config:

```ts
export default defineConfig({
  devtools: shopifyDevtoolsConfig,
  plugins: [shopify(), shopifyDevtools()],
})
```

- [x] **A1. Optional `entry`**: auto-detect entrypoints from the `build.rollupOptions.input` resolved by `vite-plugin-shopify` (barrel/shopify-vite) and inject the client into all of them. `entry` stays as an override.
- [ ] **A2. Optional `allowedOrigins`**: always allow `127.0.0.1:9292` / `localhost:9292`, `*.myshopify.com`, and the store from `SHOPIFY_STORE_DOMAIN` or `shopify.theme.toml`. Verify the merge with a user-defined `server.cors`; remove or use the dead `isAllowedOrigin`.
- [ ] **A3. `devtools` block**: Vite rejects plugins changing `devtools` from `config()`, so export a `shopifyDevtoolsConfig` preset and warn in `configResolved` when `devtools` is missing or misconfigured. Spike: return the `DevTools()` plugins from `shopifyDevtools()` for zero config.
- [ ] **A4. Cleanup**: read `themeRoot` from the resolved Vite config in `src/cli.ts` and `src/mirror.ts`; simplify the playground config; update this README.

### B. Shopify branding in Vite DevTools style

- [ ] **B1. Branding**: tune `primaryColor` (Shopify green), add `tagline`, a real wordmark, and a square-boxed glyph.
- [ ] **B2. Dock icons**: normalize to a square 24 viewBox displayed at 20px like Vite; consider `mask:` icons so they follow `currentColor`/`text-primary`.
- [ ] **B3. Panel and toolbar**: replace the purple accents with tokens derived from the Shopify green; match Vite borders, blur, radius, and 18–20px icons; match Vite animations (`.3s cubic-bezier(.4,0,.2,1)` hover `scale(1.1)` / selected `scale(1.2)`, `.15s` buttons, `.5s cubic-bezier(.16,1,.3,1)` panel) and honor `prefers-reduced-motion`.
- [ ] **B4. Inspector**: change the Nuxt green (`#00dc82`) to Shopify green and add a short highlight transition.

## Playground

`playground/skeleton-theme` is a sanitized snapshot of Shopify's public Skeleton theme at commit `c72ec9209e3912f18387906f58dfd1f44b61c4ad`. It excludes `.git`, `.env`, `.shopify`, local `shopify.theme.toml`, and `node_modules`. See its `SNAPSHOT.md` for provenance and local setup.
