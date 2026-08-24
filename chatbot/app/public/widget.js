/*
 * SMPR chat widget — the embeddable piece.
 *
 * Drop it on any page with one tag:
 *   <script src="/widget.js" data-api="/api"></script>
 *
 * That single tag is exactly what the Shopify theme app extension renders, so
 * what you test locally is what ships.
 *
 * The widget holds no answers and no API key — it posts to /api/chat and
 * renders what comes back.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var API = (script && script.getAttribute('data-api')) || '/api';
  var FAST = /[?&]fast/.test(location.search);   // collapses pauses for tests
  var SPEED = FAST ? 0.04 : 1;

  var cfg = null, history = [], busy = false, afterHoursShown = false, panel, log, chips, input, launcher;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function scroll() { log.scrollTop = log.scrollHeight; }

  /* ---------- is the shop open right now, Sydney time ---------- */
  function shopOpen() {
    try {
      var f = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Sydney', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false
      });
      var parts = {};
      f.formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
      var today = cfg.business.hours.filter(function (d) { return d.day === parts.weekday; })[0];
      if (!today || !today.open) return false;
      function toMins(s) {
        var m = /^(\d+):(\d+)(am|pm)$/.exec(s.toLowerCase());
        if (!m) return null;
        return (parseInt(m[1], 10) % 12 + (m[3] === 'pm' ? 12 : 0)) * 60 + parseInt(m[2], 10);
      }
      var now = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
      var o = toMins(today.open), c = toMins(today.close);
      return o != null && c != null && now >= o && now < c;
    } catch (e) { return true; }
  }

  /* ---------- markup ---------- */
  function build() {
    var p = cfg.persona || {}, b = cfg.business;
    var open = shopOpen();

    launcher = el('button', 'smpr-launcher');
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
      'Chat with us<span class="smpr-dot"></span>';

    panel = el('div', 'smpr-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with ' + (p.name || b.name));
    panel.innerHTML =
      '<div class="smpr-head">' +
        '<div class="smpr-avatar">' + esc(p.initials || 'S') + '</div>' +
        '<div><h3>' + esc(p.name || b.name) + '</h3>' +
        '<p><span class="smpr-online"' + (open ? '' : ' style="background:#F5A623"') + '></span>' +
        esc((p.role ? p.role + ' · ' : '') + (open ? (p.openHoursStatus || 'Online now') : (p.closedStatus || 'Away'))) +
        '</p></div>' +
        '<button class="smpr-x" aria-label="Close chat">&times;</button>' +
      '</div>' +
      '<div class="smpr-log"></div>' +
      '<div class="smpr-chips"></div>' +
      '<div class="smpr-foot"><div class="smpr-inputrow">' +
        '<textarea rows="1" placeholder="Type a message…"></textarea>' +
        '<button class="smpr-send" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
      '</div><p class="smpr-note">Prices are a guide — confirmed in store</p></div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    log = panel.querySelector('.smpr-log');
    chips = panel.querySelector('.smpr-chips');
    input = panel.querySelector('textarea');

    launcher.addEventListener('click', open_);
    panel.querySelector('.smpr-x').addEventListener('click', close_);
    panel.querySelector('.smpr-send').addEventListener('click', function () { ask(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(96, input.scrollHeight) + 'px';
    });

    window.SMPR_WIDGET = { open: open_, close: close_, ask: ask };
  }

  /* ---------- rendering ---------- */
  function addUser(text) {
    var row = el('div', 'smpr-row smpr-me', '<div class="smpr-bub">' + esc(text) + '</div>');
    log.appendChild(row); scroll();
  }

  function addBot(res) {
    var b = cfg.business;
    var html = '<div class="smpr-bub">' + esc(res.text);

    if (res.card) {
      html += '<div class="smpr-card"><div class="smpr-card-h">' + esc(res.card.title) + '</div>';
      res.card.rows.forEach(function (r) {
        var isNum = String(r[1]).charAt(0) === '$';
        html += '<div class="smpr-card-row"><span>' + esc(r[0]) + '</span>' +
          (isNum ? '<b>' + esc(r[1]) + '</b>' : '<span class="smpr-muted">' + esc(r[1]) + '</span>') + '</div>';
      });
      html += '<div class="smpr-card-note">' + esc(res.card.note) + '</div></div>';
    }

    if (res.contact) {
      html += '<div class="smpr-contact">' +
        '<a class="smpr-btn smpr-btn-call" href="tel:' + esc(b.phoneDial) + '">📞 Call ' + esc(b.phone) + '</a>' +
        '<a class="smpr-btn smpr-btn-map" href="' + esc(b.mapsUrl) + '" target="_blank" rel="noopener">📍 ' + esc(b.addressShort) + '</a>' +
        '</div>';
    }

    log.appendChild(el('div', 'smpr-row smpr-bot', html + '</div>'));

    chips.innerHTML = '';
    (res.chips || []).forEach(function (c) {
      var btn = el('button', 'smpr-chip');
      btn.type = 'button'; btn.textContent = c;
      btn.addEventListener('click', function () { ask(c); });
      chips.appendChild(btn);
    });
    scroll();
  }

  function showTyping() {
    var row = el('div', 'smpr-row smpr-bot', '<div class="smpr-bub" style="padding:0"><div class="smpr-typing"><i></i><i></i><i></i></div></div>');
    log.appendChild(row); scroll();
    return row;
  }

  // a person sends a line, then another - not one long paragraph
  function splitAnswer(text) {
    if (text.length < 150) return [text];
    for (var i = Math.floor(text.length * 0.3); i < text.length - 30; i++) {
      if (/[.!?]/.test(text[i]) && text[i + 1] === ' ') {
        return [text.slice(0, i + 1).trim(), text.slice(i + 1).trim()];
      }
    }
    return [text];
  }

  function typeTime(text) {
    return Math.max(650, Math.min(2600, text.length * 22)) * SPEED;
  }

  /* ---------- the conversation ---------- */
  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true;
    addUser(text);
    chips.innerHTML = '';
    input.value = ''; input.style.height = 'auto';

    var reading = showTyping();

    fetch(API + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: history })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: res.text });
        if (history.length > 20) history = history.slice(-20);
        deliver(reading, res);
      })
      .catch(function () {
        reading.remove();
        addBot({
          text: "Sorry — I dropped out there. Give the shop a ring on " + cfg.business.phone + " and they'll sort you out.",
          contact: true, chips: []
        });
        busy = false;
      });
  }

  function deliver(readingRow, res) {
    var parts = splitAnswer(res.text);

    if (!shopOpen() && !afterHoursShown && cfg.persona && cfg.persona.closedPrefix) {
      parts[0] = cfg.persona.closedPrefix + parts[0].charAt(0).toLowerCase() + parts[0].slice(1);
      afterHoursShown = true;
    }

    readingRow.remove();
    var step = 0;
    (function next() {
      if (step >= parts.length) { busy = false; return; }
      var isLast = step === parts.length - 1;
      var body = parts[step];
      var t = showTyping();
      setTimeout(function () {
        t.remove();
        addBot({
          text: body,
          card: isLast ? res.card : null,
          contact: isLast ? res.contact : false,
          chips: isLast ? res.chips : []
        });
        step++;
        setTimeout(next, isLast ? 0 : 260 * SPEED);
      }, typeTime(body));
    })();
  }

  function open_() {
    panel.classList.add('smpr-open');
    launcher.hidden = true;
    if (!log.children.length) {
      addBot({ text: cfg.greeting, chips: cfg.greetingChips });
    }
    setTimeout(function () { input.focus(); }, 120);
  }
  function close_() {
    panel.classList.remove('smpr-open');
    launcher.hidden = false;
  }

  /* ---------- boot ---------- */
  function boot() {
    fetch(API + '/config')
      .then(function (r) { return r.json(); })
      .then(function (c) { cfg = c; build(); })
      .catch(function (e) { console.error('[smpr] could not load chat config', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
