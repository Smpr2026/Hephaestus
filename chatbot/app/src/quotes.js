/*
 * Live prices from the FixDesk quoting module.
 *
 * The shop's techs already maintain prices in FixDesk. Keeping a second copy in
 * knowledge-base.json means two lists and one of them going stale, so when
 * FixDesk is reachable the bot asks it and the knowledge base becomes the
 * fallback rather than the source.
 *
 * Configure:
 *   FIXDESK_URL=https://fixdesk.pro
 *   FIXDESK_TOKEN=...                 (sent as Authorization: Bearer)
 *   FIXDESK_QUOTE_PATH=/api/quotes    (override if the route differs)
 *
 * Unset FIXDESK_URL and everything below is skipped — the bot uses the
 * knowledge base table exactly as it does today.
 *
 * ── The contract this expects ────────────────────────────────────────────
 * GET {FIXDESK_URL}{FIXDESK_QUOTE_PATH}?model=iPhone%2013&repair=screen
 *   200 → { "aftermarket": 160, "genuine": 260 }     (either may be null)
 *   404 → no price on file for that combination
 *
 * If FixDesk's real route or field names differ, change mapResponse() below —
 * that is the only place the shape is assumed. Nothing else needs touching.
 */
const TIMEOUT_MS = Number(process.env.FIXDESK_TIMEOUT_MS || 2500);
const CACHE_MS = Number(process.env.FIXDESK_CACHE_MS || 60_000);

const cache = new Map();

function configured() {
  return Boolean(process.env.FIXDESK_URL);
}

// The one place FixDesk's response shape is assumed.
function mapResponse(json) {
  if (!json || typeof json !== 'object') return null;
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const aftermarket = num(json.aftermarket ?? json.aftermarketPrice ?? json.copy);
  const genuine = num(json.genuine ?? json.genuinePrice ?? json.oem);
  if (aftermarket == null && genuine == null) return null;
  if (Number.isNaN(aftermarket) || Number.isNaN(genuine)) return null;
  return { aftermarket, genuine, source: 'fixdesk' };
}

/**
 * Look up one repair price. Resolves to {aftermarket, genuine, source} or null.
 * Never throws and never hangs the conversation: any failure resolves null and
 * the caller falls back to the knowledge base.
 */
async function lookup(model, repair) {
  if (!configured()) return null;

  const key = model + '|' + repair;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const base = process.env.FIXDESK_URL.replace(/\/+$/, '');
  const path = process.env.FIXDESK_QUOTE_PATH || '/api/quotes';
  const url = `${base}${path}?model=${encodeURIComponent(model)}&repair=${encodeURIComponent(repair)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers = { Accept: 'application/json' };
    if (process.env.FIXDESK_TOKEN) headers.Authorization = `Bearer ${process.env.FIXDESK_TOKEN}`;

    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 404) {
      cache.set(key, { at: Date.now(), value: null });
      return null;
    }
    if (!res.ok) throw new Error('FixDesk returned ' + res.status);

    const value = mapResponse(await res.json());
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    // A quoting-module outage must never break the chat. Say nothing to the
    // customer, log it for us, let the knowledge base answer.
    console.error('[fixdesk] quote lookup failed (%s %s): %s', model, repair, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { lookup, configured, mapResponse };
