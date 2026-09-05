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
const BANNED = /i'?m your man|shop'?s shut|shop is shut|the shop is closed right now|let me check that|let me check for you|great question|as an ai|i'?m an ai|i am an ai|language model|i'?m just a bot|i am just a bot|cannot assist|unable to assist|i apologi[sz]e for any inconvenience|i want to make sure i get you the right answer/i;

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
  // "as well" right after the battery quote stacks the two into one visit -
  // the phone is still remembered, and the customer sees the combined total
  assert.ok(/iPhone 12/.test(glass.intent) && /back_glass/.test(glass.intent),
    `back glass follow-up forgot the phone: ${glass.intent}`);
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

/* --------------------------------------- 7. slang, small talk, learning */

test('small-talk openers get small talk back, not a template', () => {
  for (const q of ['whats going on', "what's going on", 'hows it going', 'how are you']) {
    const r = createBrain(KB).respond(q);
    assert.ok(r.intent.startsWith('casual_greeting'), `"${q}" matched ${r.intent}`);
    assert.ok(!BANNED.test(textOf(r)));
  }
  // the same words inside a real repair sentence still route to the repair
  const real = createBrain(KB).respond('whats going on with my iphone battery, it dies by lunch');
  assert.ok(!real.intent.startsWith('casual_greeting'), `repair sentence became small talk: ${real.intent}`);
});

test('a fault report mentioning "need" and "phone" is never a sales pitch', () => {
  // live transcript: "i need help with my phone it keeps rebootng" got
  // phones-for-sale cards - the want/need+phone shopping rule fired over a
  // fault report. Symptom or help words must veto it, in the widget's
  // product parse AND the brain.
  const b = createBrain(KB);
  assert.strictEqual(b.parseProductQuery('i need help with my phone it keeps rebootng'), null,
    'the widget product parse must not claim a fault report');
  const r = createBrain(KB).respond('i need help with my phone it keeps rebootng');
  assert.ok(/fault_dead|^triage$/.test(r.intent), `matched ${r.intent}`);
  // genuine shopping keeps working
  for (const q of ['i want a handset', 'i need a new phone']) {
    const p = createBrain(KB).parseProductQuery(q);
    assert.ok(p && p.shopping, `"${q}" must stay shopping`);
  }
});

test('Aussie slang lands like plain English', () => {
  const blower = createBrain(KB).respond('me blower carked it');
  assert.ok(/fault_dead|^triage$/.test(blower.intent),
    `"me blower carked it" is a dead phone - expected the dead-phone answer or triage, got ${blower.intent}`);
  assert.ok(!/fault_screen/.test(blower.intent), '"carked" must never be misread as "cracked"');
  const cactus = createBrain(KB).respond('my phone is cactus');
  assert.strictEqual(cactus.intent, 'triage', `"my phone is cactus" matched ${cactus.intent}`);
  const cooked = createBrain(KB).respond('screen is cooked');
  assert.ok(/fault_screen/.test(cooked.intent), `"screen is cooked" matched ${cooked.intent}`);
});

test('a missed phrasing is learned from the customer\'s own clarification', () => {
  const b = createBrain(KB);
  const miss = b.respond('the doovalacky is torched mate');
  assert.ok(/^fallback/.test(miss.intent), `expected a miss first, got ${miss.intent}`);
  const clar = b.respond('sorry - my phone screen is smashed');
  assert.ok(/fault_screen/.test(clar.intent), `clarification matched ${clar.intent}`);
  const again = b.respond('told ya, doovalacky is torched');
  assert.ok(/fault_screen/.test(again.intent) && /\[learned\]/.test(again.intent),
    `the repeated slang should hit the learned answer, got ${again.intent}`);
  // and the learned map round-trips for persistence in the widget
  const b2 = createBrain(KB);
  b2.importLearned(b.exportLearned());
  assert.ok(/\[learned\]/.test(b2.respond('doovalacky is torched again').intent),
    'a fresh brain fed the exported map should answer the slang directly');
});

test('consoles are their own answer, never the phone spiel', () => {
  for (const q of ['do you fix consoles', 'ps5 hdmi port repair', 'xbox repair',
                   'nintendo switch not charging', 'playstation wont turn on']) {
    const r = createBrain(KB).respond(q);
    assert.ok(r.intent.startsWith('consoles'), `"${q}" matched ${r.intent}`);
    assert.ok(/assess/i.test(textOf(r)), `console answer must promise assessment first: ${textOf(r).slice(0, 120)}`);
    assert.ok(!/\$\d/.test(textOf(r)), 'console answer must never invent a price');
  }
});

/* -------------------------------------------- 8. the look is free, always */

test('any "do you charge to look" phrasing gets the free-inspection answer', () => {
  for (const q of ['do you charge to look at it', 'is the quote free', 'inspection fee',
                   'do you charge a checking fee', 'free inspection?']) {
    const r = createBrain(KB).respond(q);
    assert.ok(r.intent.startsWith('quote'), `"${q}" matched ${r.intent}`);
    assert.ok(/free/i.test(textOf(r)) && /macro lens/i.test(textOf(r)),
      `"${q}" should promise the free look under the macro lens: ${textOf(r).slice(0, 120)}`);
  }
});

/* ------------------------------- 9. price book, multi-fault, follow-ups */

test('the RepairDesk price book answers with exact recent figures', () => {
  for (const [q, want] of [
    ['iphone 16 pro max screen price', /price:iPhone 16 Pro Max:screen/],
    ['iphone 7 screen price', /price:iPhone 7:screen/],
    ['how much for a samsung s22 ultra screen', /price:Galaxy S22 Ultra:screen/],
    ['pixel 7 pro screen cost', /price:Google 7 Pro:screen/],
    ['iphone 14 pro max back glass price', /price:iPhone 14 Pro Max:back_glass/],
  ]) {
    const r = createBrain(KB).respond(q);
    assert.ok(want.test(r.intent), `"${q}" matched ${r.intent}`);
    assert.ok(/\$\d/.test(textOf(r)), `"${q}" should quote a real figure`);
  }
});

test('two faults in one breath get one stacked quote for one visit', () => {
  const r = createBrain(KB).respond('iphone 12 screen and battery price');
  assert.ok(r.intent.startsWith('price-multi:iPhone 12'), `matched ${r.intent}`);
  assert.ok(r.card && r.card.rows.some(row => /one visit/i.test(row[0])),
    'the card must total the visit');
  // and via memory: name the phone once, stack the faults later
  const b = createBrain(KB);
  b.respond('how much for an iphone 11 screen');
  const follow = b.respond('and the battery and charging port too');
  assert.ok(follow.intent.startsWith('price-multi:iPhone 11:battery+charging'),
    `memory multi-fault matched ${follow.intent}`);
  // a fault with no row never gets an invented line - single path answers
  const solo = createBrain(KB).respond('galaxy a15 screen and camera price');
  assert.ok(!/price-multi/.test(solo.intent) || !/camera.*\$/i.test(JSON.stringify(solo.card || '')),
    'no invented camera price');
});

test('repair follow-ups collect the ticket, then route it straight to the team', () => {
  for (const q of ['is my phone ready', 'whats the status of my ticket', 'has my part arrived',
                   'any update on my repair', 'when can i pick it up']) {
    const r = createBrain(KB).respond(q);
    assert.ok(r.intent.startsWith('repair_status'), `"${q}" matched ${r.intent}`);
    assert.ok(/ticket number|name or mobile/i.test(textOf(r)), 'must ask for the ticket details');
  }
  // step two: the details go into a prefilled WhatsApp link + the shop line
  const b = createBrain(KB);
  b.respond('is my phone ready');
  const f = b.respond('ticket 14213');
  assert.ok(f.intent === 'repair-status:followup', `details matched ${f.intent}`);
  assert.ok(f.links && f.links[0].href.includes('14213'), 'WhatsApp link must carry the ticket number');
  assert.ok(f.contact, 'must hand over the shop line too');
  assert.ok(!/ready for pickup|on the workbench|waiting on parts/i.test(textOf(f)),
    'must never fabricate a live status the chat cannot see');
  // a question instead of details escapes the flow cleanly
  const c = createBrain(KB);
  c.respond('is my repair ready');
  assert.ok(/^price:/.test(c.respond('actually how much is an iphone 13 screen?').intent),
    'a topic change mid-flow must route normally');
});

test('a symptom first never wipes memory - the model completes it', () => {
  // priceable fault: symptom, then bare model, straight to the quote
  const b = createBrain(KB);
  b.respond('battery drains fast');
  const q1 = b.respond('samsung s22 ultra');
  assert.ok(/^price:Galaxy S22 Ultra:battery/.test(q1.intent), `matched ${q1.intent}`);
  // board-level fault: symptom, then model, gets the free-look pivot with the
  // shop, macro lens and warranty anchored - never "what's going on with it?"
  const c = createBrain(KB);
  c.respond('my phone wont turn on');
  const q2 = c.respond('its an iphone 12');
  assert.ok(q2.intent === 'fault-follow:iPhone 12', `matched ${q2.intent}`);
  assert.ok(/macro lens/i.test(q2.text) && /kingsgrove/i.test(q2.text) && /3-month/i.test(q2.text),
    'the follow answer must anchor shop, free look and warranty');
  assert.ok(!/what.?s going on with it/i.test(q2.text), 'must never re-ask the symptom');
  // reboot/overheat phrasings route to faults, not fallback
  for (const [q, want] of [['my phone reboots', /fault_dead/], ['phone gets really hot', /fault_battery/],
                           ['my screen is flickering', /fault_screen/]]) {
    const r = createBrain(KB).respond(q);
    assert.ok(want.test(r.intent), `"${q}" matched ${r.intent}`);
  }
});

/* --------------------------- 10. adding a fault onto a standing quote */

test("a second fault added 'with my repair' stacks onto the standing quote", () => {
  // George's live transcript: screen quoted, a shopping detour, then
  // "what if i want to do the back glass with my repair" reverted to the
  // generic call-us answer. It must combo on the remembered phone instead.
  const b = createBrain(KB);
  b.respond('i have a cracked screen');
  b.respond('15 pro max front screen');
  b.respond('i need also some headphoens do you sell'); // detour must not wipe the quote
  const combo = b.respond('what ifg i want to do the back glass with my repair');
  assert.ok(combo.intent.startsWith('price-combo:iPhone 15 Pro Max'), `matched ${combo.intent}`);
  assert.ok(/one visit/i.test(combo.text), 'must sell the single visit');
  // and a non-glass pair stacks through the multi path
  const c = createBrain(KB);
  c.respond('iphone 11 battery price');
  const stacked = c.respond('can you do the charging port as well');
  assert.ok(stacked.intent.startsWith('price-multi:iPhone 11'), `matched ${stacked.intent}`);
});

/* -------------------------- 11. combos priced from real combined jobs */

test('a fault pair the shop has done before is priced off its history, silently', () => {
  // iPhone X screen+battery: 16 real combined jobs in the line history feed
  // the number, but the customer only sees the price - never the bookkeeping
  const hist = KB.pricing.multiCombos['iPhone X|battery+screen'];
  const r = createBrain(KB).respond('iphone x screen and battery price');
  assert.ok(r.intent.startsWith('price-multi:iPhone X'), `matched ${r.intent}`);
  const rows = JSON.stringify(r.card.rows);
  assert.ok(rows.includes('$' + hist.typical), 'the total must come from the real combined history');
  assert.ok(!/combined jobs|based on|most common|recent jobs/i.test(rows),
    'internal job stats must never reach the customer');
  // screen+back glass keeps George's rule, again with no history rows on show
  const c = createBrain(KB).respond('samsung s20 ultra screen and back glass');
  assert.ok(c.intent.startsWith('price-combo:Galaxy S20 Ultra'), `matched ${c.intent}`);
  assert.ok(!/combined jobs|based on|most common/i.test(JSON.stringify(c.card.rows)),
    'the combo card must not show job-history rows');
  // a pair with no history still gets an honest sum
  const KB2 = JSON.parse(JSON.stringify(KB));
  KB2.pricing.multiCombos = {};
  const s = createBrain(KB2).respond('iphone 11 battery and charging port price');
  assert.ok(s.intent.startsWith('price-multi:iPhone 11'), `matched ${s.intent}`);
  assert.ok(!/combined jobs/i.test(JSON.stringify(s.card.rows)), 'no fabricated history');
});

test('a phone switching itself off is a power fault, never a warranty dispute', () => {
  // live transcript: "it just turned off on its own" was riding the filler
  // words ("just", "its own") into the cracked-by-itself warranty script
  const b = createBrain(KB);
  b.respond('my phone reboots');
  const r = b.respond('it just turned off on its own');
  assert.ok(r.intent.startsWith('fault_dead'), `matched ${r.intent}`);
  assert.ok(!/after a repair|warranty/i.test(r.text), 'must not read as a post-repair dispute');
  // cold open routes the same way
  const cold = createBrain(KB).respond('it just turned off on its own');
  assert.ok(cold.intent.startsWith('fault_dead'), `matched ${cold.intent}`);
  // a real dispute still gets the de-escalation script
  const w = createBrain(KB).respond('my screen cracked on its own after you fixed it');
  assert.ok(w.intent.startsWith('warranty_dispute'), `matched ${w.intent}`);
});

test('ticket-priced repairs show a clean price, not shop bookkeeping', () => {
  // the exact card George flagged: back glass priced from 21 real jobs
  const r = createBrain(KB).respond('i need the back glass on my iphone 15 pro max repaired');
  assert.ok(r.card, 'must still quote a price card');
  const visible = JSON.stringify(r.card) + ' ' + r.text;
  assert.ok(!/based on|jobs since|recent jobs|most common|actually charged|sample/i.test(visible),
    'no internal stats anywhere the customer can see');
});

/* --------------------------------------------------- 6. identity holds */

test('asked straight out, Hope is honest but stays in character', () => {
  const t = textOf(createBrain(KB).respond('are you a real person or a bot'));
  assert.ok(/hope/i.test(t), 'the identity answer should own the name Hope');
  assert.ok(!/human being|definitely human|100% human/i.test(t), 'never claims to be human when asked straight');
  assert.ok(!BANNED.test(t));
});
