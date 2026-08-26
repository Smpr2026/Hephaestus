#!/usr/bin/env node
/*
 * Rebuild the floating-widget payload chunks after a knowledge-base, brain
 * or widget-shell change:  node build-widget.js
 * Same transport as the test page: gzip -> base64 -> <=20k chunks, joined
 * and gunzipped in the browser by smpr-widget-loader.js.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const dir = __dirname;
const full = JSON.parse(fs.readFileSync(path.join(dir, '../knowledge-base.json'), 'utf8'));
const brain = fs.readFileSync(path.join(dir, '../app/src/brain.js'), 'utf8');
const shell = fs.readFileSync(path.join(dir, 'widget-shell.js'), 'utf8');

const slim = {};
for (const k of Object.keys(full)) if (k !== 'meta') slim[k] = full[k];
slim.pricing = { ...full.pricing, repairs: full.pricing.repairs.map(r => {
  const { evidence, ...rest } = r; return rest;
}) };
slim.intents = full.intents.map(i => { const { _pats, _tokens, ...rest } = i; return rest; });
slim.catalogue = { ...full.catalogue, items: [] };
delete slim.testBank; // the widget never shows the question bank

const out = 'window.SMPR_KB=' + JSON.stringify(slim) + ';\n' + brain + '\n' + shell;
fs.writeFileSync(path.join(dir, 'smpr-widget-payload.js'), out);
new Function('window', 'document', out); // syntax check

const b64 = zlib.gzipSync(Buffer.from(out), { level: 9 }).toString('base64');
const n = Math.ceil(b64.length / 20000);
for (let i = 0; i < n; i++)
  fs.writeFileSync(path.join(dir, 'wpart0' + (i + 1) + '.txt'), b64.slice(i * 20000, (i + 1) * 20000));
const joined = Array.from({ length: n }, (_, i) =>
  fs.readFileSync(path.join(dir, 'wpart0' + (i + 1) + '.txt'), 'utf8')).join('');
if (zlib.gunzipSync(Buffer.from(joined, 'base64')).toString() !== out) throw new Error('round-trip mismatch');
console.log('widget payload:', out.length, 'bytes | gzip b64:', b64.length, 'chars | parts:', n);
