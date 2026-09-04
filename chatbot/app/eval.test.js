/*
 * The persona eval. Where test.js checks facts (prices, guardrails, refusals),
 * this suite checks how Hope TALKS: it simulates whole customer conversations
 * and fails if she ever sounds like a bot - a banned canned phrase, a turn-one
 * lead grab, a forgotten device, an argued warranty claim, or the same message
 * parroted twice in a row.
 *
 *   node --test chatbot/app/eval.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const KB = require('../knowledge-base.json');
const { createBrain } = require('./src/brain.js');

// phrases Hope must never say, in any answer, on any path. "let me check" is
// the stall-theatre line; the rest are the canned slip-ups and AI tells the
// owner has banned outright.
const BANNED = /i'?m your man|shop'?s shut|shop is shut|the shop is closed right now|let me check that|let me check for you|great question|as an ai|i'?m an ai|i am an ai|language model|i'?m just a bot|i am just a bot|cannot assist|unable to assist|i apologi[sz]e for any inconvenience/i;

// a reply that grabs for the customer's number or pushes them offline
const LEAD_GRAB = /\b(your (phone )?number|contact number|best number|leave (us )?your|we'?ll (call|ring|text) you)\b/i;

function converse(lines) {
  const b = createBrain(KB);
  return lines.map(q => b.respond(q));
}

function textOf(r) {
  let t = String(r.text || '');
  if (r.card && r.card.lines) t += '\n' + r.card.lines.join('\n');
  return t;
}

/* ------------------------------------------------- 1. no canned phrases */

test('banned phrases appear nowhere in the knowledge base', () => {
  const hits = [];
  const scan = (s, where) => { if (BANNED.test(s)) hits.push(`${where}: ${String(s).slice(0, 120)}`); };
  for (const i of KB.intents) scan(JSON.stringify(i.answer) + JSON.stringify(i.followup || ''), 'intent ' + i.id);
  for (const r of KB.refusals) scan(r.answer, 'refusal');
  scan(KB.escalation.line, 'escalation.line');
  scan(KB.pricing.unknownPriceLine || '', 'unknownPriceLine');
  assert.deepStrictEqual(hits, []);
});

test('banned phrases never come out of the brain, across the whole question bank', () => {
  const hits = [];
  for (const { q } of KB.testBank) {
    const t = textOf(createBrain(KB).respond(q));
    if (BANNED.test(t)) hits.push(`"${q}" -> ${t.slice(0, 120)}`);
  }
  // and the fallback ladder itself, cold and warm
  for (const seq of [['zzq unknowable one', 'blorp unknowable two'],
                     ['my iphone 12 screen is cracked', 'zzq unknowable', 'blorp unknowable']]) {
    for (const r of converse(seq)) {
      if (BANNED.test(textOf(r))) hits.push(`fallback path -> ${textOf(r).slice(0, 120)}`);
    }
  }
  assert.deepStrictEqual(hits, []);
});

/* ------------------------------------------- 2. turn one never panics */

test('vague openers get a warm counter-tech question, never a lead grab', () => {
  for (const q of ['hi', 'hello', 'i need help', 'my phone is broken', 'damaged phone',
                   'i have a damaged phone', 'can you help me', 'phone problem']) {
    const r = createBrain(KB).respond(q);
    const t = textOf(r);
    assert.ok(!LEAD_GRAB.test(t), `"${q}" grabbed for a number: ${t.slice(0, 140)}`);
    assert.ok(!r.contact, `"${q}" rendered the contact card on turn one`);
    assert.ok(!(r.links && r.links.length), `"${q}" pushed an offline handoff on turn one`);
    assert.ok(/\?/.test(t), `"${q}" should end in a question that moves the chat forward: ${t.slice(0, 140)}`);
  }
});

/* ----------------------------------- 3. memory and combo conversations */

test('Hope remembers the device across the whole conversation', () => {
  const [scr, bat, glass, combo] = converse([
    'how much for an iphone 12 screen',
    'and the battery',
    'what about the back glass as well',
    'can you do the screen and back glass together'
  ]);
  assert.ok(/iPhone 12/.test(scr.intent), `screen quote lost the model: ${scr.intent}`);
  assert.ok(/iPhone 12:battery/.test(bat.intent), `battery follow-up forgot the phone: ${bat.intent}`);
  assert.ok(/iPhone 12:back_glass/.test(glass.intent), `back glass follow-up forgot the phone: ${glass.intent}`);
  assert.ok(/^price-combo:iPhone 12/.test(combo.intent), `combo ask didn't route to combo pricing: ${combo.intent}`);
  assert.ok(/one visit|together/i.test(textOf(combo)), 'combo answer should sell the single visit');
});

test('changing topic mid-chat never reads as being stuck', () => {
  const rs = converse([
    'how much for an iphone 12 screen',
    'actually i want a handset',
    'do you sell cases'
  ]);
  for (const r of rs) {
    assert.ok(!/^fallback/.test(r.intent), `topic change fell through: ${r.intent}`);
    assert.ok(!(r.links && r.links.length), `topic change triggered a handoff: ${r.intent}`);
  }
});

/* --------------------------------------- 4. warranty disputes de-escalate */

test('a "cracked by itself" claim is validated and pivoted, never denied', () => {
  for (const q of ['my screen cracked by itself', 'it cracked in my pocket and its under warranty',
                   'the screen you fitted just cracked and i never dropped it']) {
    const t = textOf(createBrain(KB).respond(q));
    assert.ok(/macro lens|free of charge/i.test(t), `"${q}" must pivot to the free inspection: ${t.slice(0, 140)}`);
    assert.ok(/kingsgrove/i.test(t), `"${q}" should point at the shop: ${t.slice(0, 140)}`);
    assert.ok(!/void|not covered|your fault|physical damage isn'?t/i.test(t),
      `"${q}" argued or denied in chat: ${t.slice(0, 140)}`);
  }
});

/* ------------------------------------------------ 5. no robotic loops */

test('asking the same thing twice never gets the identical message back', () => {
  const b = createBrain(KB);
  const texts = ['do you fix phones', 'do you fix phones', 'do you fix phones']
    .map(q => textOf(b.respond(q)));
  assert.notStrictEqual(texts[0], texts[1], 'second ask parroted the first verbatim');
  assert.notStrictEqual(texts[1], texts[2], 'third ask parroted the second verbatim');
  assert.ok(texts[1].includes(texts[0]) || /same|stands|changed/i.test(texts[1]),
    'the repeat should acknowledge, not pretend the first answer never happened');
});

test('two misses in a cold chat stay conversational and varied', () => {
  const [m1, m2] = converse(['zzq blorp gribble', 'florp wibble zort']);
  assert.notStrictEqual(textOf(m1), textOf(m2), 'the two fallback lines must differ');
  assert.ok(!LEAD_GRAB.test(textOf(m1)) && !LEAD_GRAB.test(textOf(m2)),
    'a cold miss must never collect a number');
});

/* --------------------------------------------------- 6. identity holds */

test('asked straight out, Hope is honest but stays in character', () => {
  const t = textOf(createBrain(KB).respond('are you a real person or a bot'));
  assert.ok(/hope/i.test(t), 'the identity answer should own the name Hope');
  assert.ok(!/human being|definitely human|100% human/i.test(t), 'never claims to be human when asked straight');
  assert.ok(!BANNED.test(t));
});
