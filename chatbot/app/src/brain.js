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

  function respond(raw) {
    var t = norm(raw);

    var ref = refusalCheck(t);
    if (ref) return ref;

    // Shopping comes first when the words name something we sell - "screen
    // protector" must not be answered as a screen repair.
    var override = PRODUCT_OVERRIDE.some(function (w) { return t.indexOf(' ' + w) !== -1; });
    var shopQ = parseProductQuery(raw);
    if (shopQ && override) return productAnswer(shopQ);

    var model = detectModel(t);
    var repair = detectRepair(t);
    if (model && (repair || looksLikePrice(t))) return priceAnswer(model, repair || 'screen');
    if (shopQ) return productAnswer(shopQ);
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

  /* ---------- the shop: find the thing, show the price, say if it's here ---- */

  var SHOP_WORDS = ['case','cover','charger','cable','protector','tempered','power bank','powerbank',
    'headphone','headphones','earbud','earbuds','earphone','earphones','airpod','airpods','speaker',
    'accessory','accessories','buy','sell','price of','do you have','do you sell','in stock','stock',
    'looking for','got any','after a'];

  var BRANDS = ['bose','beats','sony','anker','baseus','samsung','apple','jbl','cygnett','romoss',
    'acefast','uag','iquick','efm','kogan','sennheiser','skullcandy','logitech'];

  // A repair beats a product, except when the words name a thing we sell:
  // "screen protector" is a product, "screen replacement" is a repair.
  var PRODUCT_OVERRIDE = ['protector','case','cover','charger','cable','power bank','powerbank',
    'headphone','earbud','earphone','airpod','speaker'];

  function catalogueItems() {
    return (KB.catalogue && KB.catalogue.items) || [];
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
    ['phone',     /handset|iphone \d|galaxy s\d|pre.?loved|refurbished/i]
  ];

  function kindOf(item) {
    var hay = item.t + ' ' + (item.c || '');
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i][1].test(hay)) return KINDS[i][0];
    }
    return null;
  }

  function kindInQuery(t) {
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i][1].test(t)) return KINDS[i][0];
    }
    return null;
  }

  function scoreItem(item, terms) {
    var hay = (item.t + ' ' + (item.c || '')).toLowerCase();
    var n = 0;
    for (var i = 0; i < terms.length; i++) {
      if (hay.indexOf(terms[i]) !== -1) n++;
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
    var t = norm(raw);
    var brand = null;
    for (var i = 0; i < BRANDS.length; i++) {
      if (t.indexOf(' ' + BRANDS[i]) !== -1) { brand = BRANDS[i]; break; }
    }
    var shopping = false;
    for (var j = 0; j < SHOP_WORDS.length; j++) {
      if (t.indexOf(' ' + SHOP_WORDS[j]) !== -1) { shopping = true; break; }
    }
    if (!brand && !shopping) return null;

    // a repair question that happens to name a brand is not a shopping question
    if (!shopping && detectRepair(t) && detectModel(t)) return null;

    var terms = t.trim().split(' ').filter(function (w) {
      return w.length >= 3 && !STOP[w] && ['how','much','you','the','for','have','got','sell','buy',
        'any','are','can','want','need','looking','after','does','with'].indexOf(w) === -1;
    });
    return { terms: terms, brand: brand, kind: kindInQuery(t), shopping: shopping };
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

  function productAnswer(parsed, items) {
    // A brand with no kind is a question, not an answer - ask which, the way
    // someone behind the counter would, and offer the kinds actually in stock.
    if (parsed.brand && !parsed.kind) {
      var cats = categoriesFor(parsed.brand);
      if (cats.length > 1) {
        var nice = parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1);
        return {
          text: nice + ' — what are you after? We\u2019ve got ' + cats.join(' and ') + ' in at the moment.',
          card: null, contact: false, products: null,
          chips: cats.slice(0, 3).map(function (c) { return nice + ' ' + c; }),
          intent: 'shop:clarify:' + parsed.brand
        };
      }
    }

    var found = items || searchCatalogue(parsed.terms, null,
      { brand: parsed.brand, kind: parsed.kind });

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

    return {
      text: lead,
      card: null,
      contact: false,
      products: top.map(function (item) {
        return {
          title: item.t,
          price: item.p,
          stock: item.s,
          url: (KB.catalogue.productUrl || '') + item.h
        };
      }),
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

  // prices comes from anywhere - a price list, or aggregated repair tickets.
  //   list form:   {aftermarket, genuine}
  //   ticket form: {low, high, typical, sampleSize, since}
  // Null values render as "call to confirm". The bot still never invents a
  // number, and never quotes a ticket average off a handful of jobs.
  var MIN_TICKETS = 3;

  function ticketCard(model, repair, p) {
    var label = model + ' ' + (repair === 'screen' ? 'screen replacement' : 'battery replacement');
    var art = /^[aeiou]/i.test(model) ? 'an ' : 'a ';
    var range = (p.low != null && p.high != null && p.low !== p.high)
      ? '$' + p.low + '–$' + p.high
      : '$' + (p.typical != null ? p.typical : p.low);
    var rows = [['Recent jobs', range]];
    if (p.typical != null) rows.push(['Most common', '$' + p.typical]);
    rows.push(['Time in store', turnaround(model, repair)]);
    rows.push(['Based on', p.sampleSize + ' job' + (p.sampleSize === 1 ? '' : 's') +
                            (p.since ? ' since ' + p.since : '')]);
    return {
      text: 'Most ' + model + ' ' + (repair === 'screen' ? 'screen' : 'battery') +
            ' jobs have come in around ' + range + ' — it depends on the part you go with.',
      card: {
        title: label,
        rows: rows,
        note: 'That’s what we’ve actually charged recently, not a fixed price. ' +
              fill(KB.pricing.disclaimerShort) + ' Every repair includes the ' + B.warranty + '.'
      },
      contact: false,
      chips: ['Genuine or aftermarket?', 'Do I need a booking?', 'Where are you?'],
      intent: 'price:' + model + ':' + repair + ' (tickets, n=' + p.sampleSize + ')'
    };
  }

  function priceCard(model, repair, prices) {
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
            (repair === 'screen' ? 'screen' : 'battery') +
            ' replacement — usually done in under an hour while you wait.',
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
    parseProductQuery: parseProductQuery, productAnswer: productAnswer, searchCatalogue: searchCatalogue
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBrain: createBrain };
if (typeof window !== 'undefined') window.createBrain = createBrain;
