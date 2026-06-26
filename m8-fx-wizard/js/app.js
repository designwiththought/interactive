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
  var chordSpace = { reverb: 0x30, delay: 0x00 };

  // ---------- drag-a-value-to-hear-it ----------
  // Vertical drag on any numeric element nudges its value live; a plain click
  // still focuses/types. Shift = coarse (±16).
  function attachScrub(el, get, set, opts) {
    opts = opts || {}; var min = opts.min == null ? 0 : opts.min, max = opts.max == null ? 255 : opts.max;
    el.classList.add('scrub');
    var dragging = false, startY = 0, startV = 0, moved = false;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      startY = e.clientY; startV = get() | 0; moved = false; dragging = true;
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dy = startY - e.clientY;
      if (!moved && Math.abs(dy) < 3) return;
      if (!moved) { moved = true; if (el.blur) el.blur(); el.classList.add('scrubbing'); }
      e.preventDefault();
      var v = startV + Math.round(dy / 3) * (e.shiftKey ? 16 : 1);
      set(Math.max(min, Math.min(max, v)));
    });
    function end() { if (!dragging) return; dragging = false; el.classList.remove('scrubbing'); if (moved) persist(); }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

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
    if (curGrid === 'chords') { renderChords(); return; }
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

      // helper: build a cell, attach scrub, append
      function add(klass, val, ph, commit, get, scrubSet, opts) {
        var inp = makeCell(klass, val, ph, commit);
        if (get) attachScrub(inp, get, function (v) { scrubSet(v, inp); }, opts);
        tr.appendChild(td(inp));
        return inp;
      }

      if (curGrid === 'phrase') {
        add('note', row.note != null ? notes.formatNote(row.note) : '', '---',
          function (inp) { var v = inp.value.trim(); row.note = v === '' ? null : notes.parseNote(v); inp.value = row.note != null ? notes.formatNote(row.note) : ''; },
          function () { return row.note != null ? row.note : 60; },
          function (v, inp) { row.note = v; inp.value = notes.formatNote(v); }, { min: 24, max: 108 });
        add('', row.vel != null ? notes.hex2(row.vel) : '', '--',
          function (inp) { var v = notes.parseHex(inp.value); row.vel = v; inp.value = v != null ? notes.hex2(v) : ''; },
          function () { return row.vel != null ? row.vel : 0; },
          function (v, inp) { row.vel = v; inp.value = notes.hex2(v); });
      } else {
        add('', row.n != null ? notes.hex2(row.n) : '', '--',
          function (inp) { var v = notes.parseHex(inp.value); row.n = v; inp.value = v != null ? notes.hex2(v) : ''; },
          function () { return row.n != null ? row.n : 0; },
          function (v, inp) { row.n = v; inp.value = notes.hex2(v); });
        add('', row.v != null ? notes.hex2(row.v) : '', '--',
          function (inp) { var v = notes.parseHex(inp.value); row.v = v; inp.value = v != null ? notes.hex2(v) : ''; },
          function () { return row.v != null ? row.v : 0; },
          function (v, inp) { row.v = v; inp.value = notes.hex2(v); });
      }
      for (var c = 0; c < 3; c++) (function (c) {
        add('fx', fxToText(row.fx[c]), '------',
          function (inp) { var p = parseFxInput(inp.value); if (p === undefined) { inp.value = fxToText(row.fx[c]); flash(inp); return; } row.fx[c] = p; inp.value = fxToText(p); },
          function () { return row.fx[c] ? row.fx[c].value : 0; },
          function (v, inp) { if (!row.fx[c]) return; row.fx[c].value = v & 0xff; inp.value = fxToText(row.fx[c]); });
      })(c);

      tbl.appendChild(tr); rowEls.push(tr);
    })(i);

    host.appendChild(tbl);
    $('gridHint').textContent = HINTS[curGrid];
  }

  // ---------- Chord Lab ----------
  function selControl(label, options, current, onChange) {
    var w = document.createElement('div'); w.className = 'ctl';
    var l = document.createElement('label'); l.textContent = label; w.appendChild(l);
    var s = document.createElement('select');
    options.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; if (String(o[0]) === String(current)) op.selected = true; s.appendChild(op); });
    s.addEventListener('change', function () { onChange(s.value); });
    w.appendChild(s); return w;
  }
  function rangeControl(label, min, max, val, onChange) {
    var w = document.createElement('div'); w.className = 'ctl';
    var l = document.createElement('label'); l.textContent = label; w.appendChild(l);
    var r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.value = val;
    var b = document.createElement('b'); b.className = 'ctlval'; b.textContent = val;
    r.addEventListener('input', function () { b.textContent = r.value; onChange(parseInt(r.value, 10)); });
    w.appendChild(r); w.appendChild(b); return w;
  }
  function toggleControl(label, on, onChange) {
    var w = document.createElement('div'); w.className = 'ctl';
    var l = document.createElement('label'); l.textContent = label; w.appendChild(l);
    var b = document.createElement('button'); b.className = 'toggle' + (on ? ' on' : ''); b.textContent = on ? 'on' : 'off';
    b.addEventListener('click', function () { on = !on; b.classList.toggle('on', on); b.textContent = on ? 'on' : 'off'; onChange(on); });
    w.appendChild(b); return w;
  }
  var selShape = 0;   // which bank shape is being edited
  function bank() { return engine.chord.shapes; }
  function clampSel() { if (selShape >= bank().length) selShape = bank().length - 1; if (selShape < 0) selShape = 0; }
  function ensureShape(quality) {
    var s = bank(); for (var i = 0; i < s.length; i++) if (s[i].name === quality) return i;
    if (s.length >= 16) return 0;                 // Hypersynth holds 16 banks max
    s.push({ name: quality, voices: M8.chords.shapeVoices(M8.chords.QUALITIES[quality] || [0, 4, 7]) });
    return s.length - 1;
  }
  function genProg(name) {
    var prog = M8.chords.generateProgression(name, engine.chord.key, 3);
    engine.chord.scale = M8.chords.PROGRESSIONS[name].mode;
    engine.chordSeq = prog.map(function (c) { return { pc: c.pc, oct: c.oct, shape: ensureShape(c.quality) }; });
    renderChords(); persist();
  }
  function genRandom() {
    var k = engine.chord.key, mode = engine.chord.scale, seq = [];
    for (var i = 0; i < 4; i++) { var deg = i === 0 ? 1 : 1 + Math.floor(engine.rng() * 7); var c = M8.chords.diatonic(k, mode, deg, false); seq.push({ pc: c.pc, oct: 3, shape: ensureShape(c.quality) }); }
    engine.chordSeq = seq; renderChords(); persist();
  }

  function voiceChip(v, i) {
    var chip = document.createElement('div'); chip.className = 'hs-voice' + (v.on ? ' on' : '');
    var lbl = document.createElement('span'); lbl.className = 'hsv-n'; lbl.textContent = 'V' + (i + 1);
    var off = document.createElement('div'); off.className = 'hsv-off'; off.textContent = (v.off >= 0 ? '+' : '') + v.off;
    attachScrub(off, function () { return v.off; }, function (n) { v.off = n; off.textContent = (n >= 0 ? '+' : '') + n; }, { min: -24, max: 24 });
    chip.appendChild(lbl); chip.appendChild(off);
    chip.addEventListener('click', function (e) { if (e.target === off) return; v.on = !v.on; chip.classList.toggle('on', v.on); persist(); });
    return chip;
  }
  function shapeChip(shape, i) {
    var chip = document.createElement('div'); chip.className = 'shape-chip' + (i === selShape ? ' sel' : '');
    var nm = document.createElement('span'); nm.className = 'sc-name'; nm.textContent = shape.name; chip.appendChild(nm);
    chip.addEventListener('click', function () { selShape = i; renderChords(); });
    if (bank().length > 1) {
      var x = document.createElement('button'); x.className = 'sc-del'; x.textContent = '×';
      x.addEventListener('click', function (e) {
        e.stopPropagation(); bank().splice(i, 1);
        engine.chordSeq.forEach(function (s) { if (s.shape >= i && s.shape > 0) s.shape--; });
        clampSel(); renderChords(); persist();
      });
      chip.appendChild(x);
    }
    return chip;
  }
  function rootCard(slot, i) {
    var card = document.createElement('div'); card.className = 'chord-card';
    var root = document.createElement('div'); root.className = 'c-root'; root.textContent = notes.NAMES[slot.pc] + slot.oct;
    attachScrub(root, function () { return (slot.oct + 1) * 12 + slot.pc; }, function (v) {
      slot.oct = Math.floor(v / 12) - 1; slot.pc = ((v % 12) + 12) % 12; root.textContent = notes.NAMES[slot.pc] + slot.oct;
    }, { min: 24, max: 96 });
    var shp = document.createElement('button'); shp.className = 'c-shape';
    shp.textContent = (bank()[slot.shape] || bank()[0]).name;
    shp.title = 'click to shift shape';
    shp.addEventListener('click', function () { slot.shape = (slot.shape + 1) % bank().length; shp.textContent = bank()[slot.shape].name; persist(); });
    var del = document.createElement('button'); del.className = 'c-del'; del.textContent = '×';
    del.addEventListener('click', function () { engine.chordSeq.splice(i, 1); renderChords(); persist(); });
    card.appendChild(root); card.appendChild(shp); card.appendChild(del);
    return card;
  }

  function renderChords() {
    clampSel();
    var host = $('gridHost'); host.innerHTML = ''; rowEls = [];
    $('gridHint').textContent = 'Chord Lab — the M8 Hypersynth holds 16 chord banks of up to 6 intervals. You define the banks here, then sequence chord changes by selecting which bank is active (the CHORD parameter / its instrument FX) — that is the M8-native way, not the MIDI-only CHD command. Drag any value to hear it live.';
    var lab = document.createElement('div'); lab.className = 'chordlab';

    // Hypersynth: the 16 chord banks
    var hs = document.createElement('div'); hs.className = 'hs';
    var head = document.createElement('div'); head.className = 'hs-head';
    head.innerHTML = '<b>HYPERSYNTH</b> — 16 chord banks of up to 6 intervals (' + bank().length + '/16 defined). Pick a bank to edit; click a voice to toggle it; drag its number to change the offset. The sequencer <i>shifts</i> the active bank per step.';
    hs.appendChild(head);

    // shape bank row
    var bankRow = document.createElement('div'); bankRow.className = 'shape-bank';
    bank().forEach(function (s, i) { bankRow.appendChild(shapeChip(s, i)); });
    if (bank().length < 16) {
      var preset = selControl('+ from preset', [['', '+ add…']].concat(M8.chords.ORDER.map(function (q) { return [q, q]; })), '', function (v) {
        if (!v) return; var idx = ensureShape(v); selShape = idx; renderChords(); persist();
      });
      preset.classList.add('addshape'); bankRow.appendChild(preset);
    }
    hs.appendChild(bankRow);

    // selected shape: name + voices
    var sel = bank()[selShape];
    var nameRow = document.createElement('div'); nameRow.className = 'hs-namerow';
    var nlab = document.createElement('label'); nlab.textContent = 'Editing shape'; nameRow.appendChild(nlab);
    var nin = document.createElement('input'); nin.className = 'shape-name'; nin.value = sel.name; nin.spellcheck = false;
    nin.addEventListener('change', function () { sel.name = nin.value.trim() || sel.name; renderChords(); persist(); });
    nameRow.appendChild(nin);
    hs.appendChild(nameRow);

    var voices = document.createElement('div'); voices.className = 'hs-voices';
    sel.voices.forEach(function (v, i) { voices.appendChild(voiceChip(v, i)); });
    hs.appendChild(voices);

    var shaperow = document.createElement('div'); shaperow.className = 'chord-controls';
    shaperow.appendChild(rangeControl('Swarm', 0, 255, engine.chord.swarm, function (v) { engine.chord.swarm = v; persist(); }));
    shaperow.appendChild(rangeControl('Shift', 0, 255, engine.chord.shift, function (v) { engine.chord.shift = v; persist(); }));
    shaperow.appendChild(rangeControl('Sub osc', 0, 255, engine.chord.subosc, function (v) { engine.chord.subosc = v; persist(); }));
    shaperow.appendChild(toggleControl('Diatonic snap', engine.chord.diatonic, function (on) { engine.chord.diatonic = on; persist(); }));
    shaperow.appendChild(selControl('Key', notes.NAMES.map(function (n, i) { return [i, n]; }), engine.chord.key, function (v) { engine.chord.key = +v; persist(); }));
    shaperow.appendChild(selControl('Scale', [['major', 'major'], ['minor', 'minor']], engine.chord.scale, function (v) { engine.chord.scale = v; persist(); }));
    hs.appendChild(shaperow);
    lab.appendChild(hs);

    // generators
    var gen = document.createElement('div'); gen.className = 'gen-row';
    Object.keys(M8.chords.PROGRESSIONS).forEach(function (k) {
      var b = document.createElement('button'); b.className = 'gen'; b.textContent = M8.chords.PROGRESSIONS[k].name;
      b.addEventListener('click', function () { genProg(k); }); gen.appendChild(b);
    });
    var rb = document.createElement('button'); rb.className = 'gen'; rb.textContent = 'Random diatonic';
    rb.addEventListener('click', genRandom); gen.appendChild(rb);
    lab.appendChild(gen);

    // play controls
    var ctr = document.createElement('div'); ctr.className = 'chord-controls';
    ctr.appendChild(selControl('Style', [['block', 'block'], ['up', 'arp up'], ['down', 'arp down'], ['updown', 'arp up-down'], ['strum', 'strum'], ['random', 'random']], engine.chord.style, function (v) { engine.chord.style = v; persist(); }));
    ctr.appendChild(rangeControl('Rate', 1, 12, engine.chord.rate, function (v) { engine.chord.rate = v; persist(); }));
    ctr.appendChild(rangeControl('Gate', 1, 16, engine.chord.gateSteps, function (v) { engine.chord.gateSteps = v; persist(); }));
    ctr.appendChild(rangeControl('Bar len', 4, 32, engine.chord.slotSteps, function (v) { engine.chord.slotSteps = v; persist(); }));
    ctr.appendChild(rangeControl('Reverb', 0, 255, chordSpace.reverb, function (v) { chordSpace.reverb = v; audio.setReverbReturn(v); persist(); }));
    ctr.appendChild(rangeControl('Delay', 0, 255, chordSpace.delay, function (v) { chordSpace.delay = v; audio.setDelayReturn(v); persist(); }));
    lab.appendChild(ctr);

    // root + shape sequence
    var srow = document.createElement('div'); srow.className = 'strip-label'; srow.textContent = 'SEQUENCE — each step is a root note + which shape to shift to (loops one bar each)';
    lab.appendChild(srow);
    var strip = document.createElement('div'); strip.className = 'chord-strip';
    engine.chordSeq.forEach(function (slot, i) { strip.appendChild(rootCard(slot, i)); });
    var addb = document.createElement('button'); addb.className = 'chord-add'; addb.textContent = '+';
    addb.addEventListener('click', function () { engine.chordSeq.push({ pc: 0, oct: 3, shape: selShape }); renderChords(); persist(); });
    strip.appendChild(addb);
    lab.appendChild(strip);

    host.appendChild(lab);
    rowEls = Array.prototype.slice.call(strip.querySelectorAll('.chord-card'));
  }
  function td(child) { var d = document.createElement('td'); d.appendChild(child); return d; }
  function flash(inp) { inp.style.borderColor = 'var(--accent)'; setTimeout(function () { inp.style.borderColor = ''; }, 350); }

  // ---------- transport ----------
  function setPlaying(on) {
    var b = $('btnPlay');
    b.classList.toggle('playing', on);
    b.textContent = on ? '■ STOP' : '▶ PLAY';
  }
  function startPlay() {
    audio.ensure();
    engine.setMode(curGrid === 'chords' ? 'chords' : 'track');
    engine.play();
    if (curGrid === 'chords') { audio.setReverbReturn(chordSpace.reverb); audio.setDelayReturn(chordSpace.delay); }
    setPlaying(true);
  }
  $('btnPlay').addEventListener('click', function () {
    if (engine.running) { engine.stop(); setPlaying(false); }
    else { startPlay(); }
  });
  $('bpm').addEventListener('input', function () {
    engine.setBPM(parseInt(this.value, 10)); $('bpmVal').textContent = this.value; persist();
  });
  $('wave').addEventListener('change', function () { audio.setWave(this.value); persist(); });
  $('cutoff').addEventListener('input', function () { audio.setCutoff(parseInt(this.value, 10)); persist(); });
  $('btnClear').addEventListener('click', function () { api.reset(); renderGrid(); persist(); });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (engine.running) { engine.stop(); setPlaying(false); }   // mode follows the active tab
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active'); curGrid = t.dataset.grid; renderGrid(); persist();
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
      if (s.mode === 'chords') renderChips(s.poly ? [s.poly + ' voices'] : []);
      else renderChips(s.activeFX || []);
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
    var idx = curGrid === 'chords' ? s.cSlot : (curGrid === 'phrase' ? s.step : s.tableRow);
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
    ctx.strokeStyle = 'rgba(150,160,172,.45)'; ctx.lineWidth = 1; ctx.stroke();
    // pitch (teal)
    ctx.beginPath();
    trail.forEach(function (p, i) {
      var x = (i / (TRAIL - 1)) * W;
      var norm = (p.semis - min) / (max - min);
      var y = pad + (1 - norm) * (H - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = p_alive() ? '#8fb0a6' : '#4a5a55'; ctx.lineWidth = 1.6; ctx.stroke();
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
      T: engine.table.map(function (r) { return [r.n, r.v, r.fx.map(encFx)]; }),
      ch: engine.chord, cs: engine.chordSeq, sp: chordSpace, ss: selShape
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
    if (o.ch) engine.chord = o.ch;
    if (o.cs) engine.chordSeq = o.cs;
    if (o.sp) chordSpace = o.sp;
    if (o.ss != null) selShape = o.ss;
    // migrate older patches that predate the shape bank / Hypersynth params
    if (!engine.chord.shapes) engine.chord.shapes = M8.chords.defaultBank();
    if (engine.chord.shift == null) engine.chord.shift = 0x80;
    if (engine.chord.subosc == null) engine.chord.subosc = 0;
    engine.chordSeq.forEach(function (s) { if (s.shape == null) s.shape = 0; if (s.quality != null) delete s.quality; });
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
