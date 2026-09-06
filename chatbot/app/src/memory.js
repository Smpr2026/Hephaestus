/*
 * Layer 3 of the dual-layer engine: answers Claude has already worked out.
 *
 * When the local matcher misses and Claude resolves the question, the Q&A
 * pair lands here. Next time anyone asks the same thing - same words or a
 * close paraphrase - the stored answer comes back instantly, free. The file
 * lives under DATA_DIR so it survives restarts and redeploys, alongside
 * learned.json (phrasing lessons) and gaps.jsonl.
 */
const fs = require('fs');
const path = require('path');

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'can', 'could', 'would',
  'with', 'have', 'has', 'had', 'was', 'are', 'this', 'that', 'what', 'whats',
  'how', 'much', 'does', 'about', 'please', 'hey', 'yeah', 'mate', 'just']);

const CAP = 500;

// no customer detail ever lands on disk: long digit runs (phone numbers,
// IMEIs, ticket numbers) and emails are dropped before the question is stored
function scrub(s) {
  return String(s)
    .replace(/[0-9][0-9 \-()]{5,}[0-9]/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(s) {
  return scrub(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// crude stem so "affected"/"affect" and "flickers"/"flicker" agree - applied
// identically on both sides, so it only has to be consistent, not correct
function stem(w) {
  return w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w;
}

// the set of stemmed words that carry meaning, so "screen flickers on my
// iphone" and "my iphone screen flickers" look the same
function toks(s) {
  return new Set(norm(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w)).map(stem));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// a "couldn't tell you" from Claude is honest but not worth replaying forever -
// the local matcher already has its own handoff answers for that
function worthKeeping(answer) {
  const a = String(answer || '').trim();
  if (a.length < 10 || a.length > 900) return false;
  return !/have to check (that|this) (one|with)|not something i can|i don'?t know that one/i.test(a);
}

const SIMILAR = 0.75;

function createMemory(file) {
  let entries = {};
  try { entries = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first boot */ }
  const tokCache = new Map(); // key -> Set, rebuilt lazily
  function toksFor(k) {
    let t = tokCache.get(k);
    if (!t) { t = toks(k); tokCache.set(k, t); }
    return t;
  }

  let dirty = false;
  function saveSoon() {
    if (dirty) return;
    dirty = true;
    setTimeout(() => {
      dirty = false;
      fs.mkdir(path.dirname(file), { recursive: true }, err => {
        if (err) return;
        fs.writeFile(file, JSON.stringify(entries), () => {});
      });
    }, 2000);
  }

  function match(question) {
    const k = norm(question);
    if (!k) return null;
    let hit = entries[k];
    if (!hit) {
      // no exact hit: take the closest stored question, if it's close enough
      const q = toks(question);
      if (q.size < 2) return null;
      let best = null, bestSim = 0;
      for (const key in entries) {
        const sim = jaccard(q, toksFor(key));
        if (sim > bestSim) { bestSim = sim; best = key; }
      }
      if (bestSim >= SIMILAR) hit = entries[best];
    }
    if (!hit) return null;
    hit.n = (hit.n || 0) + 1;
    hit.at = Date.now();
    saveSoon();
    return hit.a;
  }

  function learn(question, answer) {
    if (!worthKeeping(answer)) return false;
    const k = norm(question);
    if (!k || k.length < 6) return false;
    if (Object.keys(entries).length >= CAP && !entries[k]) {
      // full: drop the entry that's helped the least, longest ago
      const worst = Object.keys(entries)
        .sort((a, b) => (entries[a].n || 0) - (entries[b].n || 0) || (entries[a].at || 0) - (entries[b].at || 0))[0];
      if (worst) { delete entries[worst]; tokCache.delete(worst); }
    }
    entries[k] = { a: scrub(answer), n: 0, at: Date.now() };
    tokCache.set(k, toks(k));
    saveSoon();
    return true;
  }

  function size() { return Object.keys(entries).length; }

  return { match, learn, size };
}

module.exports = { createMemory, norm, toks, scrub, worthKeeping };
