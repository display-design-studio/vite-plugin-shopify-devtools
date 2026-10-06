import { createServer } from 'node:http'

// A deterministic, credential-free rendering of the local Skeleton homepage. The
// Liquid source remains the source of truth for inference; this is the HTML that
// those files would produce on Shopify.
const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #111318; color: #f3f4f6 }
  * { box-sizing: border-box } body { margin: 0; background: radial-gradient(circle at 20% 0%, #253046 0, #111318 46%); min-height: 100vh }
  .store { width: min(1080px, calc(100% - 64px)); margin: auto; padding: 48px 0 120px }
  .welcome { padding: 34px; border: 1px solid #343946; border-radius: 18px; background: #191c23 }
  .welcome h1 { margin: 0 0 12px; font-size: 44px } .welcome p { max-width: 720px; color: #aeb4c0; line-height: 1.55 }
  .inference-demo { display: grid; gap: 20px; padding: 42px 0 } .inference-demo__title { margin: 0; font-size: 28px }
  .inference-demo__cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px }
  .demo-card { min-height: 128px; padding: 18px; border: 1px solid #383e4b; border-radius: 14px; background: #1b1f27 }
  .demo-card--wide { background: #202536 } .demo-card__title { margin: 0 0 24px }
  .demo-badge { display: inline-block; padding: 4px 8px; border-radius: 99px; color: #b8c8ff; background: #28365f; font-size: 12px }
  .demo-button { float: right; color: #111318; background: #d8ff62; padding: 6px 10px; border-radius: 7px; text-decoration: none; font-weight: 700 }
  .inference-demo__features { display: flex; gap: 12px; padding: 0; list-style: none; color: #c9ced8 }
  .demo-feature, .demo-cta { padding: 10px 12px; border: 1px solid #343946; border-radius: 10px } .demo-icon { vertical-align: -3px; margin-right: 5px }
  .custom-section { border-top: 1px solid #303541; padding-top: 24px }.group { display: flex; gap: 12px }.text { color: #aeb4c0 }
</style></head><body><main class="store">
<div id="shopify-section-template--1__main" class="shopify-section"><div class="welcome full-width"><div class="welcome-content"><div><h1>Hello, World!</h1><p class="welcome-description">The Skeleton theme is a minimal, carefully structured Shopify theme for building modular storefronts.</p></div></div></div><div class="highlights"><div class="highlight"><h3>Key Concepts</h3></div><div class="highlight"><h3>Liquid</h3></div><div class="highlight"><h3>Best Practices</h3></div></div></div>
<div id="shopify-section-template--1__demo" class="shopify-section"><section class="inference-demo"><h2 class="inference-demo__title">Inference demo</h2><div class="inference-demo__cards">
<article class="demo-card demo-card--1"><h3 class="demo-card__title">Card 1</h3><span class="demo-badge">New</span><a class="demo-button" href="#">Open</a></article>
<article class="demo-card demo-card--2"><h3 class="demo-card__title">Card 2</h3><span class="demo-badge">New</span><a class="demo-button" href="#">Open</a></article>
<article class="demo-card demo-card--3"><h3 class="demo-card__title">Card 3</h3><span class="demo-badge">New</span><a class="demo-button" href="#">Open</a></article>
<article class="demo-card demo-card--wide"><p class="demo-panel__text">A wide panel</p><a class="demo-button" href="#">Wide</a></article></div>
<ul class="inference-demo__features"><li class="demo-feature" data-shopify-editor-block='{"id":"feature_a","type":"feature"}'><svg class="demo-icon" width="16" height="16"><circle cx="8" cy="8" r="6" fill="currentColor"></circle></svg><span>Fast</span></li><li class="demo-feature" data-shopify-editor-block='{"id":"feature_b","type":"feature"}'><svg class="demo-icon" width="16" height="16"><circle cx="8" cy="8" r="6" fill="currentColor"></circle></svg><span>Simple</span></li><li class="demo-cta" data-shopify-editor-block='{"id":"cta_a","type":"cta"}'><a class="demo-button" href="#">Buy now</a></li></ul><p class="inference-demo__price">€19.99</p></section></div>
<div id="shopify-section-template--1__theme_blocks" class="shopify-section"><div class="custom-section full-width"><div class="custom-section__content"><div class="group group--vertical" data-shopify-editor-block='{"id":"group_a","type":"group"}'><div class="text text--title" data-shopify-editor-block='{"id":"text_a","type":"text"}'>Build with blocks</div><div class="text text--title" data-shopify-editor-block='{"id":"text_b","type":"text"}'>Powered by Skeleton</div></div></div></div></div>
</main><script>globalThis.ShopifyAnalytics = { meta: { page: { pageType: 'home' } } }</script><script type="module" src="http://127.0.0.1:5173/entry.ts"></script></body></html>`

createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(html)
}).listen(9292, '127.0.0.1')
