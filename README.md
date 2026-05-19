# Hephaestus — Demolition Crew App (Client Preview)

A clickable demo of **Hephaestus** — named for the Greek god of fire, the forge, and the breaking of stone. Patron of every craftsman who works with hammer, anvil, and flame.

This is a single-file HTML prototype showing roughly 20% of the planned app: the worker-facing flows for clocking in, taking GPS-tagged site photos, logging tip runs, recording measurements, flagging hazards, viewing the job map, and tracking hours. All buttons are wired up and behave realistically with demo data — nothing is a dead end.

> **This is a preview build for client testing.** Real data, accounts, and integrations are not yet wired in.

---

## How to view the demo

### Option A — Just open the file
Double-click `index.html`. It runs in any modern browser (Chrome, Safari, Edge, Firefox). On a phone: AirDrop / email / message the file to yourself, then open it.

### Option B — Share via GitHub Pages (recommended for client)
This gets you a public URL the client can open on their phone in one tap.

1. **Create a GitHub repo** — e.g. `Smpr2026/Hephaestus`
2. **Upload all files** in this folder (drag-drop in GitHub's web UI works fine):
   - `index.html`
   - `README.md`
   - `manifest.webmanifest`
   - `logo.svg`
   - `logo-mark.svg`
   - `logo-horizontal.svg`
3. **Enable GitHub Pages:**
   - Repo *Settings* → *Pages*
   - Under *Source*, choose `main` branch / root folder
   - Save
4. **Wait ~60 seconds.** GitHub gives you a URL like `https://smpr2026.github.io/Hephaestus/`
5. **Send the URL to the client.** They open it on their phone, optionally tap *Share → Add to Home Screen* and it behaves like a real app — Hephaestus icon and all.

### Option C — Railway / Vercel
If you'd rather keep this on the same hosting as FixDesk, Railway will serve a static `index.html` from a repo with zero config. Vercel does the same — push the repo, connect, deploy, done.

---

## What's working in the demo

- **Login screen** with the Hephaestus mark and Greek inscription (Ἥφαιστος), demo bypass
- **Today / current job** view with live clock-in status (GPS verified pill)
- **Pre-work photo grid** — tap any empty slot to "capture" a new photo; taken photos open a detail view with GPS metadata
- **Quick actions** — Measure, Log tip run, Directions, Flag hazard (all open working modals)
- **Job detail** with four tabs: Photos, Specs, Tip runs, Costs
- **Map view** with 4 demo jobs (live, scheduled, complete, quoted) on a stylized map
- **Timesheet** showing the week's hours by day and by job
- **Profile / account** screen with menu items
- **Bottom navigation** persists between screens
- **Toast notifications** confirm every action

## What's not in this demo

- Real authentication / multi-user accounts
- Live database — everything is in-memory, refreshing the page resets state
- Real camera capture (uses placeholder images)
- Real maps (Google Maps integration is the production plan)
- Admin / owner dashboard (web-only, not part of this mobile preview)
- eBay AU / Xero / accounting integrations
- Worker payroll calculations
- Client portal

---

## Brand assets included

- `logo.svg` — primary lockup (mark + wordmark + Greek inscription + tagline), for hero, splash, signage
- `logo-mark.svg` — circular mark only, for app icon, favicon, social avatar
- `logo-horizontal.svg` — wide lockup for header bars, business cards, email signatures, truck signage

The mark depicts the forge: three flames over a hammer over an anvil. Amber-on-charcoal for power. Greek inscription ἭΦΑΙΣΤΟΣ for heritage.

## Stack (planned for production)

- **Frontend:** Next.js (React, web-first) — same codebase serves mobile-responsive workers and the desktop admin
- **Backend:** Node.js / Express on Railway
- **Database:** Postgres on Railway
- **Maps:** Google Maps Platform (Geocoding + Distance Matrix)
- **Photo storage:** Cloudflare R2 or S3
- **Auth:** to be decided (Auth.js / Supabase Auth / Clerk)

Same stack as FixDesk Pro — same hosting, same patterns, single sign-on possible later.

---

## Feedback

When testing, every screen has a **"Send feedback"** path via *Me → Send feedback*. For now, screenshots and notes by email work fine. As the build matures, this will fire to a Slack channel automatically.

---

**Hephaestus · ἭΦΑΙΣΤΟΣ · god of fire and the forge.**
*Forged in fire. Built for breaking stone.*
