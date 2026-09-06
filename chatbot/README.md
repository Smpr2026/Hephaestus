# SMPR Assistant

A customer chatbot for **Sydney Mobile Phone Repairs** — design plus a working prototype.

## Try it

Open `demo.html` in any browser (double-click works — no server needed). Click **Chat with us**
bottom-right, then either type a question or click one from the 119-question bank on the right.
Tick **Show matched intent** to see which knowledge-base entry produced each answer.

## What's here

| File | What it is |
|---|---|
| **`DESIGN.md`** | The design — coverage map, conversation flow, pricing rules, guardrails, voice, build plan. Start here. |
| **`knowledge-base.json`** | Every business fact and every answer. **This is the only file you edit for content.** |
| **`demo.html`** | The working prototype. Self-contained. |
| **`artifact.html`** | The same prototype shaped for publishing to claude.ai. |
| **`system-prompt.md`** | The production Claude prompt and implementation notes. |
| **`build.sh`** | Rebuilds `demo.html` from `knowledge-base.json` and `app/src/brain.js`. |
| **`app/`** | Local test app — server, widget, admin editor. See `app/README.md`. |

## Run it in the Claude app

Published as a private Artifact — open it from the Claude app or any browser, no install:

**https://claude.ai/code/artifact/aa33d3a7-42b2-4d3f-a183-d83042465051**

It runs the built-in matcher, same as `demo.html`. Live Claude answers need the backend in `app/`.
Source is `artifact.html`, rebuilt by `build.sh` alongside the demo.

## Run it locally

There's a full local test app in `app/` — a server, the embeddable widget on a stand-in shop page,
and an editor for the prices and answers:

```bash
cd chatbot/app
npm install
npm start          # → http://localhost:3000
```

It runs with no API key (answers from the built-in matcher) and switches to Claude the moment you
set `ANTHROPIC_API_KEY`. See `app/README.md`.

## Changing an answer or a price

Either edit `knowledge-base.json` by hand, or use the editor at
`http://localhost:3000/admin.html` when the local app is running — it writes to the same file.

After a hand edit, run `./build.sh` and refresh `demo.html`. The local app picks changes up on
save, no rebuild needed.

Prices live in `pricing.repairs`. A row set to `null` means the bot says *"I don't have that one
listed — call us"* rather than guessing, so filling a blank in is what turns a handoff into an
answer:

```json
{ "brand": "Apple", "model": "iPhone 14", "repair": "battery",
  "aftermarket": 89, "genuine": null, "verified": true }
```

## Testing it

```bash
cd chatbot/app && npm test
```

Covers coverage, pricing honesty and the guardrails. See `app/README.md`.

## Before this goes live

`knowledge-base.json` opens with a `meta.verifyBeforeLaunch` list. The ones that matter most:

- **The address contradicts itself.** The SEO pages say 290 Kingsgrove Road, Kingsgrove. The
  Shopify contact policy and a live product description say 480 King Georges Road, Beverly Hills.
  The bot currently uses Kingsgrove. Fix whichever source is wrong.
- **The returns policy contradicts itself.** Refund Policy page says 30 days, refund to card.
  Shipping Policy page says 2 days, store credit only. Pick one.
- **`info@` vs `quotes@`** — both are in use across the site.
- **The prices need confirming.** The iPhone screen prices came from real Shopify variants, but
  those products are in DRAFT and a few rows disagree with each other. Every row is marked
  `"verified": false` until you say otherwise.

## A note on the demo's matching

The prototype runs a keyword matcher so it works offline with no API key — it handles all 119
bank questions and a good range of unseen phrasings, but it can be thrown by an unusual sentence.
That's a property of the demo, not the design. In production the same knowledge base goes into a
Claude system prompt (`system-prompt.md`), which handles the messy real-world phrasings; the
knowledge base is what stops it inventing anything.
