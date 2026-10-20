# Changelog

All notable changes to this project are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Closing the server twice at once, as happens with Vite's SIGTERM handler plus another plugin's handler, no longer lets the second caller return before the `.shopify-devtools/theme` mirror is removed. Concurrent closes now share one removal, so the process cannot exit with the mirror still on disk.
- `instrument: 'copy'` no longer deletes the `.shopify-devtools/theme` mirror as soon as the dev server starts. The mirror was closed from a `configureServer` post hook, which Vite runs once at startup, so `SHOPIFY_FLAG_PATH=.shopify-devtools/theme` pointed at a missing folder and Shopify CLI failed with `A path was explicitly provided but doesn't exist`. The mirror is now closed when the server closes.

### Added

- `shopify-devtools doctor` checks the Vite version, DevTools preset, theme root, JavaScript entry, `.gitignore` and `shopify.theme.toml`.
- `shopify-devtools init` adds the plugin, the `devtools` preset and `.shopify-devtools/` to an existing setup.
- Hovering a tree entry highlights its component on the page.
- "Liquid tag" detail with a copyable `{% section %}`, `{% render %}` or `{% content_for 'block' %}` tag.
- `Alt+Shift+L` toggles the inspector.
- "Open in Theme Editor" action, built from `Shopify.shop` and `Shopify.theme.id`.
- Collapsed "Settings" list for sections and blocks: the settings declared in `{% schema %}`, with the value stored in the template JSON or the default.

### Changed

- The tree starts collapsed and remembers what you expand. Selecting an entry scrolls the page to its component.
- The playground now uses `@display-studio/vite-plugin-shopify-theme`.

## [0.4.0] - 2026-10-06

### Added

- Managed copy and recoverable in-place full-mode instrumentation.
- Inferred blocks, app components, confidence ratings, diagnostics, and a multi-theme benchmark.
- Tree navigation, persisted layout, copy actions, settings, and snippet call-site navigation.
- Browser end-to-end coverage, reproducible documentation assets, and trusted-publishing automation.

### Changed

- The supported root API is now limited to the default plugin, `shopifyDevtoolsConfig`, `shopifyDevtoolsBranding`, and the `ShopifyDevtoolsOptions` type. The pre-1.0 diagnostic helpers and `devtools-client`/`devtools-action` subpaths are no longer public; their built files remain internal implementation details.

## [0.3.0] - 2026-03-20

### Added

- Default-mode inference for blocks and static snippets.
- Compatibility guidance and URL rewriting for iframe dock plugins.

## [0.2.0] - 2026-03-18

### Added

- Default section discovery on pages without full-mode markers.
- Documentation for default and full detection modes.

## [0.1.0] - 2026-03-17

### Added

- Initial dock, Liquid inspector, editor integration, authenticated RPC, CLI wrapper, and full-mode instrumentation.

[Unreleased]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/releases/tag/v0.1.0
