/*
 * Local test server for the SMPR chatbot.
 *
 *   npm start           → http://localhost:3000
 *
 * Runs with no credentials at all: without ANTHROPIC_API_KEY it answers from
 * the local matcher, so you can click through the whole thing before spending
 * a cent. With the key set, the local engine still answers first - Claude is
 * only asked about genuine gaps, and everything it works out is written to
 * persistent memory so the same question is answered locally (free) forever
 * after.
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
const { createMemory } = require('./src/memory.js');
const quotes = require('./src/quotes.js');
const tickets = require('./src/tickets.js');
const catalogue = require('./src/catalogue.js');

const PORT = process.env.PORT || 3000;
// On Railway, DATA_DIR points at the mounted volume so gaps and learning
// survive restarts and redeploys. Locally it's just ./data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GAPS_FILE = path.join(DATA_DIR, 'gaps.jsonl');
const LEARNED_FILE = path.join(DATA_DIR, 'learned.json');
const ANSWERS_FILE = path.join(DATA_DIR, 'answers.json');
const PUBLIC = path.join(__dirname, 'public');

// answers Claude has already worked out for questions the local engine
// missed - checked before any API call, so each gap costs at most once
const memory = createMemory(ANSWERS_FILE);

let KB = kbStore.load();
let brain = createBrain(KB);

/* ---- one brain per customer, learning shared between all of them ----
 * The brain keeps conversation state (their device, their quote) in a
 * closure, so two customers must never share one. Each chat session gets
 * its own brain, found by the sid the widget sends; idle sessions are
 * swept after 30 minutes. What any customer TEACHES the bot (a missed
 * phrasing they then clarified) is merged into one shared map, saved to
 * disk, and seeded into every new session - one customer's lesson becomes
 * everyone's. */
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_CAP = 500;
const sessions = new Map(); // sid -> { brain, at }

let sharedLearned = {};
try { sharedLearned = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8')); } catch (e) { /* first boot */ }

let learnedDirty = false;
function saveLearnedSoon() {
  if (learnedDirty) return;
  learnedDirty = true;
  setTimeout(() => {
    learnedDirty = false;
    fs.mkdir(DATA_DIR, { recursive: true }, err => {
      if (err) return;
      fs.writeFile(LEARNED_FILE, JSON.stringify(sharedLearned), () => {});
    });
  }, 2000);
}

function brainFor(sid) {
  const now = Date.now();
  let s = sessions.get(sid);
  if (!s) {
    if (sessions.size >= SESSION_CAP) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) sessions.delete(oldest[0]);
    }
    s = { brain: createBrain(KB), at: now };
    sessions.set(sid, s);
  }
  s.at = now;
  // top up every visit, not just creation - a lesson learned five minutes
  // ago from another customer should work in this session right now
  if (s.brain.importLearned) s.brain.importLearned(sharedLearned);
  return s.brain;
}

function absorbLearning(b) {
  if (!b.exportLearned) return;
  const mine = b.exportLearned();
  let grew = false;
  for (const k in mine) {
    if (!(k in sharedLearned)) { sharedLearned[k] = mine[k]; grew = true; }
  }
  if (grew) saveLearnedSoon();
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, s] of sessions) if (s.at < cutoff) sessions.delete(sid);
}, 5 * 60 * 1000).unref();

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

  const sid = String(body.sid || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) ||
    'ip:' + (req.socket.remoteAddress || 'unknown');
  const b = brainFor(sid);

  // a status ask with a ticket number gets the real job status when the
  // FixDesk connection is configured; otherwise the brain's honest
  // collect-and-hand-off flow answers
  const ticket = await tickets.ticketStatus(KB, message);
  if (ticket) return send(res, 200, { ...ticket, engine: 'fixdesk-tickets' });

  const live = await livePrice(message);
  if (live) return send(res, 200, { ...live, engine: 'fixdesk' });

  const shop = await liveProducts(message);
  if (shop) return send(res, 200, { ...shop, engine: 'shopify' });

  /* Layer 1: the local engine answers first - knowledge base, price book,
   * symptom handlers, policies. Instant, free, and it covers nearly
   * everything, so this is the answer for all but genuine misses. */
  const answer = b.respond(message);
  absorbLearning(b);

  const missed = /^fallback/.test(String(answer.intent));
  if (missed) {
    /* Layer 3 first on a miss: has Claude already worked this one out for
     * an earlier customer? Then it's a local answer now - no API call. */
    const remembered = memory.match(message);
    if (remembered) {
      return send(res, 200, {
        text: remembered, card: null, contact: false, chips: [],
        intent: 'learned-answer', engine: 'memory'
      });
    }

    /* Layer 2: a genuinely new gap goes to Claude, in character, with the
     * knowledge base as its only source of truth. Whatever it works out is
     * written back to memory so this question never costs again. Any
     * failure falls straight through to the local clarifier - a customer
     * is never left hanging on an API error. */
    if (claude.available()) {
      try {
        const smart = await claude.ask(KB, history, message);
        memory.learn(message, smart.text);
        logGap(message, answer); // still a KB gap worth reviewing in admin
        return send(res, 200, { ...smart, engine: 'claude-fallback' });
      } catch (err) {
        console.error('[claude] gap fallback failed, using local answer:', err.message);
      }
    }
  }

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
        engine: claude.available() ? 'local + claude gap fallback' : 'local',
        learnedAnswers: memory.size(),
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
  console.log('  Engine       local matcher first' + (claude.available()
    ? ', Claude (' + claude.MODEL + ') on gaps, answers remembered'
    : ' — set ANTHROPIC_API_KEY to add the Claude gap fallback'));
  console.log('');
});
