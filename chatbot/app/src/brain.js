/*
 * SMPR answer engine.
 *
 * One file, used in three places:
 *   - the offline demo (injected into demo.html by build.sh)
 *   - the local server, when no ANTHROPIC_API_KEY is set
 *   - as the safety net if a Claude call fails
 *
 * Everything it knows comes from knowledge-base.json. It never invents a price.
 */
function createBrain(KB) {
  var B = KB.business;

  var TOKENS = {
    phone: B.phone, phoneDial: B.phoneDial, email: B.email,
    address: B.address, addressShort: B.addressShort,
    hoursSummary: B.hoursSummary, warranty: B.warranty,
    website: String(B.website).replace(/^https?:\/\//, ''), name: B.name
  };

  function fill(s) {
    return String(s).replace(/\{\{(\w+)\}\}/g, function (m, k) {
      return TOKENS[k] !== undefined ? TOKENS[k] : m;
    });
  }

  function norm(s) {
    return ' ' + String(s).toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() + ' ';
  }

  var STOP = {};
  (' the a an is are do you my i it me to for of and in on can get with at be have has was ' +
   'what whats that this there if but so just any some one ').trim().split(' ')
    .forEach(function (w) { STOP[w] = 1; });

  // customers split words the bot knows as one ("after market", "i phone")
  function canon(t) {
    return t
      .replace(/ after market /g, ' aftermarket ')
      .replace(/ i phone /g, ' iphone ')
      .replace(/ sam sung /g, ' samsung ')
      .replace(/ in cell /g, ' incell ');
  }

  function sigTokens(t) {
    var out = {};
    t.trim().split(' ').forEach(function (w) {
      if (w.length >= 3 && !STOP[w]) out[w] = 1;
    });
    return out;
  }

  // precompute normalised patterns so punctuation can never cause a miss
  KB.intents.forEach(function (intent) {
    intent._pats = intent.patterns.map(function (p) { return norm(p).slice(0, -1); });
    intent._tokens = sigTokens(norm(intent.patterns.join(' ') + ' ' + intent.q));
  });

  // every word the bot knows, so one-typo messages still land
  var VOCAB = {};
  (function () {
    function learn(s) {
      norm(String(s || '')).trim().split(' ').forEach(function (w) {
        if (w.length >= 4) VOCAB[w] = 1;
      });
    }
    KB.intents.forEach(function (i) { i.patterns.forEach(learn); learn(i.q); });
    (KB.pricing.repairs || []).forEach(function (r) { learn(r.brand); learn(r.model); learn(r.repair); });
    (KB.pricing.tiers || []).forEach(function (t) { learn(t.id); learn(t.name); });
    ((KB.brands || {}).supported || []).forEach(learn);
    (KB.refusals || []).forEach(function (r) { (r.match || []).forEach(learn); });
    learn('aftermarket incell genuine diagnostic screen battery charging speaker camera repair price cost warranty booking');
  })();

  // one edit apart: substitution, missing/extra letter, or swapped neighbours
  function editClose(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    if (la === lb) {
      var diff = [];
      for (var i = 0; i < la; i++) if (a[i] !== b[i]) diff.push(i);
      if (diff.length === 1) return true;
      return diff.length === 2 && diff[1] === diff[0] + 1 &&
             a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
    }
    var s = la < lb ? a : b, l = la < lb ? b : a, si = 0, li = 0, used = false;
    while (si < s.length && li < l.length) {
      if (s[si] === l[li]) { si++; li++; continue; }
      if (used) return false;
      used = true; li++;
    }
    return true;
  }

  // edit distance capped at 2 - anything further is not a "minor typo"
  function editDist2(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > 2) return 3;
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[b.length];
  }

  // fix a token only when exactly one known word explains the typo -
  // ambiguity keeps the customer's spelling rather than guessing. Three
  // passes, strictest first: one edit away; an unfinished word ("scree",
  // "batt"); then two edits on longer words that kept their first letter.
  // The customer is never told - the corrected text is used silently.
  function autocorrect(t) {
    return ' ' + t.trim().split(' ').map(function (w) {
      if (w.length < 4 || VOCAB[w] || /\d/.test(w)) return w;
      // unfinished word first - "batt" means battery, not the one-edit "bath"
      // (battery/batteries collapse to the shared stem)
      var pre = [], v;
      for (v in VOCAB) {
        if (v.length > w.length && v.length - w.length <= 4 && v.indexOf(w) === 0) pre.push(v);
      }
      if (pre.length) {
        pre.sort(function (a, b) { return a.length - b.length; });
        var stem = pre[0], allStem = pre.every(function (p) { return p.indexOf(stem) === 0; });
        if (allStem) return stem;
      }
      var hit = null;
      for (v in VOCAB) {
        if (Math.abs(v.length - w.length) > 1) continue;
        if (editClose(w, v)) {
          if (hit && hit !== v) { hit = null; break; }
          hit = v;
        }
      }
      if (hit) return hit;
      // last resort: two edits, longer words only, first letter intact ("btery")
      if (w.length >= 5) {
        var hit2 = null;
        for (v in VOCAB) {
          if (v.length < 6 || v[0] !== w[0]) continue;
          if (editDist2(w, v) <= 2) {
            if (hit2 && hit2 !== v) { hit2 = null; break; }
            hit2 = v;
          }
        }
        if (hit2) return hit2;
      }
      return w;
    }).join(' ') + ' ';
  }

  /* ---------- prices ---------- */

  // Order matters: "cracked back glass" must hit back_glass before "cracked"
  // hits screen, and "battery not charging" is a battery job. Screen goes last.
  var REPAIR_WORDS = {
    back_glass: ['back glass', 'rear glass', 'back cover', 'housing'],
    battery: ['battery', 'batteries', 'drains', 'dying'],
    charging: ['charging port', 'charge port', 'not charging', 'charging', 'charger port'],
    camera: ['camera', 'lens'],
    speaker: ['ear speaker', 'loud speaker', 'speaker', 'microphone', 'muffled', 'no sound'],
    virus: ['virus', 'malware', 'pop ups', 'popups', 'pop up', 'hacked'],
    software: ['software', 'stuck on the logo', 'stuck on the apple logo', 'wont turn on after update', 'restore'],
    data: ['data transfer', 'data recovery', 'transfer my data', 'recover my data', 'recover my photos', 'transfer everything', 'transfer to my new phone', 'move my data', 'moved my data', 'everything onto my new phone'],
    screen: ['screen', 'display', 'lcd', 'oled', 'cracked', 'crack', 'shattered', 'broken screen', 'front glass', 'front screen', 'smashed the front', 'front is']
  };

  // These aren't tied to a model - a virus clean costs what it costs.
  var SERVICE_REPAIRS = { software: 1, virus: 1, data: 1 };

  var REPAIR_LABELS = {
    screen: 'screen replacement', battery: 'battery replacement',
    back_glass: 'back glass replacement', charging: 'charging port repair',
    camera: 'camera repair', speaker: 'speaker or microphone repair',
    software: 'software fix', virus: 'virus removal', data: 'data transfer'
  };
  function repairLabel(r) { return REPAIR_LABELS[r] || (r + ' repair'); }

  var MODELS = (function () {
    var seen = {};
    KB.pricing.repairs.forEach(function (r) { seen[r.model] = true; });
    return Object.keys(seen).sort(function (a, b) { return b.length - a.length; });
  })();

  function modelAliases(model) {
    var m = model.toLowerCase();
    var out = [m];
    if (m.indexOf('iphone ') === 0) out.push(m.replace('iphone ', ''));
    if (m.indexOf('galaxy ') === 0) out.push('samsung ' + m, m.replace('galaxy ', ''));
    return out;
  }

  function detectModel(t) {
    for (var i = 0; i < MODELS.length; i++) {
      var aliases = modelAliases(MODELS[i]);
      for (var j = 0; j < aliases.length; j++) {
        if (aliases[j].length >= 3 && t.indexOf(' ' + aliases[j] + ' ') !== -1) return MODELS[i];
      }
    }
    return null;
  }

  function detectRepair(t) {
    for (var k in REPAIR_WORDS) {
      for (var i = 0; i < REPAIR_WORDS[k].length; i++) {
        if (t.indexOf(' ' + REPAIR_WORDS[k][i]) !== -1) return k;
      }
    }
    return null;
  }

  var PRICE_INTENT = [' how much', ' price', ' cost', ' charge for', ' quote', ' pricing'];
  function looksLikePrice(t) {
    return PRICE_INTENT.some(function (p) { return t.indexOf(p) !== -1; });
  }

  // How long the customer is without the phone. A price without this is half an
  // answer - it's the second thing everyone asks.
  function turnaround(model, repair) {
    var row = priceRow(model, repair);
    if (row && row.time) return row.time;
    var t = KB.pricing.turnaround || {};
    return t[repair] || 'We\u2019ll confirm when you bring it in';
  }

  function priceRow(model, repair) {
    return KB.pricing.repairs.filter(function (r) {
      return r.model === model && r.repair === repair;
    })[0] || null;
  }

  // The in-conversation path. Same card as an externally sourced price -
  // priceCard is the single place a price is ever rendered.
  function priceAnswer(model, repair) {
    var card = priceCard(model, repair, priceRow(model, repair));
    if (card) return card;
    return {
      text: fill(KB.pricing.unknownPriceLine),
      card: null, contact: true,
      chips: ['Genuine or aftermarket?', 'How long does a repair take?'],
      intent: 'price:' + (model || '?') + ':' + (repair || '?') + ' (no listed price)'
    };
  }

  // Software, virus and data jobs cost what they cost, whatever the phone -
  // quoted straight from what the shop has actually charged for them.
  function serviceAnswer(repair) {
    var p = (KB.pricing.services || {})[repair];
    if (!p || p.sampleSize == null) return null;
    var range = (p.low != null && p.high != null && p.low !== p.high)
      ? '$' + p.low + '–$' + p.high
      : '$' + (p.typical != null ? p.typical : p.low);
    var rows = [['Recent jobs', range]];
    if (p.typical != null) rows.push(['Most common', '$' + p.typical]);
    if (p.turnaround) rows.push(['Time in store', p.turnaround]);
    rows.push(['Based on', p.sampleSize + ' jobs']);
    lastQuote = { model: null, repair: repair, label: p.label || repairLabel(repair), priceLine: range };
    return {
      text: p.typical != null
        ? 'A ' + repairLabel(repair) + ' is usually $' + p.typical + ' — recent jobs have run ' +
          range + ', and we’ll confirm the exact price once we’ve had a look at what’s going on.'
        : 'Most ' + repairLabel(repair) + ' jobs have come in around ' + range +
          ' — we’ll tell you the exact price once we’ve had a look at what’s going on.',
      card: {
        title: p.label || repairLabel(repair),
        rows: rows,
        note: 'That’s what we’ve actually charged recently, not a fixed price. ' +
              fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
      },
      contact: false,
      chips: ['Lock this price in', 'Do I need a booking?', 'How long does a repair take?'],
      intent: 'service:' + repair + ' (tickets, n=' + p.sampleSize + ')'
    };
  }

  /* ---------- matching ---------- */

  // Longer patterns may match a prefix, so "charge" catches "charges". Short
  // ones must match a whole word, or "yo" fires on "you".
  function patternHit(p, t) {
    if (p.length < 2) return false;
    if (p.trim().length <= 3) return t.indexOf(p + ' ') !== -1;
    return t.indexOf(p) !== -1;
  }

  function scoreIntent(intent, t) {
    var best = 0;
    for (var i = 0; i < intent._pats.length; i++) {
      var p = intent._pats[i];
      if (patternHit(p, t)) {
        var s = p.length + (p.trim().split(' ').length > 1 ? 6 : 0);
        if (s > best) best = s;
      }
    }
    return best;
  }

  function refusalCheck(t) {
    for (var i = 0; i < KB.refusals.length; i++) {
      var r = KB.refusals[i];
      for (var j = 0; j < r.match.length; j++) {
        if (patternHit(norm(r.match[j]).slice(0, -1), t)) {
          return {
            text: fill(r.answer), card: null, contact: false,
            chips: ['What do you repair?', 'Talk to a human'],
            intent: 'refusal:' + r.id
          };
        }
      }
    }
    return null;
  }

  function fromIntent(intent) {
    return {
      text: fill(intent.answer),
      card: null,
      contact: intent.id === 'human' || intent.id === 'complaint',
      chips: (intent.chips || []).slice(0, 3),
      intent: intent.id + ' (' + intent.category + ')'
    };
  }


  // A bare model name is a customer holding their phone at the counter.
  // Ask what's happened to it - don't recite the brands list.
  function isBareModel(t, model) {
    var s = ' ' + t + ' ';
    var aliases = modelAliases(model);
    for (var i = 0; i < aliases.length; i++) {
      s = s.replace(' ' + aliases[i] + ' ', ' ');
    }
    var left = s.trim().split(' ').filter(function (w) {
      return w.length >= 3 && !STOP[w] &&
        ['have','you','the','for','with','about','hey','got'].indexOf(w) === -1;
    });
    return left.length <= 1;
  }

  // The tappable problem list for one model: only faults we can actually
  // price for it (screen and battery always - everyone asks those).
  function modelOptions(model) {
    var defs = [
      ['screen', 'Cracked or broken screen'],
      ['battery', 'Battery dying fast'],
      ['charging', 'Not charging'],
      ['back_glass', 'Smashed back glass'],
      ['camera', 'Camera problem'],
      ['speaker', 'Speaker or microphone']
    ];
    var opts = [];
    defs.forEach(function (d) {
      var row = priceRow(model, d[0]);
      var quotable = row && ((row.costs && Object.keys(row.costs).length) || row.sampleSize >= 3);
      if (quotable || d[0] === 'screen' || d[0] === 'battery') {
        opts.push({ label: d[1], q: model + ' ' + REPAIR_WORDS[d[0]][0] });
      }
    });
    opts.push({ label: 'Got wet / water damage', q: 'my ' + model + ' got wet' });
    opts.push({ label: 'Case or accessory for it', q: 'case for ' + model });
    opts.push({ label: 'Something else', q: 'talk to a human' });
    return opts;
  }

  function modelClarify(model) {
    var art = /^[aeiou]/i.test(model) ? 'An ' : 'A ';
    return {
      text: art + model + ' — what\u2019s going on with it? Tap one below, or just tell me in your own words.',
      card: null, contact: false, products: null,
      options: modelOptions(model),
      chips: [],
      intent: 'model-clarify:' + model
    };
  }


  // "iphone" on its own deserves "which one?", not a recital of every brand.
  var DEVICE_NAMES = { iphone: 'iPhone', ipad: 'iPad', imac: 'iMac', macbook: 'MacBook',
    samsung: 'Samsung', galaxy: 'Galaxy', pixel: 'Pixel', oppo: 'Oppo', huawei: 'Huawei', ipod: 'iPod' };

  function bareDeviceClarify(t) {
    var toks = t.trim().split(' ');
    var dev = null;
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i].replace(/s$/, '');
      if (DEVICE_NAMES[w]) { dev = w; break; }
    }
    if (!dev) return null;
    var left = toks.filter(function (x) {
      var base = x.replace(/s$/, '');
      return x.length >= 3 && !STOP[x] && !DEVICE_NAMES[base] &&
        ['have','you','the','for','with','got','fix','repair','you','can'].indexOf(x) === -1;
    });
    if (left.length) return null;
    var nice = DEVICE_NAMES[dev];
    return {
      text: nice + ' — yep, we work on them all day. Which model have you got, and what\u2019s happening with it?\n\nOr if you\u2019re after a case, charger or another accessory, just tell me what kind.',
      card: null, contact: false, products: null,
      chips: ['How much is a screen repair?', 'Battery replacement', 'Do I need a booking?'],
      intent: 'device-clarify:' + dev
    };
  }


  /* ---------- locking in a quote ----------
   * Customer sees a price, says "lock it in", gives a name and mobile, and
   * the result is a lead the server can hand to FixDesk. The bot never asks
   * for anything beyond name + mobile (see guardrails).
   */
  var lastQuote = null;       // the last price the customer was shown
  var pendingBooking = null;  // {stage:'name'|'phone', name, quote}
  var bookings = [];          // completed leads, for the server to collect

  var BOOK_WORDS = [' lock it in', ' lock in', ' lock that in', ' lock this in',
    ' lock the price', ' lock this price', ' book it', ' book that', ' book me in',
    ' hold that price', ' hold the price', ' hold that for me', ' reserve that',
    ' book my ', ' book a repair', ' book in for', ' book phone in', ' make a booking',
    ' can i book', ' want to book', ' book an appointment'];

  function startBooking() {
    if (!lastQuote) {
      return {
        text: 'Happy to lock a price in. Tell me the phone and the problem first - say something like \u201ciPhone 12 screen\u201d - and once I\u2019ve quoted it, just say \u201clock it in\u201d.',
        card: null, contact: false, products: null,
        chips: ['How much is a screen repair?', 'iPhone battery'],
        intent: 'booking:no-quote'
      };
    }
    pendingBooking = { stage: 'name', quote: lastQuote };
    return {
      text: 'Good as done - I\u2019ll note down the ' + lastQuote.label + ' at ' + lastQuote.priceLine + ' for you. What\u2019s your first name?',
      card: null, contact: false, products: null, chips: [],
      intent: 'booking:name'
    };
  }

  function bookingStep(raw, t) {
    if (!pendingBooking) return null;
    // a question mid-flow gets answered; they can pick the booking up again
    if (raw.indexOf('?') !== -1) { pendingBooking = null; return null; }
    // so does a change of subject - a model or a fault is not a name
    if (detectModel(t) || detectRepair(t) || t.trim().split(' ').length > 5) {
      pendingBooking = null;
      return null;
    }
    if (t.indexOf(' cancel') !== -1 || t.indexOf(' never mind') !== -1 || t.indexOf(' forget it') !== -1) {
      pendingBooking = null;
      return {
        text: 'No worries - nothing saved. Say \u201clock it in\u201d any time and we\u2019ll pick it up again.',
        card: null, contact: false, products: null, chips: [], intent: 'booking:cancelled'
      };
    }
    if (pendingBooking.stage === 'name') {
      var name = raw.trim().replace(/^(hi|hey|im|i am|its|it is|my name is|name is|this is)\s+/i, '')
                          .split(/\s+/).slice(0, 3).join(' ');
      if (!/^[a-zA-Z][a-zA-Z' -]{1,39}$/.test(name)) {
        return {
          text: 'Just a name is all I need - like \u201cSarah\u201d or \u201cAhmed K\u201d.',
          card: null, contact: false, products: null, chips: [], intent: 'booking:name-retry'
        };
      }
      pendingBooking.name = name.split(' ').map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
      pendingBooking.stage = 'phone';
      return {
        text: 'Thanks ' + pendingBooking.name + '. And the best mobile number for you? George will text you to confirm.',
        card: null, contact: false, products: null, chips: [], intent: 'booking:phone'
      };
    }
    // stage: phone
    var digits = raw.replace(/[^0-9+]/g, '').replace(/^\+61/, '0');
    if (digits.length < 8 || digits.length > 11) {
      return {
        text: 'That doesn\u2019t look like a full number - what\u2019s the best mobile, like 04xx xxx xxx?',
        card: null, contact: false, products: null, chips: [], intent: 'booking:phone-retry'
      };
    }
    var q = pendingBooking.quote;
    var lead = { name: pendingBooking.name, phone: digits, model: q.model || null,
                 repair: q.repair, quoted: q.priceLine, source: 'chatbot' };
    bookings.push(lead);
    pendingBooking = null;
    return {
      text: 'Done, ' + lead.name + ' - you\u2019re locked in.',
      card: {
        title: 'Held for you',
        rows: [
          ['Job', q.label],
          ['Quoted', q.priceLine],
          ['Name', lead.name],
          ['Mobile', lead.phone]
        ],
        note: 'Just walk in whenever suits - ' + fill('{{hoursSummary}}') + ' Give your name at the counter and we\u2019ll have it ready. George will text you to confirm.'
      },
      contact: false, products: null,
      chips: ['Where are you?', 'How long does a repair take?'],
      booking: lead,
      intent: 'booking:done'
    };
  }


  // "Front and back done" is two jobs. Quote both on the one card rather
  // than making the customer ask twice.
  function wantsFrontAndBack(t) {
    return /front and back|back and front|screen and back|back and screen|front und back|screen and the back/.test(t);
  }

  // Back glass with a screen is an add-on, not a second job: ~$100 on top
  // for older models, ~$120 for newer (George's rule, comboRule in the KB).
  function backAddonFor(model) {
    var rule = KB.pricing.comboRule;
    if (!rule) return null;
    // Samsung back covers are cheap - flat $50 whatever the model
    if (/^Galaxy|^Samsung/i.test(model) && rule.samsungAddon != null) return rule.samsungAddon;
    var from = rule.newerFrom || {};
    var m;
    if ((m = model.match(/^iPhone (\d+)/)) && Number(m[1]) >= (from.iphone || 13)) return rule.newAddon;
    return rule.oldAddon;
  }

  function comboAnswer(model) {
    // George's rule first: price the pair off whichever screen they pick.
    var addon = backAddonFor(model);
    var sRowR = priceRow(model, 'screen');
    if (addon != null && sRowR) {
      var tiers2 = tierRows(sRowR.costs, model);
      if (tiers2.length) {
        var rows2 = tiers2.map(function (r) {
          return [r.label + ' + back glass', money(r.price + addon), r.blurb];
        });
        rows2.push(['Time in store', 'Usually same day for both']);
        var fromP = money(tiers2[0].price + addon);
        lastQuote = {
          model: model, repair: 'screen + back glass',
          label: model + ' screen + back glass (done together)',
          priceLine: 'from ' + fromP
        };
        var artR = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
        return {
          text: 'Front and back on ' + artR + model + ' \u2014 we do both in the one visit, and together it works out cheaper than two separate jobs: the back glass adds $' + addon + ' on top of whichever screen you go with.',
          card: {
            title: model + ' \u2014 screen + back glass',
            rows: rows2,
            note: fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
          },
          contact: false, products: null,
          chips: ['Lock this price in', 'What\u2019s the difference?', 'Do I need a booking?'],
          intent: 'price-combo:' + model + ' (rule, +$' + addon + ')'
        };
      }
    }
    // screens priced from job history (Samsung etc.): same rule, applied
    // to the range the screen alone has gone for.
    if (addon != null && sRowR && sRowR.sampleSize >= 3 && sRowR.low != null) {
      var lo = sRowR.low + addon, hi = sRowR.high + addon;
      var rangeT = lo !== hi ? '$' + lo + '\u2013$' + hi : '$' + lo;
      lastQuote = {
        model: model, repair: 'screen + back glass',
        label: model + ' screen + back glass (done together)',
        priceLine: rangeT
      };
      var artT = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
      var rowsT = [['Screen + back glass together', rangeT]];
      if (sRowR.typical != null) rowsT.push(['Most common', '$' + (sRowR.typical + addon)]);
      rowsT.push(['Time in store', 'Usually same day for both']);
      return {
        text: 'Front and back on ' + artT + model + ' \u2014 we do both in the one visit, and together it works out cheaper than two separate jobs: the back glass adds $' + addon + ' on top of the screen.',
        card: {
          title: model + ' \u2014 screen + back glass',
          rows: rowsT,
          note: 'Screen price is what recent ' + model + ' screen jobs have gone for, plus the back glass. ' +
                fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
        },
        contact: false, products: null,
        chips: ['Lock this price in', 'Do I need a booking?', 'How long does a repair take?'],
        intent: 'price-combo:' + model + ' (rule on tickets, +$' + addon + ')'
      };
    }
    // no priced screen for this model: fall back to what the pair has
    // actually gone for, then to the two-part card.
    var pkg = (KB.pricing.combos || {})[model];
    if (pkg) {
      var range = pkg.low !== pkg.high ? '$' + pkg.low + '\u2013$' + pkg.high : '$' + pkg.typical;
      lastQuote = {
        model: model, repair: 'screen + back glass',
        label: model + ' screen + back glass (done together)',
        priceLine: range
      };
      var art0 = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
      return {
        text: 'Front and back on ' + art0 + model + ' \u2014 we do both in the one visit, and doing them together works out cheaper than two separate jobs.',
        card: {
          title: model + ' \u2014 screen + back glass',
          rows: [
            ['Done together', range],
            ['Most common', '$' + pkg.typical],
            ['Time in store', 'Usually same day for both'],
            ['Based on', pkg.sampleSize + ' jobs' + (pkg.since ? ' since ' + pkg.since : '')]
          ],
          note: 'That\u2019s what we\u2019ve actually charged for the pair recently. ' +
                fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
        },
        contact: false, products: null,
        chips: ['Lock this price in', 'Do I need a booking?', 'How long does a repair take?'],
        intent: 'price-combo:' + model + ' (package, n=' + pkg.sampleSize + ')'
      };
    }
    var sRow = priceRow(model, 'screen');
    var gRow = priceRow(model, 'back_glass');
    var sLine = null, gLine = null;
    if (sRow) {
      var srows = tierRows(sRow.costs, model);
      if (srows.length) sLine = 'from ' + money(srows[0].price);
      else if (sRow.sampleSize >= 3) sLine = '$' + sRow.low + '\u2013$' + sRow.high;
    }
    if (gRow && gRow.sampleSize >= 3) gLine = '$' + gRow.low + '\u2013$' + gRow.high;
    if (!sLine && !gLine) return null;
    lastQuote = {
      model: model, repair: 'screen + back glass',
      label: model + ' screen + back glass',
      priceLine: (sLine || 'screen TBC') + ' front, ' + (gLine || 'TBC') + ' back'
    };
    var art = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
    return {
      text: 'Front and back on ' + art + model + ' \u2014 no problem, we do both in the one visit.',
      card: {
        title: model + ' \u2014 screen + back glass',
        rows: [
          ['Front screen', sLine || 'Call to confirm'],
          ['Back glass', gLine || 'Call to confirm'],
          ['Time in store', 'Usually same day for both']
        ],
        note: fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
      },
      contact: false, products: null,
      chips: ['Lock this price in', 'Do I need a booking?', 'How long does a repair take?'],
      intent: 'price-combo:' + model
    };
  }

  var lastIntentId = '';
  var lastModel = null;        // the device this conversation is about, across turns
  var repairDiscussed = false; // a specific issue has come up - handoffs are allowed now
  var missStreak = 0;          // consecutive answers we couldn't ground - 2 means stuck

  function respond(raw) {
    var res = respondCore(raw);
    if (res && res.intent) {
      lastIntentId = String(res.intent);
      missStreak = /^fallback/.test(lastIntentId) ? missStreak + 1 : 0;
    }
    return res;
  }

  // When the conversation is stuck, hand it to George with the context
  // attached instead of looping. WhatsApp deep link when the shop has a
  // number registered; the phone line either way.
  function escalateAnswer(raw) {
    var ctxBits = [];
    if (lastModel) ctxBits.push('Phone: ' + lastModel);
    ctxBits.push('Question: ' + String(raw).slice(0, 200));
    var ctx = 'Hi George - I was chatting with Hope on your website and have a question that needs a person. ' + ctxBits.join('. ');
    var wa = String(B.whatsapp || '').replace(/[^\d]/g, '');
    var res = {
      text: 'You know what, rather than me going back and forth - let me put you straight onto George. ' +
            (wa ? 'Tap below and it’ll open WhatsApp with your question ready to send, or ' : '') +
            'call ' + B.phone + ' and someone will sort you out on the spot. ' +
            'Or leave your number here and we’ll ring you back.',
      card: null, contact: true, products: null, options: null,
      chips: ['What do you repair?', 'Where are you?'],
      intent: 'fallback-escalate',
      escalate: { model: lastModel, question: String(raw).slice(0, 500) }
    };
    if (wa) res.links = [{ label: 'WhatsApp us now', href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(ctx) }];
    return res;
  }

  function respondCore(raw) {
    var t = canon(autocorrect(norm(raw)));

    // check refusals against the corrected AND the raw text - a "correction"
    // must never turn a refusable ask into an answerable one
    var ref = refusalCheck(t) || refusalCheck(canon(norm(raw)));
    if (ref) return ref;

    // mid-booking answers (name, mobile) come before everything else
    var step = bookingStep(raw, t);
    if (step) return step;

    if (BOOK_WORDS.some(function (p) { return t.indexOf(p) !== -1; })) return startBooking();

    // "what else have you got" continues the last product search
    var more = moreProducts(t);
    if (more) return more;

    // "ok i'll go the soft" right after a price card or the screen-options
    // explainer is picking a tier, not a new question - but "aftermarket,
    // what does that mean?" is still a question, so question words fall through
    if (/^price/.test(lastIntentId) &&
        !/\b(what|mean|difference|explain|which|why|how)\b/.test(t) &&
        t.trim().split(' ').length <= 8) {
      var tm = /\b(incell|soft|genuine|oem|diagnostic|aftermarket|cheapest)\b/.exec(t);
      if (tm) {
        var tw = { oem: 'genuine', cheapest: 'Incell', incell: 'Incell', soft: 'soft OLED',
                   genuine: 'genuine', diagnostic: 'diagnostic', aftermarket: 'aftermarket' }[tm[1]] || tm[1];
        return {
          text: 'Good choice - ' + tw + " it is. Tell me your phone model and I'll double-check what we've got for it, or book in below and we'll have it ready. Exact price gets confirmed on the spot before we touch the phone.",
          card: null, contact: false, products: null, options: null,
          chips: ['Book a repair', 'How long does it take?', 'Where are you?'],
          intent: 'tier_choice:' + tm[1]
        };
      }
    }

    // Shopping comes first when the words name something we sell - "screen
    // protector" must not be answered as a screen repair.
    var override = PRODUCT_OVERRIDE.some(function (w) { return t.indexOf(' ' + w) !== -1; });
    var shopQ = parseProductQuery(raw);
    if (shopQ && override) return productAnswer(shopQ);

    var model = detectModel(t);
    var repair = detectRepair(t);
    if (model) lastModel = model;  // remember the device across turns
    if (repair) repairDiscussed = true;
    if (repair && SERVICE_REPAIRS[repair]) {
      var svc = serviceAnswer(repair);
      if (svc) return svc;
    }
    if ((model || lastModel) && wantsFrontAndBack(t)) {
      var combo = comboAnswer(model || lastModel);
      if (combo) return combo;
    }
    if (model && (repair || looksLikePrice(t))) return priceAnswer(model, repair || 'screen');
    if (model && isBareModel(t, model)) return modelClarify(model);
    // "how much for a screen" after the customer already named their phone -
    // a person at the counter wouldn't ask which phone again. Questions about
    // time, warranty or process still get their own answers, not a price card.
    if (!model && repair && lastModel &&
        !/\b(long|take|takes|turnaround|warranty|guarantee|when|why|where|book|fix|repair)\b/.test(t) &&
        (looksLikePrice(t) || t.trim().split(' ').length <= 7)) {
      return priceAnswer(lastModel, repair);
    }
    var bare = bareDeviceClarify(t);
    if (bare && !(shopQ && shopQ.shopping)) return bare;
    if (shopQ) return productAnswer(shopQ);
    if (looksLikePrice(t) && !model && repair) {
      var byRepair = KB.intents.filter(function (i) {
        return i.id === (repair === 'battery' ? 'fault_battery' : 'price_general');
      })[0];
      if (byRepair) return fromIntent(byRepair);
    }

    // "have you moved from beverly hills" must confirm the move, not recite
    // the suburbs we serve - suburb names alone would out-score it below.
    if (/\b(you (guys )?moved?\b|have you moved|did you move|moved from|relocat\w*|still (in|at)|old (shop|store|address)|new (address|location)|king george)/.test(t) &&
        /\b(beverly|kingsgrove|king george|location|address|where|shop|store|moved)/.test(t)) {
      var movedIntent = KB.intents.filter(function (x) { return x.id === 'moved'; })[0];
      if (movedIntent) return fromIntent(movedIntent);
    }

    var best = null, bestScore = 0;
    for (var i = 0; i < KB.intents.length; i++) {
      if (model && KB.intents[i].id === 'brands') continue;
      var s = scoreIntent(KB.intents[i], t);
      if (s > bestScore) { bestScore = s; best = KB.intents[i]; }
    }
    if (best && bestScore >= 3) return fromIntent(best);

    // nothing matched as a phrase - try word overlap before giving up
    var toks = sigTokens(t), tokBest = null, tokScore = 0;
    for (var k = 0; k < KB.intents.length; k++) {
      if (model && KB.intents[k].id === 'brands') continue;
      // "moved" only fires on a real ask about the move - loose word overlap
      // ("i moved my data...") must never answer "yes, we've moved!"
      if (KB.intents[k].id === 'moved') continue;
      var n = 0;
      for (var w in toks) { if (KB.intents[k]._tokens[w]) n++; }
      if (n > tokScore) { tokScore = n; tokBest = KB.intents[k]; }
    }
    if (tokBest && tokScore >= 2) {
      var r2 = fromIntent(tokBest);
      r2.intent += ' [word-overlap]';
      return r2;
    }

    if (model) return modelClarify(model);

    // A broad "my phone's damaged" or a bare "i need help" is the start of a
    // conversation, not a dead end - ask what a counter tech would ask.
    // No forms, no number-collecting, ever, on an opener.
    var damageAsk = /\b(damaged?|broken?|smashed|cracked|dropped|busted|shattered|dead|stuffed|cooked|wrecked|faulty|playing up|not working|wont work|stopped working|issues?|problems?|trouble|help)\b/.test(t) &&
                    /\b(phone|mobile|device|ipad|tablet|laptop|macbook|watch|it)\b/.test(t);
    var helpAsk = t.trim().split(' ').length <= 6 && /\b(help|assist|question|enquiry|inquiry)\b/.test(t);
    if (damageAsk || helpAsk) {
      return {
        text: "No worries at all - what's going on with your device, and what model is it? " +
              "Cracked screen, battery dying, won't turn on... whatever you can tell me and I'll sort you out.",
        card: null, contact: false, products: null, options: null,
        chips: ['iPhone', 'Samsung', 'Something else'],
        intent: 'triage'
      };
    }

    // Handoffs are earned, not default. Only once a specific device or repair
    // has actually been discussed and we're still missing does the customer
    // get handed to George; before that, stay in the conversation.
    if (missStreak >= 1 && (lastModel || repairDiscussed)) return escalateAnswer(raw);
    if (missStreak >= 1) {
      return {
        text: "I might be getting my wires crossed, sorry! Easiest thing - tell me what device " +
              "you've got and what's happened to it, and I'll take it from there. " +
              "Or if it's quicker, " + fill('give us a ring on {{phone}} - someone’s always on the counter.'),
        card: null, contact: true, products: null, options: null,
        chips: ['What do you repair?', 'How much does a repair cost?', 'What are your hours?'],
        intent: 'fallback-steer'
      };
    }

    return {
      text: "Hmm, I want to make sure I get you the right answer rather than guess. " +
            "What device is it, and what's going on with it?",
      card: null, contact: false,
      chips: ['What do you repair?', 'How much does a repair cost?', 'What are your hours?'],
      intent: 'fallback'
    };
  }

  /* ---------- the shop: find the thing, show the price, say if it's here ---- */

  var SHOP_WORDS = ['case','cover','charger','cable','protector','tempered','power bank','powerbank',
    'headphone','headphones','earbud','earbuds','earphone','earphones','airpod','airpods','speaker',
    'accessory','accessories','buy','sell','price of','do you have','do you sell','in stock','stock',
    'looking for','got any','after a',
    'powerbeats','quietcomfort','soundcore','soundlink','magsafe',
    'steam deck','sd card','memory card','flip phone','senior phone','laptop','macbook for sale',
    'tablet','smart watch','galaxy watch','monitor','mouse','keyboard','flashlight'];

  var BRANDS = ['bose','beats','sony','anker','baseus','samsung','apple','jbl','cygnett','romoss',
    'acefast','uag','iquick','efm','kogan','sennheiser','skullcandy','logitech'];

  // A repair beats a product, except when the words name a thing we sell:
  // "screen protector" is a product, "screen replacement" is a repair.
  var PRODUCT_OVERRIDE = ['protector','case','cover','charger','cable','power bank','powerbank',
    'headphone','earbud','earphone','airpod','speaker'];

  function catalogueItems() {
    return (KB.catalogue && KB.catalogue.items) || [];
  }

  /* A person behind the counter says "comes in black or white - which do you
   * like?" and mentions the condition of a used one. Read both off the title,
   * so it works for the offline sample and the live store alike. */
  var COLOURS = ['black','white','blue','navy','pink','silver','grey','gray','gold','red',
                 'green','purple','orange','titanium','cream','midnight','starlight','ultramarine'];

  function colourOf(title) {
    var t = ' ' + String(title).toLowerCase() + ' ';
    for (var i = 0; i < COLOURS.length; i++) {
      if (t.indexOf(COLOURS[i]) !== -1) return COLOURS[i] === 'gray' ? 'grey' : COLOURS[i];
    }
    return null;
  }

  var CONDS = [
    [/like new|as new/i, 'As new'],
    [/immaculate/i, 'Immaculate'],
    [/excellent/i, 'Excellent condition'],
    [/grade a/i, 'Grade A'], [/grade b/i, 'Grade B'], [/grade c/i, 'Grade C'],
    [/refurbished/i, 'Refurbished'],
    [/pre.?loved/i, 'Pre-loved'],
    [/out.of.box/i, 'New, out of box'],
    [/used/i, 'Used, tested']
  ];

  function conditionOf(title) {
    for (var i = 0; i < CONDS.length; i++) {
      if (CONDS[i][0].test(title)) return CONDS[i][1];
    }
    return null;
  }

  // what's left of a title once colour, condition and bracketed notes go -
  // two listings sharing this are the same product in different colours
  function baseKey(title) {
    var t = String(title).toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/[-\u2013\u2014].*$/, ' ');
    COLOURS.forEach(function (c) { t = t.replace(c, ' '); });
    t = t.replace(/used|refurbished|pre.?loved|excellent|immaculate|genuine|condition|like new|as new|grade [abc]/g, ' ');
    return t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function shortName(title) {
    var t = String(title).replace(/\(.*?\)/g, '').split(/[-\u2013\u2014]/)[0];
    return t.replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  }

  // What kind of thing this is, read off the title. Shopify's product types are
  // too coarse - it files earbuds and over-ear headphones both as "Headphones".
  var KINDS = [
    ['earbuds',   /earbud|earphone|in.ear|airpod|powerbeats|buds\b/i],
    ['headphones',/headphone|over.ear|on.the.ear|on.ear|headset/i],
    ['speaker',   /speaker|soundlink|boombox/i],
    ['power bank',/power ?bank|powerbank/i],
    ['charger',   /charger|adapter|charging (dock|pad)/i],
    ['cable',     /cable|cord|lead\b/i],
    ['protector', /protector|tempered|screen guard/i],
    ['case',      /\bcase\b|cover|folio|bumper/i],
    ['tablet',    /tablet|ipad/i],
    ['watch',     /watch/i],
    // an actual handset names a phone brand AND storage / condition - "128GB"
    // alone also matches laptops, and "phone" alone matches phone holders
    ['phone',     /handset|(iphone|galaxy|pixel|oppo|vivo|nokia|motorola|xiaomi)[^,]*(\d+ ?gb|refurbish|pre.?loved|pre loved|unlocked)|(\d+ ?gb)[^,]*(iphone|galaxy|pixel)/i]
  ];

  function kindOf(item) {
    var hay = item.t + ' ' + (item.c || '');
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i][1].test(hay)) return KINDS[i][0];
    }
    return null;
  }

  function kindInQuery(t) {
    // "phone"/"handset" in the question means a handset, unless they said
    // which accessory; "buy an iphone" means a handset too
    if (/\b(phones?|handsets?)\b/.test(t) &&
        !/(case|cover|protector|charger|cable|holder|mount|part|screen)/.test(t)) return 'phone';
    if (/\b(an?|new|used|refurbished|refurb|cheap|second ?hand|pre ?loved)\s+(iphone|samsung|galaxy|pixel)\b/.test(t) &&
        /\b(buy|sell|got|have|after|looking|want)\b/.test(t)) return 'phone';
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i][1].test(t)) return KINDS[i][0];
    }
    return null;
  }

  function scoreItem(item, terms) {
    var hay = (item.t + ' ' + (item.c || '')).toLowerCase();
    var n = 0;
    for (var i = 0; i < terms.length; i++) {
      // a bare number must match as a whole word - "13" is not in "130W"
      if (/^\d+$/.test(terms[i])) {
        if (new RegExp('(^|[^0-9])' + terms[i] + '([^0-9]|$)').test(hay)) n += 2;
      } else if (hay.indexOf(terms[i]) !== -1) n++;
    }
    return n;
  }

  // Naming a brand or a kind is a filter, not a hint. Ask for Sony headphones
  // and a Bose pair in the list makes the shop look like it isn't listening.
  function searchCatalogue(terms, items, opts) {
    opts = opts || {};
    var list = items || catalogueItems();

    if (opts.brand) {
      var branded = list.filter(function (i) {
        return (i.t + ' ' + (i.c || '')).toLowerCase().indexOf(opts.brand) !== -1;
      });
      if (branded.length) list = branded;
    }
    if (opts.kind) {
      var kinded = list.filter(function (i) { return kindOf(i) === opts.kind; });
      if (kinded.length) list = kinded;
    }
    if (opts.colour) {
      var coloured = list.filter(function (i) { return colourOf(i.t) === opts.colour; });
      if (coloured.length) list = coloured;
    }

    return list
      .map(function (item) { return { item: item, score: scoreItem(item, terms) }; })
      .filter(function (x) { return x.score > 0 || opts.brand || opts.kind; })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if ((b.item.s > 0) !== (a.item.s > 0)) return (b.item.s > 0) - (a.item.s > 0);
        return a.item.p - b.item.p;                  // cheapest first among equals
      })
      .map(function (x) { return x.item; });
  }

  // Returns {terms, brand} when the customer is shopping, null when they aren't.
  function parseProductQuery(raw) {
    var t = canon(autocorrect(norm(raw)));
    var brand = null;
    for (var i = 0; i < BRANDS.length; i++) {
      if (t.indexOf(' ' + BRANDS[i]) !== -1) { brand = BRANDS[i]; break; }
    }
    var shopping = false;
    for (var j = 0; j < SHOP_WORDS.length; j++) {
      if (t.indexOf(' ' + SHOP_WORDS[j]) !== -1) { shopping = true; break; }
    }
    var colour = null;
    for (var c = 0; c < COLOURS.length; c++) {
      if (t.indexOf(' ' + COLOURS[c] + ' ') !== -1) { colour = COLOURS[c] === 'gray' ? 'grey' : COLOURS[c]; break; }
    }
    if (!brand && !shopping) return null;

    // a repair question that happens to name a brand is not a shopping question
    if (!shopping && detectRepair(t) && detectModel(t)) return null;

    var terms = t.trim().split(' ').filter(function (w) {
      // model numbers ("13", "8") are short but load-bearing - keep digits
      if (/^\d+$/.test(w)) return true;
      return w.length >= 3 && !STOP[w] && ['how','much','you','the','for','have','got','sell','buy',
        'any','are','can','want','need','looking','after','does','with'].indexOf(w) === -1;
    });
    return { terms: terms, brand: brand, kind: kindInQuery(t), colour: colour, shopping: shopping };
  }

  // A bare brand is a question, not an answer: ask which kind before listing.
  function categoriesFor(brand) {
    var seen = {}, out = [];
    catalogueItems().forEach(function (item) {
      if ((item.t + ' ' + (item.c || '')).toLowerCase().indexOf(brand) === -1) return;
      var k = kindOf(item);
      if (k && !seen[k]) { seen[k] = 1; out.push(k); }
    });
    return out;
  }

  function productPayload(item) {
    return {
      title: item.t,
      price: item.p,
      stock: item.s,
      colour: colourOf(item.t),
      cond: conditionOf(item.t),
      img: item.img ? (KB.catalogue.imageBase || '') + item.img : (item.img2 || null),
      kind: kindOf(item),
      url: (KB.catalogue.productUrl || '') + item.h,
      // Shopify cart permalink - one tap and it's in their cart, rather than
      // making them find the button on the product page.
      cart: item.v && KB.catalogue.cartUrl ? KB.catalogue.cartUrl + item.v + ':1' : null
    };
  }

  // "what else have you got" only means something if we remember what they
  // were just looking at. One query back is enough.
  var lastShop = null;

  var MORE_WORDS = [' what other', ' any other', ' anything else', ' what else',
    ' other models', ' other ones', ' more options', ' show me more', ' any more',
    ' got more', ' something else', ' the rest', ' keep going'];

  function moreProducts(t) {
    if (!lastShop) return null;
    var hit = MORE_WORDS.some(function (p) { return t.indexOf(p) !== -1; });
    if (!hit) return null;
    var found = searchCatalogue(lastShop.parsed.terms, null,
      { brand: lastShop.parsed.brand, kind: lastShop.parsed.kind })
      .filter(function (i) { return lastShop.shown.indexOf(i.h) === -1; });
    if (!found.length) {
      return {
        text: 'That’s everything I can see on the shelf for that one. Give us a ring on ' +
              B.phone + ' and we’ll check out the back.',
        card: null, contact: true, products: null,
        chips: ['Can I pick up in store?', 'What do you sell?'],
        intent: 'shop:no-more'
      };
    }
    return productAnswer(lastShop.parsed, found);
  }

  function productAnswer(parsed, items) {
    // A brand with no kind is a question, not an answer - ask which, the way
    // someone behind the counter would, and offer the kinds actually in stock.
    if (parsed.brand && !parsed.kind) {
      var cats = categoriesFor(parsed.brand);
      if (cats.length > 1) {
        var nice = parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1);
        var listCats = cats.slice(0, 4);
        var catLine = listCats.slice(0, -1).join(', ') + ' and ' + listCats[listCats.length - 1];
        if (cats.length > 4) catLine += ' — and a fair bit more';
        return {
          text: nice + ' — what are you after? We\u2019ve got ' + catLine + ' in at the moment.',
          card: null, contact: false, products: null,
          chips: cats.slice(0, 3).map(function (c) { return nice + ' ' + c; }),
          intent: 'shop:clarify:' + parsed.brand
        };
      }
    }

    var found = items || searchCatalogue(parsed.terms, null,
      { brand: parsed.brand, kind: parsed.kind, colour: parsed.colour });

    // Same product, two colours, and they haven't picked one: ask, like a
    // person would, and show both so they can see the difference.
    if (!parsed.colour && found.length >= 2) {
      var groups = {};
      found.slice(0, 6).forEach(function (item) {
        var k = baseKey(item.t);
        (groups[k] = groups[k] || []).push(item);
      });
      for (var gk in groups) {
        var g = groups[gk];
        var cols = [];
        g.forEach(function (item) {
          var c = colourOf(item.t);
          if (c && cols.indexOf(c) === -1) cols.push(c);
        });
        if (g.length >= 2 && cols.length >= 2) {
          var name = shortName(g[0].t);
          return {
            text: 'We\u2019ve got the ' + name + ' in ' +
                  cols.slice(0, -1).join(', ') + ' and ' + cols[cols.length - 1] +
                  ' \u2014 which colour do you like?',
            card: null, contact: false,
            products: g.slice(0, 3).map(productPayload),
            chips: cols.slice(0, 3).map(function (c) { return name + ' ' + c; }),
            intent: 'shop:colour-ask:' + gk.split(' ').slice(0, 3).join('-')
          };
        }
      }
    }

    if (!found.length) {
      return {
        text: 'I can\u2019t see that one on the shelf right now. Stock moves fast, so give us a ring on ' +
              B.phone + ' and we\u2019ll check out the back — or tell me what you\u2019re after and I\u2019ll look again.',
        card: null, contact: true, products: null,
        chips: ['What do you sell?', 'Do you sell refurbished phones?'],
        intent: 'shop:nothing-found'
      };
    }

    var top = found.slice(0, 3);
    var lead = top.length === 1
      ? 'Yep, we\u2019ve got one here:'
      : 'Yep — here\u2019s what we\u2019ve got in at the moment:';
    var extra = found.length - top.length;

    lastShop = {
      parsed: parsed,
      // a continuation (items passed in) extends the list already shown
      shown: (items && lastShop ? lastShop.shown : [])
        .concat(top.map(function (i) { return i.h; }))
    };

    return {
      text: lead + (extra > 0
        ? ' There\u2019s ' + extra + ' more where that came from — say \u201cwhat else\u201d and I\u2019ll show you.'
        : ''),
      card: null,
      contact: false,
      products: top.map(productPayload),
      chips: ['Can I pick up in store?', 'What are your hours?'],
      intent: 'shop:' + parsed.terms.join('+') + ' (' + found.length + ' match' + (found.length === 1 ? '' : 'es') + ')'
    };
  }

  // Exposed so a caller with a live price source (FixDesk) can intercept a
  // price question, fetch the real number, and render the same card.
  function parsePriceQuery(raw) {
    var t = norm(raw);
    var model = detectModel(t);
    var repair = detectRepair(t);
    if (!model) return null;
    if (!repair && !looksLikePrice(t)) return null;
    return { model: model, repair: repair || 'screen' };
  }

  /* ---------- how a price is worked out ------------------------------------
   * Retail = (part cost ex GST + labour) x GST. George's arithmetic, so the
   * shop keeps one number per part and every quote follows from it - no retail
   * list to go stale.
   * -------------------------------------------------------------------- */

  function formula() {
    return KB.pricing.formula || { labour: 100, gstMultiplier: 1.1 };
  }

  function retailFromCost(cost) {
    if (cost == null) return null;
    var f = formula();
    // Settle the float to cents first. (0 + 100) * 1.1 is 110.00000000000001 in
    // JS, and a bare ceil() would push an exact $110 up to $115.
    var value = Math.round((Number(cost) + Number(f.labour)) * Number(f.gstMultiplier) * 100) / 100;
    // Always up to the next $5, never down - $172 becomes $175, $177 becomes $180.
    var step = Number(f.roundUpTo || 0);
    if (step > 0) return Math.ceil(value / step) * step;
    return value;
  }

  function money(n) {
    if (n == null) return null;
    return '$' + (n % 1 === 0 ? String(n) : n.toFixed(2));
  }

  function tiers() {
    return KB.pricing.tiers || [];
  }

  // Incell is the normal aftermarket panel on an LCD iPhone, but a real step
  // down on an OLED one. Say which, rather than just quoting the cheap number.
  function isLcdPhone(model) {
    return (KB.pricing.lcdModels || []).some(function (m) { return model.indexOf(m) === 0; });
  }

  function blurbFor(tier, model) {
    if (tier.id === 'incell' && model && !isLcdPhone(model)) {
      return KB.pricing.incellOnOled || tier.blurb;
    }
    if (tier.id === 'incell' && model && isLcdPhone(model)) {
      return 'LCD, same as the original panel';
    }
    return tier.blurb;
  }

  // {soft: 55, diagnostic: 85} -> the rows a customer sees, cheapest first
  function tierRows(costs, model) {
    if (!costs) return [];
    return tiers()
      .filter(function (t) { return costs[t.id] != null; })
      .map(function (t) {
        return { id: t.id, label: t.label, blurb: blurbFor(t, model), price: retailFromCost(costs[t.id]) };
      })
      .sort(function (a, b) { return a.price - b.price; });
  }

  // prices comes from anywhere - a price list, or aggregated repair tickets.
  //   list form:   {aftermarket, genuine}
  //   ticket form: {low, high, typical, sampleSize, since}
  // Null values render as "call to confirm". The bot still never invents a
  // number, and never quotes a ticket average off a handful of jobs.
  var MIN_TICKETS = 3;

  function ticketCard(model, repair, p) {
    var label = model + ' ' + repairLabel(repair);
    var art = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
    var range = (p.low != null && p.high != null && p.low !== p.high)
      ? '$' + p.low + '–$' + p.high
      : '$' + (p.typical != null ? p.typical : p.low);
    lastQuote = { model: model, repair: repair, label: label, priceLine: range };
    var rows = [['Recent jobs', range]];
    if (p.typical != null) rows.push(['Most common', '$' + p.typical]);
    rows.push(['Time in store', turnaround(model, repair)]);
    rows.push(['Based on', p.sampleSize + ' job' + (p.sampleSize === 1 ? '' : 's') +
                            (p.since ? ' since ' + p.since : '')]);
    return {
      // lead with the exact figure - the range is context, not the answer
      text: p.typical != null
        ? 'A' + (art === 'an ' ? 'n' : '') + ' ' + model + ' ' + repairLabel(repair) +
          ' is usually $' + p.typical + ' fitted — recent jobs have run ' + range +
          ' depending on the part you go with.'
        : 'Most ' + model + ' ' + repairLabel(repair) +
          ' jobs have come in around ' + range + ' — it depends on the part you go with.',
      card: {
        title: label,
        rows: rows,
        note: 'That’s what we’ve actually charged recently, not a fixed price. ' +
              fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
      },
      contact: false,
      chips: ['Lock this price in', 'Genuine or aftermarket?', 'Do I need a booking?'],
      intent: 'price:' + model + ':' + repair + ' (tickets, n=' + p.sampleSize + ')'
    };
  }

  function priceCard(model, repair, prices) {
    // The normal path: part costs the shop has confirmed, run through the formula.
    var rows = tierRows(prices && prices.costs, model);
    if (rows.length) {
      var art = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
      var cheapest = rows[0];
      var priced = rows.length;
      // Genuine is always an option on a screen job, even when no genuine part
      // cost is in the file. Old listing price if we hold one, else "call".
      if (repair === 'screen' && !rows.some(function (r) { return r.id === 'genuine'; })) {
        var gTier = tiers().filter(function (t) { return t.id === 'genuine'; })[0];
        var gLegacy = prices.legacyRetail && prices.legacyRetail.genuine;
        rows.push({
          id: 'genuine',
          label: gTier ? gTier.label : 'Genuine OEM',
          blurb: gTier ? gTier.blurb : 'Original Apple part',
          price: gLegacy != null ? gLegacy : null
        });
        if (gLegacy != null) priced += 1;
      }
      lastQuote = { model: model, repair: repair, label: model + ' ' + repairLabel(repair),
                    priceLine: 'from ' + money(cheapest.price) };
      return {
        text: 'For ' + art + model + ' ' + repairLabel(repair) +
              ', we do ' + priced + ' option' + (priced === 1 ? '' : 's') +
              ' — from ' + money(cheapest.price) + ' fitted.',
        card: {
          title: model + ' ' + repairLabel(repair),
          rows: rows.map(function (r) { return [r.label, r.price != null ? money(r.price) : 'Call to confirm', r.blurb]; })
                    .concat([['Time in store', turnaround(model, repair)]]),
          note: fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
        },
        contact: false,
        chips: repair === 'screen'
          ? ['Lock this price in', 'What\u2019s the difference?', 'Screen protector for ' + model]
          : ['Lock this price in', 'Genuine or aftermarket?', 'Do I need a booking?'],
        intent: 'price:' + model + ':' + repair + (prices.source ? ' (' + prices.source + ')' : '')
      };
    }

    // ticket-derived pricing, but only once there are enough jobs to mean anything
    if (prices && prices.sampleSize != null) {
      if (prices.sampleSize >= MIN_TICKETS && (prices.typical != null || prices.low != null)) {
        return ticketCard(model, repair, prices);
      }
      prices = null;   // too few jobs to quote from - fall through to "call us"
    }
    // Nothing quotable from this source. Return null rather than an answer, so
    // the caller can try the next source before telling the customer to ring.
    if (!prices || (prices.aftermarket == null && prices.genuine == null)) return null;
    var art = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
    return {
      text: 'Here’s our guide price for ' + art + model + ' ' +
            repairLabel(repair) + ' — usually done in under an hour while you wait.',
      card: {
        title: model + ' ' + (repair === 'screen' ? 'screen replacement' : 'battery replacement'),
        rows: [
          ['Aftermarket part', prices.aftermarket != null ? '$' + prices.aftermarket : 'call to confirm'],
          ['Genuine OEM part', prices.genuine != null ? '$' + prices.genuine : 'call to confirm'],
          ['Time in store', turnaround(model, repair)]
        ],
        note: fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
      },
      contact: false,
      chips: repair === 'screen'
        ? ['Genuine or aftermarket?', 'Screen protector for ' + model, 'Do I need a booking?']
        : ['Genuine or aftermarket?', 'Power bank', 'Do I need a booking?'],
      intent: 'price:' + model + ':' + repair + (prices.source ? ' (' + prices.source + ')' : '')
    };
  }

  return {
    respond: respond, fill: fill, norm: norm,
    parsePriceQuery: parsePriceQuery, priceCard: priceCard,
    parseProductQuery: parseProductQuery, productAnswer: productAnswer, searchCatalogue: searchCatalogue,
    retailFromCost: retailFromCost, tierRows: tierRows
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBrain: createBrain };
if (typeof window !== 'undefined') window.createBrain = createBrain;
