const fs = require('fs');
const path = require('path');

const KB_PATH = path.join(__dirname, '..', '..', 'knowledge-base.json');

function load() {
  return JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
}

// Written back with the same formatting build.sh expects, so the demo and the
// server never drift apart.
function save(kb) {
  if (!kb || !Array.isArray(kb.intents) || !kb.pricing) {
    throw new Error('Refusing to save: that does not look like a knowledge base.');
  }
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2) + '\n');
}

module.exports = { load, save, KB_PATH };
