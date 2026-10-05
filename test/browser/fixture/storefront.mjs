import { createServer } from 'node:http'

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body><main><div id="shopify-section-template--1__hero" class="shopify-section"><section class="hero"><h1>Autumn collection</h1><article class="product-card" data-card="featured"><span class="money">€120</span></article></section></div></main>
<script type="module" src="http://127.0.0.1:5173/entry.ts"></script></body></html>`

createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(html)
}).listen(9292, '127.0.0.1')
