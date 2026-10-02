# Contributing

Thanks for helping improve `@display-studio/vite-plugin-shopify-devtools`.

## Development setup

Use Bun 1.4.2 and a Node.js version supported by the package:

```sh
bun install --frozen-lockfile
bun run check
git diff --check
```

The compatibility check packs the package, installs it with the selected Vite version in an isolated consumer, imports it, and resolves a serve configuration. It requires network access and deliberately remains outside the canonical `check` command:

```sh
VITE_VERSION=8.3.0 bun run compat:vite
VITE_VERSION=8 bun run compat:vite
```

## Project invariants

- Keep the package ESM-only and preserve the root, `devtools-client`, and `devtools-action` exports.
- Keep the `shopify-devtools` CLI and its development-only behavior; it must never modify the source theme.
- Preserve the intentional runtime dependencies. Do not move them to development dependencies merely to reduce the manifest.
- Production builds remain untouched: the Vite plugin and DevTools integration apply only while serving.
- Source Liquid files are never rewritten. Full mode instruments only a temporary mirror and removes it on shutdown.
- File access and editor launching must remain confined to the resolved theme root.
- Do not commit credentials, store URLs, generated tarballs, npm caches, or playground `node_modules`.

When engines, the Vite peer range, exports, CLI mapping, dependencies, or published files change, update `package.json`, the package contract check, compatibility coverage, and documentation together. Avoid unrelated formatting or changes to the vendored Skeleton Theme playground.

## Pull requests

Keep changes focused and add tests for behavior changes. Describe user-visible behavior, failure modes, and verification performed. Before requesting review, run the canonical suite, both supported Vite compatibility checks, and `git diff --check`.
