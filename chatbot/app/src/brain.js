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

  /* ---------- prices ---------- */

  var REPAIR_WORDS = {
    screen: ['screen', 'display', 'lcd', 'oled', 'cracked', 'crack', 'shattered', 'broken screen'],
    battery: ['battery', 'batteries', 'drains', 'dying']
  };

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

  function priceRow(model, repair) {
    return KB.pricing.repairs.filter(function (r) {
      return r.model === model && r.repair === repair;
    })[0] || null;
  }

  function priceAnswer(model, repair) {
    var row = priceRow(model, repair);
    var label = model + ' ' + (repair === 'screen' ? 'screen replacement' : 'battery replacement');

    if (!row || (row.aftermarket == null && row.genuine == null)) {
      return {
        text: fill(KB.pricing.unknownPriceLine),
        card: null, contact: true,
        chips: ['Genuine or aftermarket?', 'How long does a repair take?'],
        intent: 'price:' + (model || '?') + ':' + (repair || '?') + ' (no listed price)'
      };
    }

    var rows = [
      ['Aftermarket part', row.aftermarket != null ? '$' + row.aftermarket : 'call to confirm'],
      ['Genuine OEM part', row.genuine != null ? '$' + row.genuine : 'call to confirm']
    ];
    var art = /^[aeiou]/i.test(model) ? 'an ' : 'a ';

    return {
      text: 'Here’s our guide price for ' + art + model + ' ' +
            (repair === 'screen' ? 'screen' : 'battery') +
            ' replacement — usually done in under an hour while you wait.',
      card: {
        title: label,
        rows: rows,
        note: fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
      },
      contact: false,
      chips: ['Genuine or aftermarket?', 'Do I need a booking?', 'Where are you?'],
      intent: 'price:' + model + ':' + repair
    };
  }

  /* ---------- matching ---------- */

  function scoreIntent(intent, t) {
    var best = 0;
    for (var i = 0; i < intent._pats.length; i++) {
      var p = intent._pats[i];
      if (p.length > 1 && t.indexOf(p) !== -1) {
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
        if (t.indexOf(norm(r.match[j]).slice(0, -1)) !== -1) {
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

  function respond(raw) {
    var t = norm(raw);

    var ref = refusalCheck(t);
    if (ref) return ref;

    var model = detectModel(t);
    var repair = detectRepair(t);
    if (model && (repair || looksLikePrice(t))) return priceAnswer(model, repair || 'screen');
    if (looksLikePrice(t) && !model && repair) {
      var byRepair = KB.intents.filter(function (i) {
        return i.id === (repair === 'battery' ? 'fault_battery' : 'price_general');
      })[0];
      if (byRepair) return fromIntent(byRepair);
    }

    var best = null, bestScore = 0;
    for (var i = 0; i < KB.intents.length; i++) {
      var s = scoreIntent(KB.intents[i], t);
      if (s > bestScore) { bestScore = s; best = KB.intents[i]; }
    }
    if (best && bestScore >= 3) return fromIntent(best);

    // nothing matched as a phrase - try word overlap before giving up
    var toks = sigTokens(t), tokBest = null, tokScore = 0;
    for (var k = 0; k < KB.intents.length; k++) {
      var n = 0;
      for (var w in toks) { if (KB.intents[k]._tokens[w]) n++; }
      if (n > tokScore) { tokScore = n; tokBest = KB.intents[k]; }
    }
    if (tokBest && tokScore >= 2) {
      var r2 = fromIntent(tokBest);
      r2.intent += ' [word-overlap]';
      return r2;
    }

    return {
      text: "I'm not sure about that one, and I'd rather not guess. " + fill(KB.escalation.line),
      card: null, contact: true,
      chips: ['What do you repair?', 'How much does a repair cost?', 'What are your hours?'],
      intent: 'fallback'
    };
  }

  return { respond: respond, fill: fill, norm: norm };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBrain: createBrain };
if (typeof window !== 'undefined') window.createBrain = createBrain;
