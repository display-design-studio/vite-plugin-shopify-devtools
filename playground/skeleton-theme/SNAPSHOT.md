# Skeleton theme snapshot

This directory was exported from the public Skeleton theme repository at commit:

`c72ec9209e3912f18387906f58dfd1f44b61c4ad`

The snapshot was produced with `git archive`, so it contains only committed files and has no repository metadata. Local secrets and generated state (`.env`, `.shopify`, `shopify.theme.toml`, `.git`, and `node_modules`) are absent.

Install this package first, then install the playground dependencies:

```sh
cd ../..
npm install
npm run build
cd playground/skeleton-theme
npm install
cp .env.example .env
cp example.shopify.theme.toml shopify.theme.toml
npm run dev
```
