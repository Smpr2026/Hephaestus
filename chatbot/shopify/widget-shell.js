/*
 * The floating chat widget - the customer-facing face of the bot.
 * Injected on every storefront page. Fully self-contained: markup and CSS
 * are created here, so one set of script tags is all a theme needs.
 * Reuses the same knowledge base + brain as the test page.
 */
(function(){
  "use strict";
  if (window.__SMPRW) return;
  window.__SMPRW = true;
  var KB = window.SMPR_KB || null;
  if (!KB || !KB.intents || !window.createBrain) return;

  var BRAIN = createBrain(KB);
  var B = KB.business, P = KB.persona || {};

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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

  /* ---------- styles ---------- */
  var css = ''
  + ':host{all:initial;display:block;--w-accent:#0A4FA0;--w-accent2:#1668C7;--w-ink:#16202B;--w-ink2:#5A6878;--w-bg:#FFFFFF;--w-bg2:#F2F5F9;--w-line:#DFE5EC;--w-good:#22C55E;--w-warn:#F59E0B;'
  + 'position:fixed;z-index:2147483000;bottom:0;right:0}'
  + '@media (prefers-color-scheme:dark){:host{--w-ink:#E8EEF5;--w-ink2:#9FAEBE;--w-bg:#141C26;--w-bg2:#1B2531;--w-line:#2A3644;--w-accent:#2F73C9;--w-accent2:#4E92E8}}'
  // theme !important rules can still hit the host from outside and inherit
  // through; this wrapper is unreachable by page selectors, so all:initial
  // here cuts every inherited property dead (custom properties still pass)
  + '.sw-wrap{all:initial;display:block;font:400 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--w-ink);-webkit-font-smoothing:antialiased}'
  + '*{box-sizing:border-box;margin:0;padding:0}'
  + 'button{font:inherit;cursor:pointer;border:0;background:none;color:inherit}'

  /* launcher */
  + '.sw-launch{position:fixed;bottom:22px;right:22px;width:60px;height:60px;border-radius:50%;'
  + 'background:linear-gradient(135deg,var(--w-accent),var(--w-accent2));color:#fff;display:flex;align-items:center;justify-content:center;'
  + 'box-shadow:0 6px 24px rgba(10,79,160,.38);transition:transform .18s ease,box-shadow .18s ease}'
  + '.sw-launch:hover{transform:scale(1.07)}'
  + '.sw-launch svg{width:28px;height:28px;transition:transform .25s ease}'
  + '.sw-launch.open svg.sw-i-chat{display:none}.sw-launch:not(.open) svg.sw-i-x{display:none}'
  + '.sw-ring{position:absolute;inset:0;border-radius:50%;border:2px solid var(--w-accent2);opacity:0;animation:swring 2.4s ease-out 3}'
  + '@keyframes swring{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.65);opacity:0}}'
  + '.sw-badge{position:absolute;top:-2px;right:-2px;min-width:19px;height:19px;border-radius:10px;background:#E44;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;box-shadow:0 1px 4px rgba(0,0,0,.3)}'

  /* teaser */
  + '.sw-tease{position:fixed;bottom:96px;right:22px;max-width:290px;background:var(--w-bg);border:1px solid var(--w-line);border-radius:14px 14px 4px 14px;'
  + 'box-shadow:0 10px 34px rgba(16,26,38,.18);padding:12px 34px 12px 14px;display:flex;gap:10px;align-items:flex-start;cursor:pointer;'
  + 'animation:swup .35s ease}'
  + '.sw-tease .sw-av{width:34px;height:34px;font-size:14px;flex:none}'
  + '.sw-tease p{font-size:13.5px;line-height:1.45}'
  + '.sw-tease em{display:block;font-style:normal;font-weight:600;font-size:12px;color:var(--w-ink2);margin-bottom:2px}'
  + '.sw-tease .sw-tx{position:absolute;top:6px;right:8px;color:var(--w-ink2);font-size:15px;line-height:1;padding:3px}'

  /* panel */
  + '.sw-panel{position:fixed;bottom:96px;right:22px;width:378px;max-width:calc(100vw - 24px);height:min(636px,calc(100vh - 120px));'
  + 'background:var(--w-bg);border:1px solid var(--w-line);border-radius:18px;box-shadow:0 24px 70px rgba(16,26,38,.28);'
  + 'display:flex;flex-direction:column;overflow:hidden;animation:swup .3s ease}'
  + '@keyframes swup{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}'
  + '@media (max-width:520px){.sw-panel{bottom:0;right:0;width:100vw;max-width:none;height:100dvh;border-radius:0;border:0}}'

  /* header */
  + '.sw-head{background:linear-gradient(135deg,var(--w-accent),var(--w-accent2));color:#fff;padding:16px 18px;display:flex;gap:12px;align-items:center;flex:none}'
  + '.sw-av{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;color:#fff}'
  + '.sw-who b{display:block;font-size:15.5px;font-weight:600}'
  + '.sw-who span{display:flex;align-items:center;gap:6px;font-size:12.5px;opacity:.92}'
  + '.sw-dot{width:8px;height:8px;border-radius:50%;background:var(--w-good);box-shadow:0 0 0 3px rgba(255,255,255,.25);flex:none}'
  + '.sw-dot.away{background:var(--w-warn)}'
  + '.sw-close{margin-left:auto;color:#fff;opacity:.85;padding:6px;border-radius:8px}'
  + '.sw-close:hover{opacity:1;background:rgba(255,255,255,.14)}'
  + '.sw-sub{background:var(--w-bg2);border-bottom:1px solid var(--w-line);color:var(--w-ink2);font-size:12px;text-align:center;padding:6px 12px;flex:none}'

  /* log */
  + '.sw-log{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px;background:var(--w-bg)}'
  + '.sw-row{display:flex}.sw-row.me{justify-content:flex-end}'
  + '.sw-bub{max-width:86%;padding:10px 13px;border-radius:16px;font-size:14.5px;white-space:pre-wrap;word-wrap:break-word}'
  + '.sw-row.bot .sw-bub{background:var(--w-bg2);border:1px solid var(--w-line);border-bottom-left-radius:5px}'
  + '.sw-row.me .sw-bub{background:linear-gradient(135deg,var(--w-accent),var(--w-accent2));color:#fff;border-bottom-right-radius:5px}'
  + '.sw-typing{display:inline-flex;gap:4px;padding:12px 14px}'
  + '.sw-typing i{width:7px;height:7px;border-radius:50%;background:var(--w-ink2);opacity:.5;animation:swb 1.2s infinite}'
  + '.sw-typing i:nth-child(2){animation-delay:.15s}.sw-typing i:nth-child(3){animation-delay:.3s}'
  + '@keyframes swb{0%,60%,100%{transform:none;opacity:.45}30%{transform:translateY(-4px);opacity:1}}'

  /* price card */
  + '.sw-card{margin-top:9px;background:var(--w-bg);border:1px solid var(--w-line);border-radius:11px;overflow:hidden;font-size:13.5px}'
  + '.sw-card-h{padding:8px 11px;font-weight:600;border-bottom:1px solid var(--w-line);background:var(--w-bg2)}'
  + '.sw-card-r{display:flex;justify-content:space-between;gap:10px;padding:7px 11px;border-bottom:1px solid var(--w-line)}'
  + '.sw-card-r em{display:block;font-style:normal;font-size:12px;color:var(--w-ink2)}'
  + '.sw-card-r b{white-space:nowrap}'
  + '.sw-card-n{padding:7px 11px;font-size:12px;color:var(--w-ink2)}'

  /* products */
  + '.sw-prods{margin-top:9px;display:flex;flex-direction:column;gap:8px}'
  + '.sw-prod{display:flex;gap:10px;align-items:center;background:var(--w-bg);border:1px solid var(--w-line);border-radius:11px;padding:8px;text-decoration:none;color:inherit}'
  + '.sw-prod:hover{border-color:var(--w-accent)}'
  + '.sw-pic{width:52px;height:52px;border-radius:9px;background:var(--w-bg2);display:flex;align-items:center;justify-content:center;font-size:22px;flex:none;overflow:hidden;position:relative}'
  + '.sw-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
  + '.sw-pt{flex:1;min-width:0;font-size:13.5px;font-weight:500;line-height:1.35}'
  + '.sw-pm{display:block;font-size:12px;color:var(--w-ink2);font-weight:400}'
  + '.sw-ps{display:block;font-size:11.5px;color:var(--w-good);font-weight:600}'
  + '.sw-ps.low{color:var(--w-warn)}.sw-ps.out{color:#D33}'
  + '.sw-pp{font-weight:700;white-space:nowrap}'
  + '.sw-cart{align-self:flex-end;font-size:12.5px;font-weight:600;color:var(--w-accent);text-decoration:none;border:1px solid var(--w-accent);border-radius:8px;padding:4px 10px;margin-top:-2px}'
  + '.sw-cart:hover{background:var(--w-accent);color:#fff}'

  /* options / chips / contact */
  + '.sw-opts{margin-top:9px;display:flex;flex-wrap:wrap;gap:6px}'
  + '.sw-opt{border:1px solid var(--w-accent);color:var(--w-accent);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:500}'
  + '.sw-opt:hover{background:var(--w-accent);color:#fff}'
  + '.sw-contact{margin-top:9px;display:flex;flex-direction:column;gap:6px}'
  + '.sw-contact a{display:block;text-align:center;font-size:13.5px;font-weight:600;text-decoration:none;border-radius:9px;padding:8px 10px}'
  + '.sw-call{background:var(--w-accent);color:#fff}'
  + '.sw-map{border:1px solid var(--w-line);color:var(--w-ink)}'
  + '.sw-chips{padding:0 14px 8px;display:flex;flex-wrap:wrap;gap:6px;flex:none;background:var(--w-bg)}'
  + '.sw-chip{border:1px solid var(--w-line);background:var(--w-bg2);border-radius:999px;padding:6px 12px;font-size:12.5px;color:var(--w-ink2)}'
  + '.sw-chip:hover{border-color:var(--w-accent);color:var(--w-accent)}'

  /* footer */
  + '.sw-foot{border-top:1px solid var(--w-line);padding:10px 12px;display:flex;gap:8px;align-items:flex-end;flex:none;background:var(--w-bg)}'
  + '.sw-in{flex:1;resize:none;border:1px solid var(--w-line);border-radius:12px;background:var(--w-bg2);color:var(--w-ink);padding:9px 12px;font:inherit;font-size:14px;max-height:92px;outline:none}'
  + '.sw-in:focus{border-color:var(--w-accent)}'
  + '.sw-send{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--w-accent),var(--w-accent2));color:#fff;display:flex;align-items:center;justify-content:center;flex:none}'
  + '.sw-send:hover{filter:brightness(1.1)}'
  + '.sw-note{font-size:10.5px;color:var(--w-ink2);text-align:center;padding:0 10px 8px;background:var(--w-bg);flex:none}';

  // The whole widget lives in a shadow root: theme stylesheets cannot cross
  // the boundary, so no Dawn (or any theme) rule can ever reshape the pills,
  // send button or input again. The inline style on the host pins its
  // geometry even against theme rules that target #smprw itself, and
  // all:initial severs every inherited property at the boundary.
  var host = document.createElement('div');
  host.id = 'smprw';
  host.style.cssText = 'all:initial;display:block;position:fixed;bottom:0;right:0;z-index:2147483000';
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  /* ---------- markup ---------- */
  var CHAT_SVG = '<svg class="sw-i-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var X_SVG = '<svg class="sw-i-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var SEND_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

  var root = document.createElement('div');
  root.className = 'sw-wrap';
  root.innerHTML =
    '<button class="sw-launch" type="button" aria-label="Chat with us">' +
      '<span class="sw-ring"></span>' + CHAT_SVG + X_SVG +
      '<span class="sw-badge" style="display:none">1</span>' +
    '</button>';
  shadow.appendChild(root);

  var launch = root.querySelector('.sw-launch');
  var badge = root.querySelector('.sw-badge');
  var panel = null, log = null, chipsEl = null, input = null;

  function store(k, v){ try{ sessionStorage.setItem('smprw.'+k, v); }catch(e){} }
  function read(k){ try{ return sessionStorage.getItem('smprw.'+k); }catch(e){ return null; } }

  function buildPanel(){
    panel = document.createElement('div');
    panel.className = 'sw-panel';
    panel.innerHTML =
      '<div class="sw-head">' +
        '<span class="sw-av">' + esc(P.initials || 'S') + '</span>' +
        '<span class="sw-who"><b>' + esc(P.name || B.name) + '</b>' +
        '<span><i class="sw-dot' + (IS_OPEN ? '' : ' away') + '"></i>' +
        esc((P.role ? P.role + ' · ' : '') + (IS_OPEN ? (P.openHoursStatus || 'Online now') : (P.closedStatus || 'Away'))) +
        '</span></span>' +
        '<button class="sw-close" type="button" aria-label="Close chat">' + X_SVG.replace('sw-i-x','') + '</button>' +
      '</div>' +
      '<div class="sw-sub">' + esc(B.name) + ' · usually replies in a few minutes</div>' +
      '<div class="sw-log"></div>' +
      '<div class="sw-chips"></div>' +
      '<div class="sw-foot">' +
        '<textarea class="sw-in" rows="1" placeholder="Type a message..."></textarea>' +
        '<button class="sw-send" type="button" aria-label="Send">' + SEND_SVG + '</button>' +
      '</div>' +
      '<div class="sw-note">Prices are a guide — confirmed in store</div>';
    root.appendChild(panel);
    log = panel.querySelector('.sw-log');
    chipsEl = panel.querySelector('.sw-chips');
    input = panel.querySelector('.sw-in');

    panel.querySelector('.sw-close').addEventListener('click', toggle);
    panel.querySelector('.sw-send').addEventListener('click', function(){ ask(input.value); });
    input.addEventListener('keydown', function(e){
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ask(input.value); }
    });
    input.addEventListener('input', function(){
      input.style.height = 'auto';
      input.style.height = Math.min(92, input.scrollHeight) + 'px';
    });
    // one delegated listener so restored history keeps working
    log.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('.sw-opt') : null;
      if (b) ask(b.getAttribute('data-q'));
    });
    chipsEl.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('.sw-chip') : null;
      if (b) ask(b.textContent);
    });

    var savedLog = read('log'), savedChips = read('chips');
    if (savedLog){
      log.innerHTML = savedLog;
      chipsEl.innerHTML = savedChips || '';
      scroll();
    } else {
      var greeting = KB.intents.filter(function(i){ return i.id === 'greeting'; })[0];
      addBot({ text: BRAIN.fill(greeting.answer), chips: greeting.chips });
    }
  }

  function persist(){
    if (!log) return;
    if (log.innerHTML.length < 250000){ store('log', log.innerHTML); store('chips', chipsEl.innerHTML); }
  }

  function toggle(){
    var open = panel && panel.style.display !== 'none';
    if (!panel) buildPanel();
    else panel.style.display = open ? 'none' : '';
    launch.classList.toggle('open', !open);
    badge.style.display = 'none';
    hideTease();
    store('open', open ? '' : '1');
    if (!open && input) setTimeout(function(){ try{ input.focus(); }catch(e){} }, 150);
  }
  launch.addEventListener('click', toggle);

  /* ---------- teaser ---------- */
  var tease = null;
  function hideTease(){ if (tease){ tease.remove(); tease = null; store('teased','1'); } }
  function showTease(){
    if (read('teased') || (panel && panel.style.display !== 'none')) return;
    tease = document.createElement('div');
    tease.className = 'sw-tease';
    tease.innerHTML =
      '<span class="sw-av" style="background:linear-gradient(135deg,var(--w-accent),var(--w-accent2));border:0">' + esc(P.initials || 'S') + '</span>' +
      '<p><em>' + esc(P.name || B.name) + '</em>' +
      "G'day 👋 need a hand with a repair or finding something?</p>" +
      '<button class="sw-tx" type="button" aria-label="Dismiss">×</button>';
    tease.addEventListener('click', function(e){
      if (e.target.className === 'sw-tx'){ hideTease(); return; }
      hideTease(); if (!panel || panel.style.display === 'none') toggle();
    });
    root.appendChild(tease);
    badge.style.display = '';
  }
  setTimeout(showTease, 5000);

  /* ---------- rendering (same contract as the test page) ---------- */
  function scroll(){ if (log) log.scrollTop = log.scrollHeight; }

  function addUser(t){
    var d = document.createElement('div');
    d.className = 'sw-row me';
    d.innerHTML = '<div class="sw-bub">' + esc(t) + '</div>';
    log.appendChild(d); scroll(); persist();
  }

  function addBot(res){
    var html = '<div class="sw-bub">' + esc(res.text);
    if(res.card){
      html += '<div class="sw-card"><div class="sw-card-h">' + esc(res.card.title) + '</div>';
      res.card.rows.forEach(function(r){
        var num = String(r[1]).charAt(0) === '$';
        html += '<div class="sw-card-r"><span>' + esc(r[0]) +
                (r[2] ? '<em>' + esc(r[2]) + '</em>' : '') + '</span>' +
                (num ? '<b>' + esc(r[1]) + '</b>' : '<span>' + esc(r[1]) + '</span>') + '</div>';
      });
      html += '<div class="sw-card-n">' + esc(res.card.note) + '</div></div>';
    }
    if(res.products && res.products.length){
      var KIND_ICON = { earbuds:'🎧', headphones:'🎧', speaker:'🔊',
        'power bank':'🔋', charger:'🔌', cable:'🔌',
        protector:'🛡️', 'case':'📱', phone:'📱' };
      html += '<div class="sw-prods">';
      res.products.forEach(function(p){
        var cls = p.stock > 3 ? '' : (p.stock > 0 ? ' low' : ' out');
        var label = p.stock > 3 ? 'In stock' : (p.stock > 0 ? 'Only ' + p.stock + ' left' : 'Out of stock');
        var meta = [p.cond, p.colour ? p.colour.charAt(0).toUpperCase() + p.colour.slice(1) : null]
          .filter(Boolean).join(' · ');
        var icon = KIND_ICON[p.kind] || '🛍️';
        var pic = '<span class="sw-pic">' + icon +
                  (p.img ? '<img src="' + esc(p.img) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
        html += '<a class="sw-prod" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + pic +
                '<span class="sw-pt">' + esc(p.title) +
                (meta ? '<span class="sw-pm">' + esc(meta) + '</span>' : '') +
                '<span class="sw-ps' + cls + '">' + label + '</span></span>' +
                '<span class="sw-pp">$' + esc(p.price) + '</span></a>' +
                (p.cart && p.stock > 0
                  ? '<a class="sw-cart" href="' + esc(p.cart) + '" target="_blank" rel="noopener">Add to cart</a>' : '');
      });
      html += '</div>';
    }
    if(res.options && res.options.length){
      html += '<div class="sw-opts">';
      res.options.forEach(function(o){
        html += '<button class="sw-opt" type="button" data-q="' + esc(o.q) + '">' + esc(o.label) + '</button>';
      });
      html += '</div>';
    }
    if(res.contact){
      html += '<div class="sw-contact">' +
        '<a class="sw-call" href="tel:' + esc(B.phoneDial) + '">Call ' + esc(B.phone) + '</a>' +
        '<a class="sw-map" href="' + esc(B.mapsUrl) + '" target="_blank" rel="noopener">' + esc(B.addressShort) + '</a>' +
        '</div>';
    }
    var d = document.createElement('div');
    d.className = 'sw-row bot';
    d.innerHTML = html + '</div>';
    log.appendChild(d);

    chipsEl.innerHTML = '';
    (res.chips || []).forEach(function(c){
      var b = document.createElement('button');
      b.className = 'sw-chip'; b.type = 'button'; b.textContent = c;
      chipsEl.appendChild(b);
    });
    scroll(); persist();
  }

  function typingRow(){
    var d = document.createElement('div');
    d.className = 'sw-row bot';
    d.innerHTML = '<div class="sw-bub" style="padding:0;background:none;border:0"><span class="sw-typing" style="background:var(--w-bg2);border:1px solid var(--w-line);border-radius:16px;border-bottom-left-radius:5px"><i></i><i></i><i></i></span></div>';
    log.appendChild(d); scroll();
    return d;
  }

  /* ---------- pacing ---------- */
  function split(text){
    if(text.length < 150) return [text];
    for(var i = Math.floor(text.length * 0.3); i < text.length - 30; i++){
      if(/[.!?]/.test(text[i]) && text[i+1] === ' ') return [text.slice(0,i+1).trim(), text.slice(i+1).trim()];
    }
    return [text];
  }
  var PACE = {
    read: P.readPauseMs || 900,
    perChar: P.typePerCharMs || 30,
    min: P.minTypeMs || 1300,
    max: P.maxTypeMs || 4500,
    between: P.betweenBubblesMs || 500
  };
  function typeTime(t){ return Math.max(PACE.min, Math.min(PACE.max, t.length * PACE.perChar)); }
  function thinkingLine(){
    var lines = P.thinkingLines || [];
    if (!lines.length) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  var busy = false, lastAsked = '';
  function ask(text){
    text = String(text || '').trim();
    if(!text || busy || !log) return;
    busy = true;
    lastAsked = text;
    addUser(text);
    chipsEl.innerHTML = '';
    input.value = ''; input.style.height = 'auto';
    resolveAnswer(text).then(function(res){ deliver(res); });
  }

  /* ---------- live store search (same origin, no token) ---------- */
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
            return BRAIN.productAnswer(parsed, withIds);
          });
        })
        .catch(function(){ return BRAIN.respond(text); });
    }
    return Promise.resolve(BRAIN.respond(text));
  }

  function deliver(res){
    var text = lastAsked;
    var parts = split(res.text);
    var stall = res.card ? thinkingLine() : null;
    if (stall) parts.unshift(stall);
    if(!IS_OPEN && !read('afterHours') && P.closedPrefix){
      parts[0] = P.closedPrefix + parts[0].charAt(0).toLowerCase() + parts[0].slice(1);
      store('afterHours','1');
    }
    var step = 0;
    function next(){
      if(step >= parts.length){ busy = false; return; }
      var last = step === parts.length - 1, body = parts[step], t = typingRow();
      setTimeout(function(){
        t.remove();
        addBot({ text: body, card: last ? res.card : null, products: last ? res.products : null,
                 contact: last ? res.contact : false, options: last ? res.options : null,
                 chips: last ? res.chips : [] });
        step++;
        setTimeout(next, last ? 0 : PACE.between);
      }, typeTime(body));
    }
    setTimeout(next, PACE.read + Math.min(1600, (text||'').length * 18));
  }

  /* restore open state across page navigation */
  if (read('open')){ toggle(); }
})();
