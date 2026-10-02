# Release checklist

This checklist is for repository maintainers. It is intentionally excluded from the npm package, and applies to whichever version is present in `package.json`.

- [ ] Identify the release commit and confirm the CI and Compatibility workflows are green on that exact SHA.
- [ ] Check out that commit and confirm `git status --short` is empty.
- [ ] Run `bun install --frozen-lockfile`, `bun run check`, `VITE_VERSION=8.3.0 bun run compat:vite`, and `VITE_VERSION=8 bun run compat:vite`.
- [ ] Run `git diff --check` and `npm pack --dry-run --json` with `npm_config_cache` set to a new temporary directory. Verify the package name, manifest version, export map, CLI, runtime dependencies, assets, and published-file allowlist.
- [ ] Create the real tarball in a temporary directory, install it in a clean temporary consumer, and verify the root, `devtools-client`, and `devtools-action` imports plus `shopify-devtools` usage behavior.
- [ ] Confirm `package.json` and `bun.lock` agree and no `package-lock.json` was created.
- [ ] Create an annotated `v<manifest-version>` tag on the verified commit and push it without moving or recreating an existing tag. The release workflow requires the ref to be that exact tag.
- [ ] From a clean checkout of the tagged commit, run `npm whoami`, then publish locally with `npm publish --access public`. Enter the six-digit 2FA code only at npm's interactive prompt; never put it in chat, a file, an environment variable, or the command line.
- [ ] Verify the published package, its files, metadata, imports, CLI, and that the `latest` dist-tag points to the manifest version. Install it once more in a clean temporary consumer.
- [ ] Approve the final `release` environment only after the npm checks pass, allowing the workflow to create the GitHub Release with generated notes.

Tagging and npm publication remain deliberate local maintainer actions. The workflow receives no npm token and never runs `npm publish`.
