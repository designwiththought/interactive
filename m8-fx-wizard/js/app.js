/* app.js — UI: sequencer grid editor, transport, live voice + scope,
 * the description wizard, and the FX reference. Plain DOM, no framework. */
(function (M8) {
  'use strict';
  var notes = M8.notes, fx = M8.fx, wizard = M8.wizard;
  var $ = function (id) { return document.getElementById(id); };

  var audio = new M8.Audio();
  var engine = new M8.Engine(audio);
  var curGrid = 'phrase';
  var rowEls = [];

  // ---------- grid rendering ----------
  var PHRASE_COLS = ['NOTE', 'VEL', 'FX1', 'FX2', 'FX3'];
  var TABLE_COLS = ['N', 'V', 'FX1', 'FX2', 'FX3'];
  var HINTS = {
    phrase: 'Phrase steps (16th notes). NOTE like C-4, VEL + FX as 2 hex digits. FX = 3 letters + value, e.g. ARP47, RET02, PVB32. Runs at the groove\'s speed.',
    table: 'Table rows run per-tick alongside the note (TIC sets the rate). N = transpose, V = volume (×phrase). Same FX columns. This is where you build arps & envelopes.'
  };

  function fxToText(c) { return c ? c.code + notes.hex2(c.value) : ''; }

  function parseFxInput(raw) {
    raw = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) return null;
    var code = raw.slice(0, 3), valStr = raw.slice(3);
    if (!fx.byCode(code)) return undefined; // invalid code -> signal
    var val = valStr === '' ? 0 : notes.parseHex(valStr);
    if (val == null) val = 0;
    return { code: code, value: val };
  }

  function makeCell(klass, value, placeholder, onCommit) {
    var inp = document.createElement('input');
    inp.className = 'cell ' + klass;
    inp.value = value; inp.placeholder = placeholder;
    inp.spellcheck = false; inp.autocomplete = 'off';
    inp.addEventListener('change', function () { onCommit(inp); persist(); });
    inp.addEventListener('blur', function () { onCommit(inp); persist(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
    return inp;
  }

  function renderGrid() {
    var host = $('gridHost'); host.innerHTML = ''; rowEls = [];
    var cols = curGrid === 'phrase' ? PHRASE_COLS : TABLE_COLS;
    var data = curGrid === 'phrase' ? engine.phrase : engine.table;
    var tbl = document.createElement('table'); tbl.className = 'grid';
    var thead = document.createElement('tr');
    thead.appendChild(document.createElement('th'));
    cols.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; thead.appendChild(th); });
    tbl.appendChild(thead);

    for (var i = 0; i < 16; i++) (function (i) {
      var row = data[i];
      var tr = document.createElement('tr'); tr.className = 'row';
      var rn = document.createElement('td'); rn.className = 'rownum'; rn.textContent = notes.hex2(i); tr.appendChild(rn);

      if (curGrid === 'phrase') {
        tr.appendChild(td(makeCell('note', row.note != null ? notes.formatNote(row.note) : '', '---', function (inp) {
          var v = inp.value.trim(); row.note = v === '' ? null : notes.parseNote(v);
          inp.value = row.note != null ? notes.formatNote(row.note) : '';
        })));
        tr.appendChild(td(makeCell('', row.vel != null ? notes.hex2(row.vel) : '', '--', function (inp) {
          var v = notes.parseHex(inp.value); row.vel = v; inp.value = v != null ? notes.hex2(v) : '';
        })));
      } else {
        tr.appendChild(td(makeCell('', row.n != null ? notes.hex2(row.n) : '', '--', function (inp) {
          var v = notes.parseHex(inp.value); row.n = v; inp.value = v != null ? notes.hex2(v) : '';
        })));
        tr.appendChild(td(makeCell('', row.v != null ? notes.hex2(row.v) : '', '--', function (inp) {
          var v = notes.parseHex(inp.value); row.v = v; inp.value = v != null ? notes.hex2(v) : '';
        })));
      }
      for (var c = 0; c < 3; c++) (function (c) {
        tr.appendChild(td(makeCell('fx', fxToText(row.fx[c]), '------', function (inp) {
          var parsed = parseFxInput(inp.value);
          if (parsed === undefined) { inp.value = fxToText(row.fx[c]); flash(inp); return; }
          row.fx[c] = parsed; inp.value = fxToText(parsed);
        })));
      })(c);

      tbl.appendChild(tr); rowEls.push(tr);
    })(i);

    host.appendChild(tbl);
    $('gridHint').textContent = HINTS[curGrid];
  }
  function td(child) { var d = document.createElement('td'); d.appendChild(child); return d; }
  function flash(inp) { inp.style.borderColor = 'var(--accent)'; setTimeout(function () { inp.style.borderColor = ''; }, 350); }

  // ---------- transport ----------
  function setPlaying(on) {
    var b = $('btnPlay');
    b.classList.toggle('playing', on);
    b.textContent = on ? '■ STOP' : '▶ PLAY';
  }
  $('btnPlay').addEventListener('click', function () {
    if (engine.running) { engine.stop(); setPlaying(false); }
    else { audio.ensure(); engine.play(); setPlaying(true); }
  });
  $('bpm').addEventListener('input', function () {
    engine.setBPM(parseInt(this.value, 10)); $('bpmVal').textContent = this.value; persist();
  });
  $('wave').addEventListener('change', function () { audio.setWave(this.value); persist(); });
  $('cutoff').addEventListener('input', function () { audio.setCutoff(parseInt(this.value, 10)); persist(); });
  $('btnClear').addEventListener('click', function () { api.reset(); renderGrid(); persist(); });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active'); curGrid = t.dataset.grid; renderGrid();
    });
  });

  // ---------- live voice + scope ----------
  var trail = []; var TRAIL = 240; var lastSnap = null;
  engine.onUpdate = function (s) {
    lastSnap = s;
    trail.push({ semis: s.semis, level: s.level, alive: s.alive });
    if (trail.length > TRAIL) trail.shift();
  };
  function paintVoice() {
    var s = lastSnap;
    if (s) {
      $('rStep').textContent = s.step >= 0 ? notes.hex2(s.step) : '--';
      $('rTick').textContent = s.tick;
      $('rNote').textContent = s.alive ? s.noteLabel : '---';
      $('rFreq').textContent = (s.freq ? s.freq.toFixed(1) : '---') + ' Hz';
      $('rGroove').textContent = notes.hex2(s.groove);
      $('rTic').textContent = notes.hex2(engine.tableTic);
      $('rScale').textContent = s.scale && M8.scales.list[s.scale.scale]
        ? notes.NAMES[s.scale.key] + ' ' + M8.scales.list[s.scale.scale].name : 'Chromatic';
      $('vNote').textContent = s.alive ? s.noteLabel : '---';
      $('vFreq').textContent = (s.freq ? s.freq.toFixed(1) : '---') + ' Hz';
      $('vLevel').style.width = Math.round((s.level || 0) * 100) + '%';
      $('vBend').textContent = (s.bend || 0).toFixed(2);
      $('vSlide').textContent = s.slide || 0;
      renderChips(s.activeFX || []);
      highlight(s);
    }
    drawScope();
    requestAnimationFrame(paintVoice);
  }
  function renderChips(active) {
    var host = $('vChips');
    var want = active.join(',');
    if (host._cache === want) return; host._cache = want; host.innerHTML = '';
    if (!active.length) { var e = document.createElement('span'); e.className = 'chip'; e.textContent = 'none'; host.appendChild(e); return; }
    active.forEach(function (c) { var el = document.createElement('span'); el.className = 'chip on'; el.textContent = c; host.appendChild(el); });
  }
  var lastHi = -1, lastHiGrid = '';
  function highlight(s) {
    var idx = curGrid === 'phrase' ? s.step : s.tableRow;
    if (idx === lastHi && curGrid === lastHiGrid) return;
    if (rowEls[lastHi] && lastHiGrid === curGrid) rowEls[lastHi].classList.remove('playhead');
    if (rowEls[idx]) rowEls[idx].classList.add('playhead');
    lastHi = idx; lastHiGrid = curGrid;
  }
  function drawScope() {
    var cv = $('scope'), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // midline grid
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath();
    for (var gy = 0; gy <= 4; gy++) { var y = (H / 4) * gy; ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
    if (trail.length < 2) return;
    // pitch range auto-fit
    var min = Infinity, max = -Infinity;
    trail.forEach(function (p) { if (p.semis < min) min = p.semis; if (p.semis > max) max = p.semis; });
    if (!isFinite(min)) return;
    if (max - min < 4) { var mid = (max + min) / 2; min = mid - 2; max = mid + 2; }
    var pad = 8;
    // level (pink, filled)
    ctx.beginPath();
    trail.forEach(function (p, i) {
      var x = (i / (TRAIL - 1)) * W; var y = H - p.level * (H - 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(255,79,154,.55)'; ctx.lineWidth = 1; ctx.stroke();
    // pitch (teal)
    ctx.beginPath();
    trail.forEach(function (p, i) {
      var x = (i / (TRAIL - 1)) * W;
      var norm = (p.semis - min) / (max - min);
      var y = pad + (1 - norm) * (H - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = p_alive() ? '#43e0c8' : '#2c5e57'; ctx.lineWidth = 1.6; ctx.stroke();
  }
  function p_alive() { return lastSnap && lastSnap.alive; }

  // ---------- wizard api ----------
  var api = {
    reset: function () {
      for (var i = 0; i < 16; i++) {
        engine.phrase[i] = { note: null, vel: null, fx: [null, null, null] };
        engine.table[i] = { n: null, v: null, fx: [null, null, null] };
      }
    },
    note: function (s, str, vel) { engine.phrase[s].note = notes.parseNote(str); if (vel != null) engine.phrase[s].vel = vel; },
    pfx: function (s, c, code, val) { engine.phrase[s].fx[c] = { code: code, value: val }; },
    tn: function (r, signed) { engine.table[r].n = signed & 0xff; },
    tv: function (r, vol) { engine.table[r].v = vol & 0xff; },
    tfx: function (r, c, code, val) { engine.table[r].fx[c] = { code: code, value: val }; },
    tableTic: function (v) { engine.setTableTic(v); },
    bpm: function (v) { engine.setBPM(v); $('bpm').value = v; $('bpmVal').textContent = v; },
    groove: function (n) { engine.setGroove(n); }
  };

  function runRecipe(r) {
    var explanation = r.apply(api);
    curGrid = r.grid || 'phrase';
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x.dataset.grid === curGrid); });
    renderGrid();
    $('explain').innerHTML = '<b>' + r.label + '</b> — ' + explanation;
    persist();
  }

  // ---------- patch save / load / share ----------
  function b64encode(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64decode(s) { return decodeURIComponent(escape(atob(s))); }
  function encFx(c) { return c ? [c.code, c.value] : 0; }
  function decFx(a) { return (a && a[0]) ? { code: a[0], value: a[1] | 0 } : null; }

  function encodeState() {
    var o = {
      v: 1, b: engine.bpm, g: engine.grooveNum, t: engine.tableTic, gr: curGrid,
      w: audio.wave, c: audio.cutoff,
      p: engine.phrase.map(function (s) { return [s.note, s.vel, s.fx.map(encFx)]; }),
      T: engine.table.map(function (r) { return [r.n, r.v, r.fx.map(encFx)]; })
    };
    return b64encode(JSON.stringify(o));
  }
  function applyState(o) {
    if (!o || !o.p) return false;
    engine.setBPM(o.b); $('bpm').value = o.b; $('bpmVal').textContent = o.b;
    engine.setGroove(o.g); engine.setTableTic(o.t || 6);
    audio.setWave(o.w || 'sawtooth'); $('wave').value = o.w || 'sawtooth';
    audio.setCutoff(o.c || 5000); $('cutoff').value = o.c || 5000;
    o.p.forEach(function (s, i) { engine.phrase[i] = { note: s[0], vel: s[1], fx: s[2].map(decFx) }; });
    (o.T || []).forEach(function (r, i) { engine.table[i] = { n: r[0], v: r[1], fx: r[2].map(decFx) }; });
    if (o.gr) { curGrid = o.gr; document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x.dataset.grid === curGrid); }); }
    return true;
  }
  function decodeState(str) { try { return JSON.parse(b64decode(str)); } catch (e) { return null; } }

  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem('m8fx_patch', encodeState()); } catch (e) { }
    }, 250);
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, 2200);
  }
  function copyText(txt, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast(ok); }, function () { toast('copy failed — here it is in the console'); console.log(txt); });
    } else { console.log(txt); toast('copied to console'); }
  }
  $('btnShare').addEventListener('click', function () {
    var hash = '#patch=' + encodeState();
    try { history.replaceState(null, '', hash); } catch (e) { location.hash = hash; }
    copyText(location.href, 'share link copied to clipboard');
  });
  $('btnCopy').addEventListener('click', function () { copyText(encodeState(), 'patch code copied'); });
  $('btnReset').addEventListener('click', function () { runRecipe(wizard.byId('arp-major')); toast('loaded demo patch'); });

  function renderRecipeList(list) {
    var host = $('recipeList'); host.innerHTML = '';
    var groups = {};
    list.forEach(function (r) { (groups[r.group] = groups[r.group] || []).push(r); });
    Object.keys(groups).forEach(function (g) {
      var h = document.createElement('div'); h.className = 'recipe-group'; h.textContent = g; host.appendChild(h);
      groups[g].forEach(function (r) {
        var b = document.createElement('button'); b.className = 'recipe'; b.textContent = r.label;
        b.addEventListener('click', function () { runRecipe(r); });
        host.appendChild(b);
      });
    });
  }
  $('wizGo').addEventListener('click', doSearch);
  $('wizText').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
  function doSearch() {
    var q = $('wizText').value;
    var hits = wizard.search(q);
    if (!hits.length) { renderRecipeList(wizard.recipes); $('explain').textContent = 'No match for "' + q + '". Showing everything — pick one.'; return; }
    renderRecipeList(hits);
    runRecipe(hits[0]);
  }

  // ---------- FX reference ----------
  function renderFxRef() {
    var host = $('fxref'); host.innerHTML = '';
    fx.list.forEach(function (d) {
      var el = document.createElement('div'); el.className = 'fxitem';
      var h = document.createElement('div'); h.className = 'h';
      var dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = 'var(--cat-' + d.cat + ')';
      var code = document.createElement('span'); code.className = 'code'; code.textContent = d.code; code.style.color = 'var(--cat-' + d.cat + ')';
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = d.name;
      h.appendChild(dot); h.appendChild(code); h.appendChild(nm); el.appendChild(h);
      var xy = document.createElement('div'); xy.className = 'xy'; xy.textContent = d.xy; el.appendChild(xy);
      var man = document.createElement('div'); man.className = 'man'; man.textContent = d.manual; el.appendChild(man);
      var tags = document.createElement('div'); tags.className = 'tagrow';
      var sim = document.createElement('span'); sim.className = 'tag sim-' + d.sim; sim.textContent = d.sim; tags.appendChild(sim);
      var conf = document.createElement('span'); conf.className = 'tag'; conf.textContent = d.confidence; tags.appendChild(conf);
      el.appendChild(tags);
      host.appendChild(el);
    });
  }

  // ---------- boot ----------
  renderFxRef();
  renderRecipeList(wizard.recipes);
  var loaded = false;
  var m = /[#&]patch=([^&]+)/.exec(location.hash);   // shared link wins
  if (m) loaded = applyState(decodeState(m[1]));
  if (!loaded) {                                      // then last local session
    var saved = null; try { saved = localStorage.getItem('m8fx_patch'); } catch (e) { }
    if (saved) loaded = applyState(decodeState(saved));
  }
  if (loaded) { renderGrid(); $('explain').textContent = 'Loaded your patch. Hit play, or describe a new effect above.'; }
  else { runRecipe(wizard.byId('arp-major')); }       // first-timer demo
  renderGrid();
  requestAnimationFrame(paintVoice);
})(window.M8 = window.M8 || {});
