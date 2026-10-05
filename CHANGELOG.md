# Changelog

All notable changes to this project are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/display-design-studio/vite-plugin-shopify-devtools/releases/tag/v0.1.0
