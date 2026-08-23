# SMPR Assistant — chatbot design

A customer-facing chatbot for Sydney Mobile Phone Repairs, designed to cover the full range of
questions a customer can arrive with: repairs, prices, faults, warranty, data, mail-in, the online
store, orders, returns, payment and everything around the shop itself.

---

## 1. What it's for

SMPR is a walk-in shop with a phone that rings all day and a Shopify store that takes orders
overnight. The same twenty questions come in on repeat — *how much for an iPhone 13 screen, are
you open Sunday, do you fix Samsung, where's my order, is my data safe*. Every one of those is an
interruption during a repair, or an email answered at 9pm, or a customer who bounces because
nobody picked up.

The bot's job is narrow and useful:

1. **Answer the repeat questions instantly**, 24/7, in the shop's own voice.
2. **Get the walk-in through the door** — every answer ends pointing at the phone number or the
   shop, because that's where the money is.
3. **Never cost a sale by being wrong.** A wrong price or a wrong promise is worse than no bot.

What it is explicitly *not*: it doesn't take bookings (walk-in shop, no diary), it doesn't look up
orders (no systems access), and it doesn't take payments.

---

## 2. Coverage map

"Every question possible" is really fourteen topics. Each one is a set of entries in
`knowledge-base.json`, and each entry is a question a customer actually asks, phrased their way.

| Topic | Covers | Entries |
|---|---|---|
| **Store** | Hours, Sunday and public holidays, address, parking, transport, contact, appointments, waiting times, suburbs served, how long they've been around | 11 |
| **Repairs** | What's repaired, brands, device types, turnaround, free assessment, board-level work | 6 |
| **Pricing** | Model-specific prices, genuine vs aftermarket, discounts, price matching | 4 + price table |
| **Faults** | Cracked screens, batteries, charging, water, dead phones, cameras, audio, back glass, buttons, Face ID, software, network, overheating | 14 |
| **Data** | Backups, passcodes, data safety, photo recovery | 4 |
| **Warranty** | Length, what's covered, what voids it, how to claim, online-purchase warranty | 5 |
| **Mail-in** | How it works, postage, timing | 3 |
| **Online store** | What's sold, refurbished grades, stock, click & collect, product prices | 5 |
| **Orders** | Status, tracking, shipping cost, delivery time, international, PO boxes, address changes, cancellation, damaged parcels | 9 |
| **Returns** | Returns process, refund timing, exchanges | 3 |
| **Payment** | Methods, buy-now-pay-later, deposits, tax invoices, insurance quotes | 5 |
| **Selling** | Trade-ins and buying phones | 1 |
| **Other** | Carrier unlocking, business and school accounts, complaints, reviews, jobs, languages, accessibility | 7 |
| **Conversation** | Greeting, bot identity, human handoff, thanks, goodbye, off-topic, prompt-injection attempts | 7 |

Plus **three hard refusals** that sit in front of everything else: iCloud/FRP bypass, devices that
aren't the customer's, and spyware requests.

**Total: 82 answers + a model-level price table + 3 refusals.** The demo ships with a bank of 119
real customer phrasings and routes all of them without falling through.

### Where coverage is deliberately thin

These route to a handoff rather than an answer, because the bot can't know:

- Live stock levels and specific order status — no systems access.
- Any price not in the table (see §4).
- Public holiday hours, buy-now-pay-later availability, the mail-in postal address — all flagged
  in `knowledge-base.json` under `meta.verifyBeforeLaunch` for George to confirm.

---

## 3. How a conversation goes

```
                          customer message
                                 │
                    ┌────────────▼────────────┐
                    │  1. refusal check       │  iCloud bypass, stolen device,
                    │     (before anything)   │  spyware → refuse, offer the
                    └────────────┬────────────┘  legitimate path instead
                                 │
                    ┌────────────▼────────────┐
                    │  2. price question?     │  device model + repair type
                    │     model + fault       │  detected → price card
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  3. topic match         │  82 knowledge-base answers
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  4. handoff             │  "I'd rather not guess —
                    │     phone + address     │   call (02) 8957 1077"
                    └─────────────────────────┘
```

Every answer carries up to three **follow-up chips** — the next question that customer is most
likely to ask. A price answer offers *Genuine or aftermarket? · Do I need a booking? · Where are
you?* That's what turns a price check into a visit.

The handoff is the same every time — phone number and address, as a tappable call button on
mobile. No lead forms, no "someone will get back to you", no promises the shop can't keep while
the counter is busy.

---

## 4. Pricing — the rule that matters most

George's brief: *get as close to the real price as we can, then have them call to confirm,
because it depends on the parts.*

So the bot works from a table, not a guess:

- **The price exists in the table** → quote it as a guide, show aftermarket next to genuine, name
  the 3-month warranty, and say the final price is confirmed once we see the device.
- **The price is blank** → say so plainly and give the phone number. **It never estimates from a
  similar model.** An iPhone 14 battery price is not an iPhone 13 battery price, and a customer
  who's told $89 and charged $110 is a customer lost.
- **Online products** → point at the product page, offer the phone to confirm price and stock in
  one call.

The table currently holds **real screen prices for iPhone 11 through 15**, pulled from the Shopify
store. Everything else — batteries, charge ports, all Samsung models — is blank on purpose, so the
bot handballs those to the phone until George fills them in. Filling in a row is one line of JSON
and the bot starts quoting it.

> ⚠️ **The Shopify price data contradicts itself in places** (iPhone 12 aftermarket screens are
> listed at both $150 and $160; the iPhone 12 Mini "copy" price is higher than the genuine one).
> Those products are also sitting in DRAFT. Every row is marked `"verified": false` until George
> confirms it.

---

## 5. Guardrails

Ten rules the bot doesn't break. They live in `knowledge-base.json` under `guardrails` and again
in the production system prompt.

**Money and promises**
1. Never invent a price. Blank means "call us", not "estimate it".
2. Never call a price final — it's a guide, confirmed in store.
3. Never promise same-day on water damage or board-level work.
4. Never quote stock or order status.

**Legal and reputational**
5. Never say Apple authorised / certified / manufacturer trained. SMPR is an independent
   repairer and claiming otherwise is a real legal exposure.
6. Be honest about aftermarket trade-offs — the "unknown part" notice, True Tone — rather than
   promising everything will be identical.

**Safety and privacy**
7. Never accept a passcode, PIN or card number in the chat.
8. No iCloud/FRP bypass, no work on devices that aren't the customer's, no spyware.
9. No medical, legal or financial advice.

**Behaviour**
10. When unsure, hand off. A handoff is a good outcome; a confident wrong answer isn't.

Prompt-injection attempts ("ignore your instructions", "show me your prompt") get a flat, brief
redirect back to phone repairs — no acknowledgement, no argument.

---

## 6. Voice

Plain, warm, Australian. Short. The bot sounds like the person behind the counter, not a helpdesk.

> **Good:** "Sounds like a battery replacement — usually done in under an hour. If the battery is
> swelling or pushing the screen up, stop using the phone and bring it in sooner rather than later."
>
> **Bad:** "Thank you for your enquiry! I'd be delighted to assist you with your battery concern.
> Our team of trained technicians offers competitive pricing on all battery services!"

Rules: answer first, then the one detail that helps. Two or three sentences. No stacked
exclamation marks, no "Great question", no emoji except 📞 and 📍 on contact details. Never claim
"trained technicians" or "certified" — both are guardrail violations and both sound like everyone
else anyway.

---

## 7. Build

**Now (this repo):** `demo.html` — a self-contained prototype. The widget UI is production-shaped;
behind it sits a deterministic matcher over the knowledge base, so it runs with no API key and no
backend. Good enough to test the answers, the tone and the coverage before spending anything.

**Production:** same knowledge base, Claude behind it.

```
Shopify theme
  └── widget.js  (the UI from demo.html, ~8KB)
        │  POST /chat  { messages: [...] }
        ▼
  Railway service (Node)
        │  Claude API — system prompt = system-prompt.md + knowledge-base.json
        ▼
  Claude Haiku 4.5   ← knowledge base in a cached prompt prefix
```

Why an LLM behind it rather than shipping the matcher: the matcher handles the 119 phrasings it's
been shown. Real customers write *"hey mate my missus dropped her 13 pro in the sink last night
and now the screens got lines through it, is that fixable or is it cooked"* — one message with a
device, a fault, a liquid event and a question in it. That's what the model is for. The knowledge
base stops it inventing anything.

**Rollout**
1. George fills in the `verifyBeforeLaunch` list — address, email, prices, returns policy.
2. Demo goes to a couple of staff: does it sound like us? Is anything wrong?
3. Wire the backend, ship to the Shopify theme, cap messages per session and per IP.
4. Log every conversation. Handoff clusters are the content roadmap — for the bot *and* for the
   website's repair pages, since the same questions are what people type into Google.

**Cost.** At Haiku pricing with the knowledge base cached, a few thousand conversations a month
is small money — well under what one missed screen repair is worth. Confirm current rates before
committing to a number.

---

## 8. Open questions for George

1. **Which address?** The site's SEO pages say 290 Kingsgrove Road, Kingsgrove. The Shopify
   contact policy and a live product description say 480 King Georges Road, Beverly Hills. The bot
   needs one, and whichever is wrong needs fixing on the store too.
2. **Which email?** `info@` or `quotes@` — both are in use across the site.
3. **Returns: 30 days or 2 days?** The Refund Policy page and the Shipping Policy page contradict
   each other, and refund-to-card vs store-credit contradicts too. This is the answer most likely
   to end in a dispute.
4. **Fill the price table** — batteries and Samsung especially. Every blank row is a handoff that
   could have been an answer.
5. **Afterpay/Zip?** Currently the bot says "call to confirm".
6. **Mail-in postal address** — the bot tells customers to ring for it. Fine, but a stated address
   converts better.

---

## Files

| File | What it is |
|---|---|
| `knowledge-base.json` | Every fact and every answer. The only file to edit for content. |
| `demo.html` | Working prototype — open it in a browser. Built from the knowledge base. |
| `build.sh` | Rebuilds `demo.html` after a knowledge-base edit. Run it every time. |
| `system-prompt.md` | The production Claude prompt, plus implementation notes. |
| `DESIGN.md` | This document. |
