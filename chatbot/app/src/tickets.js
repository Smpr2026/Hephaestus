/*
 * Live repair-ticket status from FixDesk / RepairDesk.
 *
 * Same contract style as quotes.js: unset FIXDESK_URL and everything here is
 * skipped — the local brain keeps its honest "the chat can't see the queue"
 * two-step (collect the ticket details, hand them to WhatsApp and the phone).
 * With this configured and the server hosted, the same question gets a real
 * status straight from the job system instead.
 *
 * Configure:
 *   FIXDESK_URL=https://fixdesk.pro
 *   FIXDESK_TOKEN=...                    (sent as Authorization: Bearer)
 *   FIXDESK_TICKET_PATH=/api/tickets     (override if the route differs)
 *
 * ── The contract this expects ────────────────────────────────────────────
 * GET {FIXDESK_URL}{FIXDESK_TICKET_PATH}?search=<ticket number>
 *   200 → { "ticket": "14213", "status": "waiting_parts" | "in_progress" |
 *           "ready" | "collected" | <anything else>, "eta": "Friday"? }
 *   404 → no ticket found
 *
 * If FixDesk's real route or field names differ, change mapStatus() below —
 * that is the only place the shape is assumed.
 */
const TIMEOUT_MS = Number(process.env.FIXDESK_TIMEOUT_MS || 2500);

function configured() {
  return Boolean(process.env.FIXDESK_URL);
}

// a status ask carrying a plausible ticket number - anything vaguer stays
// with the brain's collect-and-hand-off flow
const STATUS_ASK = /\b(ready|status|update|pick ?up|arrived|repair|ticket)\b/i;
const TICKET_NO = /\b(\d{4,8})\b/;

function statusLine(kb, data) {
  const b = kb.business;
  const eta = data.eta ? ` — they're expecting it ${data.eta}` : '';
  switch (String(data.status || '').toLowerCase()) {
    case 'waiting_parts':
      return `Ticket ${data.ticket}: the part's on its way to us${eta}. ` +
        `The moment it lands it goes straight on the bench. If you need it sooner, ring ${b.phone} and the team will see what they can do.`;
    case 'in_progress':
      return `Ticket ${data.ticket}: it's on the workbench now. ` +
        `You'll get a call the moment it's tested and ready to collect from ${b.addressShort}.`;
    case 'ready':
      return `Good news — ticket ${data.ticket} is tested and ready for pickup at ${b.addressShort}. ${b.hoursSummary} Covered by our ${b.warranty}.`;
    case 'collected':
      return `Ticket ${data.ticket} shows as collected. If that doesn't sound right, ring ${b.phone} and the team will sort it out.`;
    default:
      return `Ticket ${data.ticket}: the team's got it — ring ${b.phone} and they'll give you the full rundown while you're on the line.`;
  }
}

async function ticketStatus(kb, message) {
  if (!configured() || !STATUS_ASK.test(message)) return null;
  const m = TICKET_NO.exec(message);
  if (!m) return null;

  const base = process.env.FIXDESK_URL.replace(/\/+$/, '');
  const path = process.env.FIXDESK_TICKET_PATH || '/api/tickets';
  const url = `${base}${path}?search=${encodeURIComponent(m[1])}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: process.env.FIXDESK_TOKEN
        ? { Authorization: `Bearer ${process.env.FIXDESK_TOKEN}` } : {},
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.status) return null;
    data.ticket = data.ticket || m[1];
    return {
      text: statusLine(kb, data),
      card: null, contact: true, chips: [],
      intent: 'fixdesk:ticket:' + data.status,
    };
  } catch (e) {
    return null; // any failure: the local brain's honest flow takes over
  }
}

module.exports = { ticketStatus, configured };
