# Shopify-hosted test build

The chatbot test page lives on the **unpublished Dawn theme**
(`gid://shopify/OnlineStoreTheme/132578246807`) so nothing touches the live store.

Preview URLs (share with staff only):

- https://sydneymobilephonerepairs.com.au/pages/faq?view=smpr-bot&preview_theme_id=132578246807
- https://smpr2021.myshopify.com/pages/faq?view=smpr-bot&preview_theme_id=132578246807

## Files on the theme

| Theme file | Source here |
|---|---|
| `templates/page.smpr-bot.liquid` | `page.smpr-bot.liquid` |
| `assets/smpr-bot.css` | `smpr-bot.css` |
| `assets/smpr-bot-loader.js` | `smpr-bot-loader.js` |
| `assets/smpr-bot-p1.js` … `p4.js` | `part01.txt` … `part04.txt` (each wrapped as `window.__SPn="<chunk>";`) |

`smpr-bot-payload.js` is the full page script (slim knowledge base + brain + UI shell
with live storefront search via `/search/suggest.json` and cart-id lookup via
`/products/{handle}.js`). It is gzipped, base64-encoded and split into the four
`partNN.txt` chunks; the loader joins them, gunzips in the browser with
`DecompressionStream`, and evals the result.

## Rebuilding after a knowledge-base change

```sh
cd chatbot/shopify
# regenerate payload parts
node -e "
const fs=require('fs'),zlib=require('zlib');
const gz=zlib.gzipSync(fs.readFileSync('smpr-bot-payload.js'));
const b64=gz.toString('base64');
for(let i=0;i*20000<b64.length;i++)
  fs.writeFileSync('part0'+(i+1)+'.txt', b64.slice(i*20000,(i+1)*20000));
console.log('parts:', Math.ceil(b64.length/20000), 'b64 chars:', b64.length);
"
```

Then re-upload each part to the Dawn theme. **Upload lesson learned:** pasting
20 KB base64 chunks by hand into API calls gets corrupted; instead use
`stagedUploadsCreate` + `curl -F file=@…` + `themeFilesUpsert` with a `URL` body,
and verify with `checksumMd5` against the local file.

Known leftover: `assets/smpr-bot-probe.html` on the Dawn theme is a harmless
stray test file the API is not allowed to delete — remove it in
Admin → Online Store → Themes → Dawn → Edit code.
