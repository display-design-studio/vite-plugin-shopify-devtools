# Release checklist

Releases are tag-only and publish the exact tarball verified by CI. The protected `release` environment must require a maintainer reviewer and allow `v*` tags. Configure npm trusted publishing for organization `display-design-studio`, repository `vite-plugin-shopify-devtools`, workflow `release.yml`, and environment `release`; verify it with `npm trust list @display-studio/vite-plugin-shopify-devtools`.

- [ ] Identify the release commit and confirm the CI and Compatibility workflows are green on that exact SHA.
- [ ] Check out that commit and confirm `git status --short` is empty.
- [ ] Run `bun install --frozen-lockfile`, `bun run check`, `VITE_VERSION=8.3.0 bun run compat:vite`, and `VITE_VERSION=8 bun run compat:vite`.
- [ ] Run `git diff --check` and `npm pack --dry-run --json` with `npm_config_cache` set to a new temporary directory. Verify the package name, manifest version, export map, CLI, runtime dependencies, assets, and published-file allowlist.
- [ ] Create the real tarball in a temporary directory, install it in a clean consumer, and verify the minimal root API, blocked internal subpaths, internal renderer/action loading, and CLI behavior.
- [ ] Confirm `package.json` and `bun.lock` agree and no `package-lock.json` was created.
- [ ] Create and push an annotated `v<manifest-version>` tag without moving an existing tag. The workflow validates, tests, packages, and uploads one tarball; there is no manual dispatch.
- [ ] Approve the `release` environment. npm 11 publishes that same tarball with OIDC provenance and no token or OTP, then the workflow creates the GitHub Release.
- [ ] Verify npm provenance, package files/API, the `latest` dist-tag, and the GitHub Release attachment.
- [ ] Upload `docs/social-preview.png` in GitHub Settings when it changes, and verify the repository description and topics remain unchanged.

Never add npm tokens, OTPs, authorization codes, or store credentials to secrets, commands, issues, or logs for this flow.
