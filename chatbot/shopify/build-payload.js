#!/usr/bin/env node
/*
 * Rebuild smpr-bot-payload.js and the part0N.txt upload chunks after a
 * knowledge-base or brain change.
 *
 *   node build-payload.js
 *
 * The payload is three blocks: a slim knowledge base (no meta, no per-row
 * evidence, no local catalogue - the page searches the live store instead),
 * the shared brain, and the page's UI shell. The shell is kept from the
 * existing payload, so hand edits to it survive a rebuild.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const dir = __dirname;
const full = JSON.parse(fs.readFileSync(path.join(dir, '../knowledge-base.json'), 'utf8'));
const brain = fs.readFileSync(path.join(dir, '../app/src/brain.js'), 'utf8');
const old = fs.readFileSync(path.join(dir, 'smpr-bot-payload.js'), 'utf8');

// slim the KB the same way the original build did
const slim = {};
for (const k of Object.keys(full)) if (k !== 'meta') slim[k] = full[k];
slim.pricing = { ...full.pricing, repairs: full.pricing.repairs.map(r => {
  const { evidence, ...rest } = r; return rest;
}) };
slim.intents = full.intents.map(i => { const { _pats, _tokens, ...rest } = i; return rest; });
slim.catalogue = { ...full.catalogue, items: [] };

// shell = whatever follows the brain block in the current payload
const brainStart = old.indexOf('\n') + 1;
const marker = '\n(function(){\n  "use strict";\n  var KB = window.SMPR_KB || null;';
const shellAt = old.indexOf(marker);
if (shellAt === -1) throw new Error('shell marker not found - payload layout changed');
const shell = old.slice(shellAt);

const out = 'window.SMPR_KB=' + JSON.stringify(slim) + ';\n' + brain + shell;
fs.writeFileSync(path.join(dir, 'smpr-bot-payload.js'), out);

// syntax check
new Function('window', 'document', out.replace(/^window\.SMPR_KB=/, 'window.SMPR_KB='));

// gzip + base64 + chunk
const b64 = zlib.gzipSync(Buffer.from(out), { level: 9 }).toString('base64');
const n = Math.ceil(b64.length / 20000);
for (let i = 0; i < n; i++)
  fs.writeFileSync(path.join(dir, 'part0' + (i + 1) + '.txt'), b64.slice(i * 20000, (i + 1) * 20000));
// round-trip proof
const joined = Array.from({ length: n }, (_, i) =>
  fs.readFileSync(path.join(dir, 'part0' + (i + 1) + '.txt'), 'utf8')).join('');
const back = zlib.gunzipSync(Buffer.from(joined, 'base64')).toString();
if (back !== out) throw new Error('round-trip mismatch');
console.log('payload:', out.length, 'bytes | gzip b64:', b64.length, 'chars | parts:', n);
