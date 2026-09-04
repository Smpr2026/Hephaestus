/*
 * Local test server for the SMPR chatbot.
 *
 *   npm start           → http://localhost:3000
 *
 * Runs with no credentials at all: without ANTHROPIC_API_KEY it answers from
 * the local matcher, so you can click through the whole thing before spending
 * a cent. Set the key and the same endpoints start using Claude instead.
 *
 * Deliberately zero-dependency apart from the Anthropic SDK — this is the
 * shape that later becomes the Shopify app's backend.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const kbStore = require('./src/kb.js');
const { createBrain } = require('./src/brain.js');
const claude = require('./src/claude.js');
const quotes = require('./src/quotes.js');
const tickets = require('./src/tickets.js');
const catalogue = require('./src/catalogue.js');

const PORT = process.env.PORT || 3000;
const GAPS_FILE = path.join(__dirname, 'data', 'gaps.jsonl');
const PUBLIC = path.join(__dirname, 'public');

let KB = kbStore.load();
let brain = createBrain(KB);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
  });
}

// A price question goes to FixDesk first, so the techs' numbers are the ones
// customers hear. Anything short of a real answer falls through to the
// knowledge base - the bot still never invents a price.
async function livePrice(message) {
  if (!quotes.configured()) return null;
  const q = brain.parsePriceQuery(message);
  if (!q) return null;
  const prices = await quotes.lookup(q.model, q.repair);
  if (!prices) return null;
  // priceCard returns null when FixDesk gave nothing worth quoting (no price,
  // or too few tickets to mean anything) - fall through to the knowledge base.
  return brain.priceCard(q.model, q.repair, prices);
}

// Shopping questions search the real store when it's configured, so the bot
// can see all ~900 products rather than the sample in the knowledge base.
async function liveProducts(message) {
  if (!catalogue.configured()) return null;
  const q = brain.parseProductQuery(message);
  if (!q) return null;
  const items = await catalogue.search(q.terms);
  if (!items || !items.length) return null;
  return brain.productAnswer(q, brain.searchCatalogue(q.terms, items, { brand: q.brand, kind: q.kind }));
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const message = String(body.message || '').slice(0, 2000).trim();
  if (!message) return send(res, 400, { error: 'No message' });

  const history = Array.isArray(body.history)
    ? body.history.slice(-10).filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    : [];

  // a status ask with a ticket number gets the real job status when the
  // FixDesk connection is configured; otherwise the brain's honest
  // collect-and-hand-off flow answers
  const ticket = await tickets.ticketStatus(KB, message);
  if (ticket) return send(res, 200, { ...ticket, engine: 'fixdesk-tickets' });

  const live = await livePrice(message);
  if (live) return send(res, 200, { ...live, engine: 'fixdesk' });

  const shop = await liveProducts(message);
  if (shop) return send(res, 200, { ...shop, engine: 'shopify' });

  if (claude.available()) {
    try {
      const answer = await claude.ask(KB, history, message);
      return send(res, 200, { ...answer, engine: 'claude' });
    } catch (err) {
      // never leave a customer with nothing because an API call failed
      console.error('[claude] falling back to local matcher:', err.message);
      const answer = brain.respond(message);
      return send(res, 200, { ...answer, engine: 'local (claude failed)' });
    }
  }

  const answer = brain.respond(message);
  logGap(message, answer);
  notifyEscalation(message, answer);
  send(res, 200, { ...answer, engine: 'local' });
}

// A stuck conversation (the brain sets `escalate`) pings George instantly
// when ESCALATION_WEBHOOK_URL is configured. The URL can be anything that
// accepts a JSON POST - a Twilio Studio flow or WhatsApp Business API
// endpoint that forwards to his WhatsApp, a Slack webhook, a Zap. Without
// the env var this is a silent no-op; the customer still gets the phone
// number and WhatsApp link in the chat itself.
function notifyEscalation(message, answer) {
  const url = process.env.ESCALATION_WEBHOOK_URL;
  if (!url || !answer || !answer.escalate) return;
  const body = JSON.stringify({
    source: 'smpr-chatbot',
    at: new Date().toISOString(),
    model: answer.escalate.model || null,
    question: answer.escalate.question || message,
  });
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    .catch(err => console.error('[escalation] webhook failed:', err.message));
}

// Every question the bot punts on is a gap in the knowledge base. Log them,
// show them in the admin - that list is how the bot gets better each week.
function logGap(message, answer) {
  const missed = answer.intent === 'fallback' || String(answer.intent).indexOf('shop:nothing-found') === 0
    || String(answer.intent).indexOf('(no listed price)') !== -1;
  if (!missed) return;
  fs.mkdir(path.dirname(GAPS_FILE), { recursive: true }, err => {
    if (err) return;
    fs.appendFile(GAPS_FILE, JSON.stringify({ t: Date.now(), q: message, intent: answer.intent }) + '\n', () => {});
  });
}

function readGaps(cb) {
  fs.readFile(GAPS_FILE, 'utf8', (err, data) => {
    if (err) return cb([]);
    const rows = data.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    // aggregate identical questions so the admin sees "asked 7 times", not 7 rows
    const agg = {};
    rows.forEach(r => {
      const k = r.q.toLowerCase().trim();
      agg[k] = agg[k] || { q: r.q, n: 0, last: 0, intent: r.intent };
      agg[k].n++; agg[k].last = Math.max(agg[k].last, r.t);
    });
    cb(Object.values(agg).sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 100));
  });
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/storefront.html' : urlPath;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    if (urlPath === '/api/chat' && req.method === 'POST') return await handleChat(req, res);

    if (urlPath === '/api/kb' && req.method === 'GET') return send(res, 200, KB);

    if (urlPath === '/api/kb' && req.method === 'PUT') {
      const body = await readBody(req);
      kbStore.save(body);
      KB = kbStore.load();
      brain = createBrain(KB);
      console.log('[kb] saved and reloaded');
      return send(res, 200, { ok: true, intents: KB.intents.length });
    }

    // small payload the widget needs to render itself (never the whole KB)
    if (urlPath === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        persona: KB.persona || null,
        business: {
          name: KB.business.name,
          phone: KB.business.phone,
          phoneDial: KB.business.phoneDial,
          addressShort: KB.business.addressShort,
          mapsUrl: KB.business.mapsUrl,
          hoursSummary: KB.business.hoursSummary,
          hours: KB.business.hours
        },
        greeting: (KB.intents.filter(i => i.id === 'greeting')[0] || {}).answer || 'Hi — how can I help?',
        greetingChips: (KB.intents.filter(i => i.id === 'greeting')[0] || {}).chips || []
      });
    }

    if (urlPath === '/api/gaps' && req.method === 'GET') {
      return readGaps(rows => send(res, 200, rows));
    }

    if (urlPath === '/api/status' && req.method === 'GET') {
      return send(res, 200, {
        engine: claude.available() ? 'claude' : 'local',
        livePricing: quotes.configured() ? process.env.FIXDESK_URL : false,
        liveCatalogue: catalogue.configured() ? process.env.SHOPIFY_STORE_DOMAIN : false,
        catalogueSample: (KB.catalogue && KB.catalogue.items || []).length,
        model: claude.available() ? claude.MODEL : null,
        intents: KB.intents.length,
        pricesFilled: KB.pricing.repairs.filter(r => r.costs && Object.keys(r.costs).length).length,
        pricesTotal: KB.pricing.repairs.length
      });
    }

    serveStatic(req, res, urlPath);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  SMPR chatbot — local test server');
  console.log('  ────────────────────────────────');
  console.log('  Storefront   http://localhost:' + PORT + '/');
  console.log('  Admin        http://localhost:' + PORT + '/admin.html');
  console.log('  Engine       ' + (claude.available() ? 'Claude (' + claude.MODEL + ')' : 'local matcher — set ANTHROPIC_API_KEY to use Claude'));
  console.log('');
});
