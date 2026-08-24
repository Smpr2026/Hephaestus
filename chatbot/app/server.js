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

const PORT = process.env.PORT || 3000;
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
  return brain.priceCard(q.model, q.repair, prices);
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const message = String(body.message || '').slice(0, 2000).trim();
  if (!message) return send(res, 400, { error: 'No message' });

  const history = Array.isArray(body.history)
    ? body.history.slice(-10).filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    : [];

  const live = await livePrice(message);
  if (live) return send(res, 200, { ...live, engine: 'fixdesk' });

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

  send(res, 200, { ...brain.respond(message), engine: 'local' });
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

    if (urlPath === '/api/status' && req.method === 'GET') {
      return send(res, 200, {
        engine: claude.available() ? 'claude' : 'local',
        livePricing: quotes.configured() ? process.env.FIXDESK_URL : false,
        model: claude.available() ? claude.MODEL : null,
        intents: KB.intents.length,
        pricesFilled: KB.pricing.repairs.filter(r => r.aftermarket != null || r.genuine != null).length,
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
