# SMPR chatbot — local test app

Run the whole thing on your own machine before spending a cent or signing up for anything.

```bash
cd chatbot/app
npm install          # only dependency is the Anthropic SDK
npm start
```

Then open:

| | |
|---|---|
| **http://localhost:3000/** | A stand-in shop page with the chat widget on it — this is what a customer sees |
| **http://localhost:3000/admin.html** | Edit prices, answers and shop details, then save |

**It runs with no credentials.** Without an API key the server answers from the built-in matcher,
so you can click through every screen straight away. Set `ANTHROPIC_API_KEY` and the exact same
endpoints start using Claude instead — nothing else changes.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start            # header in the admin now reads "Claude · claude-opus-5"
```

`claude-opus-5` is the default. For a storefront widget answering hundreds of simple questions a
day, `SMPR_MODEL=claude-haiku-4-5` is far cheaper and plenty capable — worth trying both and
seeing whether you can tell the difference.

## What to try

1. Open the storefront, click **Chat with us**, ask *"how much for an iPhone 13 screen"*.
   You get a price card, and the header shows George online or away depending on the real time in
   Sydney.
2. Ask *"how much to replace an iPhone 14 battery"*. It says it doesn't know and gives the phone
   number — because that row is empty.
3. Go to **/admin.html → Prices**, find the highlighted `iPhone 14 / battery` row, type the real
   price, tick **Checked**, hit **Save changes**.
4. Ask the same question again. It now quotes your price. That loop — empty row, fill it in, bot
   starts answering — is the whole maintenance story.
5. **Try it** tab lets you fire questions at the bot without opening the widget.

## How it fits together

```
  storefront page
    └── <script src="/widget.js"></script>     ← one tag, the whole integration
          │  POST /api/chat
          ▼
      server.js
          ├── ANTHROPIC_API_KEY set?  → src/claude.js → Claude, knowledge base cached in the prompt
          └── no key, or the call failed → src/brain.js → local matcher
                                                │
                                     knowledge-base.json
```

The widget holds no answers and no API key — it posts a message and renders what comes back. That
matters: it's why the same file can be dropped into a Shopify theme app extension unchanged.

`src/brain.js` is the same engine the offline `demo.html` runs, injected at build time. Edit it
once, run `../build.sh`, and both stay in step.

## Files

| File | What it does |
|---|---|
| `server.js` | Zero-dependency HTTP server. Static files + `/api/chat`, `/api/kb`, `/api/config`, `/api/status`. |
| `src/claude.js` | The Claude call. Builds the system prompt from the knowledge base and caches it as a prompt prefix. |
| `src/brain.js` | The offline matcher. Also the fallback if a Claude call fails mid-conversation. |
| `src/kb.js` | Loads and saves `knowledge-base.json`, with a sanity check before writing. |
| `public/widget.js` | The embeddable widget. This is the file that becomes the Shopify theme app extension. |
| `public/storefront.html` | Fake shop page so you can see the widget in place. |
| `public/admin.html` | The knowledge base editor — previews the embedded Shopify admin page. |

## Turning this into the Shopify app

What's here already maps onto it one-to-one:

- `public/widget.js` + `widget.css` → **theme app extension** (an app block you switch on in the
  theme editor — no theme code edits, survives theme updates).
- `public/admin.html` → **embedded admin page** inside Shopify.
- `server.js` → the app backend, deployed as its own Railway service, separate from FixDesk.
- `knowledge-base.json` → a **shop metafield**, so the data lives in Shopify and there's no second
  database to run.

The one thing that changes is auth: Shopify session tokens on the admin routes. The chat endpoint
stays exactly as it is.

## Before it goes live

- Rate-limit `/api/chat` per session and per IP. A public chat widget gets abused within a week.
- Log conversations. Clusters of handoffs are the gaps in the knowledge base.
- Work through `meta.verifyBeforeLaunch` in `knowledge-base.json` — the address, the returns
  window and the prices all need confirming.
