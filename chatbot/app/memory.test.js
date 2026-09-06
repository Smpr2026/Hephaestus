/* The gap-answer memory: what Claude works out once must come back locally,
 * paraphrases and all, with no customer detail ever written to disk. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMemory, scrub, worthKeeping } = require('./src/memory.js');

function fresh() {
  return createMemory(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smpr-mem-')), 'answers.json'));
}

test('a learned answer comes back for the same question and close paraphrases', () => {
  const m = fresh();
  assert.ok(m.learn('does a cracked camera lens affect photo quality',
    'It will - even a hairline crack scatters light. We can swap just the lens glass, bring it in for a free look.'));
  assert.ok(m.match('Does a cracked camera lens affect photo quality?'), 'exact match');
  assert.ok(m.match('cracked camera lens - does quality of photo get affected'), 'word-order paraphrase');
  assert.strictEqual(m.match('how much is a screen'), null, 'unrelated question stays unanswered');
});

test('phone numbers and emails never land on disk', () => {
  assert.ok(!/0466/.test(scrub('call me back on 0466 661 669 thanks')));
  assert.ok(!/@/.test(scrub('email me at george@example.com')));
  const m = fresh();
  m.learn('my number is 0466661669 what about dust under glass', 'Dust under the glass means the seal has lifted - we re-seal it in store.');
  assert.ok(m.match('what about dust under glass'), 'the question minus the number still matches');
});

test('useless "I would have to check" answers are not kept', () => {
  assert.strictEqual(worthKeeping("I'd have to check that one with the team - give us a ring."), false);
  assert.strictEqual(worthKeeping(''), false);
  assert.strictEqual(worthKeeping('Yes - the 15 Pro Max uses a different lens part to the 15 Pro, both in stock.'), true);
});

test('memory survives a restart via the file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smpr-mem-')), 'answers.json');
  const m1 = createMemory(file);
  m1.learn('do you repair drone controllers', 'Not drones themselves, but if the controller has a standard USB-C port fault we can look at it - free assessment.');
  // saveSoon debounces; write synchronously for the test by waiting it out
  return new Promise(resolve => setTimeout(() => {
    const m2 = createMemory(file);
    assert.ok(m2.match('do you repair drone controllers'), 'answer came back after reload');
    resolve();
  }, 2300));
});
