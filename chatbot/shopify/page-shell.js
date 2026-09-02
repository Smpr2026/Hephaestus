(function(){
  "use strict";
  var KB = window.SMPR_KB || null;
  if(!KB || !KB.intents){ document.body.innerHTML = '<p style="padding:40px">Knowledge base missing — run build.sh.</p>'; return; }

  var BRAIN = createBrain(KB);
  var B = KB.business, P = KB.persona || {};

  var log = document.getElementById('log');
  var chips = document.getElementById('chips');
  var input = document.getElementById('input');
  var showTag = document.getElementById('showTag');

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function scroll(){ log.scrollTop = log.scrollHeight; }

  /* presence, on real Sydney time */
  function shopOpen(){
    try{
      var parts = {};
      new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',weekday:'long',hour:'2-digit',minute:'2-digit',hour12:false})
        .formatToParts(new Date()).forEach(function(p){ parts[p.type] = p.value; });
      var today = B.hours.filter(function(d){ return d.day === parts.weekday; })[0];
      if(!today || !today.open) return false;
      function m(s){ var x=/^(\d+):(\d+)(am|pm)$/.exec(s.toLowerCase()); return x ? (parseInt(x[1],10)%12 + (x[3]==='pm'?12:0))*60 + parseInt(x[2],10) : null; }
      var now = parseInt(parts.hour,10)*60 + parseInt(parts.minute,10), o = m(today.open), c = m(today.close);
      return o!=null && c!=null && now>=o && now<c;
    } catch(e){ return true; }
  }
  var IS_OPEN = shopOpen();

  document.getElementById('who').textContent = P.name || B.name;
  if (P.avatarUrl) {
    var _av = document.getElementById('avatar');
    _av.textContent = '';
    _av.style.overflow = 'hidden';
    var _img = document.createElement('img');
    _img.src = P.avatarUrl; _img.alt = '';
    _img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:50% 22%;border-radius:50%';
    _av.appendChild(_img);
  } else {
    document.getElementById('avatar').textContent = P.initials || 'S';
  }
  document.getElementById('presence').textContent =
    (P.role ? P.role + ' · ' : '') + (IS_OPEN ? (P.openHoursStatus || 'Online now') : (P.closedStatus || 'Away'));
  if(!IS_OPEN) document.getElementById('live').style.background = 'var(--signal)';

  /* stats */
  var topics = {}; KB.intents.forEach(function(i){ topics[i.category] = 1; });
  var filled = KB.pricing.repairs.filter(function(r){ return (r.costs && Object.keys(r.costs).length) || r.sampleSize >= 3; }).length;
  document.getElementById('stats').innerHTML =
    '<div class="stat"><b>' + KB.intents.length + '</b><span>Answers</span></div>' +
    '<div class="stat"><b>' + Object.keys(topics).length + '</b><span>Topics</span></div>' +
    '<div class="stat' + (filled < KB.pricing.repairs.length ? ' flagged' : '') + '"><b>' + filled + '/' + KB.pricing.repairs.length + '</b><span>Prices filled</span></div>' +
    '<div class="stat"><b>' + KB.refusals.length + '</b><span>Refusals</span></div>';

  /* rendering */
  function addUser(t){
    var d = document.createElement('div');
    d.className = 'row me';
    d.innerHTML = '<div class="bub">' + esc(t) + '</div>';
    log.appendChild(d); scroll();
  }

  function addBot(res){
    var html = '<div class="bub">' + esc(res.text);
    if(res.card){
      html += '<div class="pricecard"><div class="pc-h">' + esc(res.card.title) + '</div>';
      res.card.rows.forEach(function(r){
        var num = String(r[1]).charAt(0) === '$';
        html += '<div class="pc-row"><span>' + esc(r[0]) +
                (r[2] ? '<em class="pc-blurb">' + esc(r[2]) + '</em>' : '') + '</span>' +
                (num ? '<b>' + esc(r[1]) + '</b>' : '<span class="none">' + esc(r[1]) + '</span>') + '</div>';
      });
      html += '<div class="pc-note">' + esc(res.card.note) + '</div></div>';
    }

    if(res.products && res.products.length){
      var KIND_ICON = { earbuds:'\uD83C\uDFA7', headphones:'\uD83C\uDFA7', speaker:'\uD83D\uDD0A',
        'power bank':'\uD83D\uDD0B', charger:'\uD83D\uDD0C', cable:'\uD83D\uDD0C',
        protector:'\uD83D\uDEE1\uFE0F', 'case':'\uD83D\uDCF1', phone:'\uD83D\uDCF1' };
      html += '<div class="products">';
      res.products.forEach(function(p){
        var cls = p.stock > 3 ? '' : (p.stock > 0 ? ' low' : ' out');
        var label = p.stock > 3 ? 'In stock' : (p.stock > 0 ? 'Only ' + p.stock + ' left' : 'Out of stock');
        var meta = [p.cond, p.colour ? p.colour.charAt(0).toUpperCase() + p.colour.slice(1) : null]
          .filter(Boolean).join(' \u00B7 ');
        var icon = KIND_ICON[p.kind] || '\uD83D\uDECD\uFE0F';
        // the photo swaps to the icon tile if it can't load (the Claude test
        // panel blocks outside images; the real site shows the photo)
        var pic = '<span class="prod-pic">' + icon +
                  (p.img ? '<img src="' + esc(p.img) + '" alt="" loading="lazy" ' +
                           'onerror="this.remove()">' : '') + '</span>';
        html += '<div class="prod-wrap">' +
                '<a class="prod" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + pic +
                '<span class="prod-t">' + esc(p.title) +
                (meta ? '<span class="prod-m">' + esc(meta) + '</span>' : '') +
                '<span class="prod-s' + cls + '">' + label + '</span></span>' +
                '<span class="prod-p">$' + esc(p.price) + '</span></a>' +
                (p.cart && p.stock > 0
                  ? '<a class="prod-cart" href="' + esc(p.cart) + '" target="_blank" rel="noopener">Add to cart</a>'
                  : '') +
                '</div>';
      });
      html += '</div>';
    }
    if(res.options && res.options.length){
      html += '<div class="opts">';
      res.options.forEach(function(o){
        html += '<button class="optbtn" type="button" data-q="' + esc(o.q) + '">' + esc(o.label) + '</button>';
      });
      html += '</div>';
    }
    if(res.links && res.links.length){
      html += '<div class="contact">';
      res.links.forEach(function(l){
        html += '<a class="c-call" href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
      });
      html += '</div>';
    }
    if(res.contact){
      html += '<div class="contact">' +
        '<a class="c-call" href="tel:' + esc(B.phoneDial) + '">Call ' + esc(B.phone) + '</a>' +
        '<a class="c-map" href="' + esc(B.mapsUrl) + '" target="_blank" rel="noopener">' + esc(B.addressShort) + '</a>' +
        '</div>';
    }
    var d = document.createElement('div');
    d.className = 'row bot';
    d.innerHTML = html + '</div>';
    log.appendChild(d);
    Array.prototype.forEach.call(d.querySelectorAll('.optbtn'), function(b){
      b.addEventListener('click', function(){ ask(b.getAttribute('data-q')); });
    });

    if(showTag.checked && res.intent){
      var t = document.createElement('div');
      t.className = 'tag';
      t.textContent = '↳ ' + res.intent;
      log.appendChild(t);
    }

    chips.innerHTML = '';
    (res.chips || []).forEach(function(c){
      var b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = c;
      b.addEventListener('click', function(){ ask(c); });
      chips.appendChild(b);
    });
    scroll();
  }

  function typingRow(){
    var d = document.createElement('div');
    d.className = 'row bot';
    d.innerHTML = '<div class="bub" style="padding:0"><div class="typing"><i></i><i></i><i></i></div></div>';
    log.appendChild(d); scroll();
    return d;
  }

  /* a person sends a line, then another */
  function split(text){
    if(text.length < 150) return [text];
    for(var i = Math.floor(text.length * 0.3); i < text.length - 30; i++){
      if(/[.!?]/.test(text[i]) && text[i+1] === ' ') return [text.slice(0,i+1).trim(), text.slice(i+1).trim()];
    }
    return [text];
  }
  // Pace comes from the knowledge base so it can be tuned without touching code.
  var PACE = {
    read: P.readPauseMs || 900,
    perChar: P.typePerCharMs || 30,
    min: P.minTypeMs || 1300,
    max: P.maxTypeMs || 4500,
    between: P.betweenBubblesMs || 500
  };
  function typeTime(t){ return Math.max(PACE.min, Math.min(PACE.max, t.length * PACE.perChar)); }

  // Looking a price up takes a person a moment, so say so first.
  function thinkingLine(){
    var lines = P.thinkingLines || [];
    if (!lines.length) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  var busy = false, afterHours = false, lastAsked = '';
  function ask(text){
    text = String(text || '').trim();
    if(!text || busy) return;
    busy = true;
    lastAsked = text;
    addUser(text);
    chips.innerHTML = '';
    input.value = ''; input.style.height = 'auto';

    resolveAnswer(text).then(function(res){ deliver(res); });
  }

  /* live product search against the storefront itself - same origin, no token */
  function liveSearch(parsed){
    var q = parsed.terms.slice(0,6).join(' ');
    var url = '/search/suggest.json?q=' + encodeURIComponent(q) +
              '&resources[type]=product&resources[limit]=10';
    return fetch(url).then(function(r){ return r.json(); }).then(function(j){
      var prods = (((j||{}).resources||{}).results||{}).products || [];
      return prods.map(function(p){
        return {
          t: p.title,
          h: (p.url||'').split('?')[0].split('/').pop(),
          c: '',
          p: parseFloat(p.price) || 0,
          s: p.available === false ? 0 : 9,
          img: p.image || p.featured_image || null
        };
      });
    });
  }

  function withCartIds(items){
    return Promise.all(items.map(function(it){
      return fetch('/products/' + it.h + '.js').then(function(r){ return r.json(); })
        .then(function(p){
          var v = (p.variants||[])[0];
          if (v) it.v = String(v.id);
          if (p.images && p.images[0] && !it.img) it.img = p.images[0];
          return it;
        }).catch(function(){ return it; });
    }));
  }

  function timeout(ms){ return new Promise(function(_, rej){ setTimeout(rej, ms); }); }

  function resolveAnswer(text){
    var parsed = BRAIN.parseProductQuery(text);
    if (parsed){
      return Promise.race([liveSearch(parsed), timeout(3000)])
        .then(function(items){
          if (!items || !items.length) return BRAIN.respond(text);
          var ranked = BRAIN.searchCatalogue(parsed.terms, items,
            { brand: parsed.brand, kind: parsed.kind, colour: parsed.colour });
          if (!ranked.length) ranked = items;
          return withCartIds(ranked.slice(0, 6)).then(function(withIds){
            var res = BRAIN.productAnswer(parsed, withIds);
            res.intent = (res.intent||'') + ' [live store]';
            return res;
          });
        })
        .catch(function(){ return BRAIN.respond(text); });
    }
    return Promise.resolve(BRAIN.respond(text));
  }

  function deliver(res){
    var text = lastAsked;
    var parts = split(res.text);
    // a price means a lookup - stall the way someone checking a list would
    var stall = res.card ? thinkingLine() : null;
    if (stall) parts.unshift(stall);
    if(!IS_OPEN && !afterHours && P.closedPrefix){
      parts[0] = P.closedPrefix + parts[0].charAt(0).toLowerCase() + parts[0].slice(1);
      afterHours = true;
    }

    var step = 0;
    function next(){
      if(step >= parts.length){ busy = false; return; }
      var last = step === parts.length - 1, body = parts[step], t = typingRow();
      setTimeout(function(){
        t.remove();
        addBot({ text: body, card: last ? res.card : null, products: last ? res.products : null,
                 contact: last ? res.contact : false, options: last ? res.options : null,
                 chips: last ? res.chips : [], intent: last ? res.intent : null });
        step++;
        setTimeout(next, last ? 0 : PACE.between);
      }, typeTime(body));
    }
    setTimeout(next, PACE.read + Math.min(1600, (text||'').length * 18));
  }

  document.getElementById('send').addEventListener('click', function(){ ask(input.value); });
  input.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ask(input.value); }
  });
  input.addEventListener('input', function(){
    input.style.height = 'auto';
    input.style.height = Math.min(92, input.scrollHeight) + 'px';
  });

  /* question bank */
  var bank = KB.testBank || [], active = 'All';
  var cats = ['All'].concat(Object.keys(bank.reduce(function(a,q){ a[q.c] = 1; return a; }, {})));
  var filters = document.getElementById('filters'), list = document.getElementById('bank'), count = document.getElementById('qcount');

  function renderBank(){
    var items = bank.filter(function(q){ return active === 'All' || q.c === active; });
    count.textContent = items.length + ' questions';
    list.innerHTML = '';
    items.forEach(function(q){
      var b = document.createElement('button');
      b.className = 'qitem'; b.type = 'button';
      b.innerHTML = '<em>' + esc(q.c) + '</em>' + esc(q.q);
      b.addEventListener('click', function(){ ask(q.q); });
      list.appendChild(b);
    });
  }
  cats.forEach(function(c){
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = c;
    b.setAttribute('aria-pressed', c === 'All' ? 'true' : 'false');
    b.addEventListener('click', function(){
      active = c;
      Array.prototype.forEach.call(filters.children, function(x){ x.setAttribute('aria-pressed','false'); });
      b.setAttribute('aria-pressed','true');
      renderBank();
    });
    filters.appendChild(b);
  });
  renderBank();

  /* open with the greeting */
  var greeting = KB.intents.filter(function(i){ return i.id === 'greeting'; })[0];
  addBot({ text: BRAIN.fill(greeting.answer), chips: greeting.chips, intent: null });
})();

