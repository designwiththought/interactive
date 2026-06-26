/* engine.js — the M8-style tick sequencer.
 *
 * Timing model (from the manual, Groove View): 24 PPQN. A phrase row is a 16th
 * note = 6 ticks by default. Tick duration = 60 / (BPM * 24) seconds. Tables run
 * at their own TIC rate, independent of groove. One monophonic voice.
 */
(function (M8) {
  'use strict';
  var notes = M8.notes, fx = M8.fx;

  // A few built-in grooves (ticks-per-step arrays). Editable / extensible.
  var GROOVES = {
    0x00: [6, 6],                 // straight
    0x01: [7, 5],                 // light swing
    0x02: [8, 4],                 // heavy swing
    0x03: [9, 3],                 // extreme swing
    0x04: [8, 8, 8],              // triplet feel
    0x05: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 0, 0, 0, 0] // 3/4 (skip last 4)
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Engine(audio) {
    this.audio = audio;
    this.bpm = 120;
    this.grooveNum = 0x00;
    this.groove = GROOVES[0x00];
    this.tableTic = 6;          // default ticks per table row
    this.tableEnabled = true;
    this.phrase = blankPhrase();
    this.table = blankTable();
    this.onUpdate = null;       // UI snapshot callback
    this.running = false;
    this._raf = null;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    // ---- chord mode (models the M8 Hypersynth: the chord shape is defined as
    //      voice offsets in the instrument; the sequencer triggers root notes) ----
    this.mode = 'track';        // 'track' (phrase+table) | 'chords'
    this.chord = {
      style: 'block', rate: 3, gateSteps: 14, slotSteps: 16,
      swarm: 0, shift: 0x80, subosc: 0, width: 0,   // Hypersynth params (SWARM/SHIFT/SUBOSC/WIDTH)
      diatonic: false, key: 0, scale: 'major',
      shapes: (M8.chords ? M8.chords.defaultBank() : [])   // the 16 Hypersynth chord banks
    };
    this.instrument = 'mono';   // phrase voice: 'mono' synth | 'hyper' (Hypersynth chords)
    this.curBank = 0;           // active Hypersynth chord bank (driven by the HSC FX)
    // default sequence: a pop progression, each step pointing at the matching shape
    var prog = M8.chords ? M8.chords.generateProgression('pop', 0, 3) : [];
    var self = this;
    this.chordSeq = prog.map(function (c) { return { pc: c.pc, oct: c.oct, shape: self._shapeIndexByName(c.quality) }; });
    this.cRootPc = 0;
    this._resetState();
  }

  function blankPhrase() {
    var a = [];
    for (var i = 0; i < 16; i++) a.push({ note: null, vel: null, fx: [null, null, null] });
    return a;
  }
  function blankTable() {
    var a = [];
    for (var i = 0; i < 16; i++) a.push({ n: null, v: null, fx: [null, null, null] });
    return a;
  }

  Engine.prototype._resetState = function () {
    this.tickCount = 0;
    this.curStep = -1;
    this.stepTicksLeft = 0;
    this.jumpTarget = null;
    this.loopCount = 0;
    this.tableRow = -1;
    this.tableAcc = 0;
    this.tableFracRow = 0;
    this.pending = null;        // DEL: { step, delay }
    this.track = { transpose: 0, scale: null };
    // chord runtime
    this.cSlot = -1; this.cSlotTicksLeft = 0; this.cChordNotes = []; this.cActive = [];
    this.cArpPos = 0; this.cArpDir = 1; this.cArpCnt = 0; this.cStrum = []; this.cStrumCnt = 0;
    this.cGateOff = 0; this._arpNote = null;
    this.voice = {
      baseNote: 60, vel: 0.8,
      mod: { pit: 0, fin: 0, arp: 0, vib: 0, bend: 0 },
      slideTicks: 0, playedBase: 60, retScale: 1,
      volCmd: null, tableTranspose: 0, tableVol: 1,
      persistent: {}, alive: false, killIn: null, offIn: null,
      arpSpeed: 1, arpMode: 0
    };
  };

  // ---- public config ----
  Engine.prototype.tickDur = function () { return 60 / (this.bpm * 24); };
  Engine.prototype.setBPM = function (b) { this.bpm = Math.max(20, Math.min(255, b)); };
  Engine.prototype.setGroove = function (n) {
    this.grooveNum = n & 0xff;
    this.groove = GROOVES[this.grooveNum] || GROOVES[0x00];
  };
  Engine.prototype.setSeed = function (s) { this.rng = mulberry32((s + 1) * 2654435761 | 0); };
  Engine.prototype.setTableTic = function (v) { this.tableTic = v & 0xff; };

  Engine.prototype.grooveTicks = function (step) {
    var g = this.groove; return g[step % g.length];
  };
  Engine.prototype.tableLen = function () {
    var last = 0;
    for (var i = 0; i < 16; i++) {
      var r = this.table[i];
      if (r.n != null || r.v != null || r.fx[0] || r.fx[1] || r.fx[2]) last = i;
    }
    return last + 1;
  };

  // ---- transport ----
  Engine.prototype.play = function () {
    if (this.running) return;
    this.audio.ensure();
    this.audio.resetFx();
    this._resetState();
    this.running = true;
    this._next = this.audio.now();
    var self = this;
    var loop = function () {
      if (!self.running) return;
      var t = self.audio.now(), td = self.tickDur();
      var guard = 0;
      while (self._next <= t + 0.0015 && guard++ < 64) { self._doTick(); self._next += td; }
      self._raf = requestAnimationFrame(loop);
    };
    loop();
  };
  Engine.prototype.stop = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.audio.silence();
    this.voice.alive = false;
    this._emit();
  };

  Engine.prototype.setMode = function (m) { this.mode = m; };
  Engine.prototype._shapeIndexByName = function (name) {
    var s = this.chord.shapes || []; for (var i = 0; i < s.length; i++) if (s[i].name === name) return i; return 0;
  };

  // ---- the tick ----
  Engine.prototype._doTick = function () {
    if (this.mode === 'chords') this._chordTick(); else this._trackTick();
  };

  Engine.prototype._trackTick = function () {
    var v = this.voice;
    if (this.stepTicksLeft <= 0) this._enterNextStep();
    if (!this.running) return;

    // DEL countdown (deferred whole-row trigger)
    if (this.pending) {
      if (--this.pending.delay <= 0) { this._fireRow(this.pending.step, this.pending.fx, this.pending.gate); this.pending = null; }
    }

    // Table advance (independent of groove)
    this._advanceTable();

    // Per-tick modulators: reset the fast ones, then let persistent FX repaint them
    v.mod.arp = 0; v.mod.vib = 0;
    var ctx = this._ctx();
    for (var code in v.persistent) {
      var e = v.persistent[code];
      if (e.def.tick) e.def.tick(v, e.p, ctx, e.state);
    }

    // KIL / OFF countdowns
    if (v.killIn != null) { if (v.killIn-- <= 0) { this.audio.kill(); v.alive = false; v.killIn = null; } }
    if (v.offIn != null) { if (v.offIn-- <= 0) { this.audio.noteOff(0.12); v.alive = false; v.offIn = null; } }

    this._updateOutput();
    this.stepTicksLeft--;
    this.tickCount++;
    this._emit();
  };

  // ---- chord mode ----
  var CSTEP = 6;   // chords run steady (groove doesn't apply), 6 ticks/16th
  Engine.prototype._chordTick = function () {
    if (this.cSlotTicksLeft <= 0) this._enterChordSlot();
    this._releaseExpired();
    var st = this.chord.style, notes = this.cChordNotes;
    if (st === 'strum') {
      if (this.cStrum.length && this.cStrumCnt-- <= 0) {
        this._triggerChordNote(this.cStrum.shift(), this.cGateOff, 0.45);
        this.cStrumCnt = this.chord.rate;
      }
    } else if (st === 'up' || st === 'down' || st === 'updown' || st === 'random') {
      if (this.cArpCnt-- <= 0 && notes.length) {
        var idx;
        if (st === 'random') idx = Math.floor(this.rng() * notes.length);
        else {
          idx = this.cArpPos;
          if (st === 'up') this.cArpPos = (this.cArpPos + 1) % notes.length;
          else if (st === 'down') this.cArpPos = (this.cArpPos - 1 + notes.length) % notes.length;
          else {
            this.cArpPos += this.cArpDir;
            if (this.cArpPos >= notes.length - 1) { this.cArpPos = notes.length - 1; this.cArpDir = -1; }
            else if (this.cArpPos <= 0) { this.cArpPos = 0; this.cArpDir = 1; }
          }
        }
        var note = notes[Math.max(0, Math.min(notes.length - 1, idx))];
        this._triggerChordNote(note, this.tickCount + Math.max(2, Math.round(this.chord.rate * 1.6)), 0.5);
        this._arpNote = note;
        this.cArpCnt = this.chord.rate;
      }
    }
    this._lastSemis = this._chordLowest();
    this.cSlotTicksLeft--;
    this.tickCount++;
    this._emit();
  };

  Engine.prototype._enterChordSlot = function () {
    var seq = this.chordSeq, ch = this.chord, self = this;
    if (!seq.length) { this.cSlotTicksLeft = CSTEP; return; }
    this.cSlot = (this.cSlot + 1) % seq.length;
    var slot = seq[this.cSlot];
    this.cRootPc = slot.pc;
    var root = (slot.oct + 1) * 12 + slot.pc;
    var shape = (ch.shapes && ch.shapes[slot.shape]) || (ch.shapes && ch.shapes[0]) || { voices: [{ off: 0, on: true }] };
    var built = this._buildChordNotes(root, shape);
    this.cChordNotes = built.notes;
    this._chordVoiceInfo = built.info;
    this.cSlotTicksLeft = this.chord.slotSteps * CSTEP;
    this.cGateOff = this.tickCount + Math.max(1, Math.min(this.chord.gateSteps, this.chord.slotSteps)) * CSTEP;
    this.cArpPos = 0; this.cArpDir = 1; this.cArpCnt = 0; this.cStrumCnt = 0;
    if (this.chord.style === 'block') {
      var self = this;
      this.cChordNotes.forEach(function (n) { self._triggerChordNote(n, self.cGateOff, 0.45); });
    } else if (this.chord.style === 'strum') {
      this.cStrum = this.cChordNotes.slice();
    }
  };

  // Build the notes for a chord from a root + a Hypersynth shape, applying
  // SHIFT (voice-group cross-fade), SUBOSC, SWARM (detune) and WIDTH (pan).
  Engine.prototype._buildChordNotes = function (root, shape) {
    var ch = this.chord, scaleIdx = ch.scale === 'minor' ? 2 : 1;
    var t = (ch.shift == null ? 128 : ch.shift) / 255;
    var gA = Math.min(1, 2 * (1 - t)), gB = Math.min(1, 2 * t);
    var info = {}, notes = [];
    shape.voices.forEach(function (v, idx) {
      if (!v.on) return;
      var n = root + (v.off | 0);
      if (ch.diatonic && M8.scales) n = M8.scales.quantize(n, ch.key, scaleIdx);
      if (info[n]) return;
      info[n] = { level: idx < 3 ? gA : gB }; notes.push(n);
    });
    if (ch.subosc) {
      var sub = root - (ch.subosc < 0x80 ? 24 : 12);
      if (!info[sub]) { info[sub] = { level: ch.subosc / 255 }; notes.push(sub); }
    }
    notes.sort(function (a, b) { return a - b; });
    var w = (ch.width || 0) / 255;
    notes.forEach(function (n, i) {
      info[n].detune = (i - (notes.length - 1) / 2) * (ch.swarm / 255) * 22;
      info[n].pan = notes.length > 1 ? ((i / (notes.length - 1)) * 2 - 1) * w : 0;
    });
    return { notes: notes, info: info };
  };

  Engine.prototype._triggerChordNote = function (note, offTick, level) {
    var voice = this._allocVoice();
    var vi = this._chordVoiceInfo ? this._chordVoiceInfo[note] : null;
    var lvl = level * (vi ? vi.level : 1);
    this.audio.voiceOn(voice, M8.notes.midiToFreq(note), lvl, vi ? vi.detune : 0, vi ? vi.pan : 0);
    this.cActive.push({ voice: voice, note: note, offTick: offTick });
  };
  Engine.prototype._releaseAllChord = function () {
    var self = this; this.cActive.forEach(function (a) { self.audio.voiceOff(a.voice, 0.1); }); this.cActive = [];
  };
  Engine.prototype._allocVoice = function () {
    var used = {}; this.cActive.forEach(function (a) { used[a.voice] = true; });
    for (var i = 0; i < M8.NVOICES; i++) if (!used[i]) return i;
    var oi = 0; this.cActive.forEach(function (a, idx) { if (a.offTick < this.cActive[oi].offTick) oi = idx; }, this);
    this.audio.voiceKill(this.cActive[oi].voice);
    var v = this.cActive[oi].voice; this.cActive.splice(oi, 1); return v;
  };
  Engine.prototype._releaseExpired = function () {
    var keep = [], self = this;
    this.cActive.forEach(function (a) { if (a.offTick <= self.tickCount) self.audio.voiceOff(a.voice, 0.12); else keep.push(a); });
    this.cActive = keep;
  };
  Engine.prototype._chordLowest = function () {
    var st = this.chord.style;
    if ((st === 'block' || st === 'strum') && this.cChordNotes.length) return this.cChordNotes[0];
    return this._arpNote || this.cChordNotes[0] || 60;
  };

  Engine.prototype._enterNextStep = function () {
    for (var guard = 0; guard < 64; guard++) {
      if (this.jumpTarget != null) { this.curStep = this.jumpTarget; this.jumpTarget = null; }
      else { this.curStep++; if (this.curStep >= 16) { this.curStep = 0; this.loopCount++; } }
      var ticks = this.grooveTicks(this.curStep);
      if (ticks === 0) continue;                 // groove "00" = skip step
      var res = this._resolveRow(this.phrase[this.curStep].fx, false);
      if (res.delay > 0) {                        // DEL defers the entire row
        this.pending = { step: this.curStep, delay: res.delay, fx: res.fx, gate: res.gate };
      } else {
        this._fireRow(this.curStep, res.fx, res.gate);
      }
      if (!this.running) return;
      this.stepTicksLeft = ticks;
      return;
    }
    this.stop();
  };

  // Resolve RND / CHA / NTH / DEL modifiers in a row into a clean FX list + gate.
  Engine.prototype._resolveRow = function (cells, isTable) {
    var out = [], gate = true, delay = 0;
    var resolved = cells.map(function (c) { return c ? { code: c.code, value: c.value } : null; });
    for (var i = 0; i < resolved.length; i++) {
      var c = resolved[i]; if (!c) continue;
      if (c.code === 'DEL') { delay = c.value; continue; }
      if (c.code === 'CHA') {
        var x = c.value >> 4;                     // left-side (note) probability
        if (this.rng() >= x / 15) gate = false;
        continue;
      }
      if (c.code === 'NTH') {
        var period = Math.max(1, (c.value & 0xf) || (c.value >> 4) || 1);
        if (this.loopCount % period !== 0) gate = false;
        continue;
      }
      if (c.code === 'RND' || c.code === 'RNL') {
        var left = resolved[i - 1];
        if (left) {
          var hi = (left.value >> 4) + Math.floor(this.rng() * ((c.value >> 4) + 1));
          var lo = (left.value & 0xf) + Math.floor(this.rng() * ((c.value & 0xf) + 1));
          left.value = (Math.min(15, hi) << 4) | Math.min(15, lo);
        }
        continue;
      }
      out.push(c);
    }
    return { fx: out, gate: gate, delay: delay };
  };

  Engine.prototype._fireRow = function (stepIdx, fxList, gate) {
    var step = this.phrase[stepIdx], v = this.voice;
    // HSC selects the Hypersynth chord bank; apply first so it affects this step
    for (var k = 0; k < fxList.length; k++) {
      if (fxList[k].code === 'HSC') this.curBank = Math.max(0, Math.min(this.chord.shapes.length - 1, fxList[k].value));
    }
    if (this.instrument === 'hyper') {
      if (step.note != null && gate) {
        this._releaseAllChord();
        var shape = this.chord.shapes[this.curBank] || this.chord.shapes[0];
        var built = this._buildChordNotes(step.note, shape);
        this.cChordNotes = built.notes; this._chordVoiceInfo = built.info;
        this.cRootPc = ((step.note % 12) + 12) % 12;
        var lvl = (step.vel != null ? step.vel / 255 : 0.8) * 0.9, self = this;
        built.notes.forEach(function (n) { self._triggerChordNote(n, Infinity, lvl); });
      }
      v.alive = false;                 // mono voice unused in Hypersynth mode
      return;                          // per-voice FX are not applied in v1 hyper mode
    }
    if (step.note != null && gate) {
      v.baseNote = step.note;
      v.vel = (step.vel != null ? step.vel / 255 : 0.8);
      v.killIn = null; v.offIn = null; v.retScale = 1; v.alive = true;
      this._restartTable();           // instrument (re)trigger restarts the table
      this.audio.noteOn(this._level());
    }
    // apply FX right-to-left (manual precedence)
    var ctx = this._ctx();
    for (var i = fxList.length - 1; i >= 0; i--) { if (fxList[i].code === 'HSC') continue; this._applyFx(v, fxList[i], ctx); }
  };

  Engine.prototype._applyFx = function (v, c, ctx) {
    var def = fx.byCode(c.code); if (!def) return;
    var p = { x: c.value >> 4, y: c.value & 0xf, value: c.value };
    if (def.tick) {                              // persistent
      var prev = v.persistent[c.code];
      var state = prev ? prev.state : (def.state ? def.state() : {});
      v.persistent[c.code] = { p: p, state: state, def: def };
      if (def.onTrigger) def.onTrigger(v, p, ctx, state);
    } else if (def.onTrigger) {
      def.onTrigger(v, p, ctx);
    } else if (def.code === 'HOP') {
      if (c.value === 0xff) this.stop(); else this.jumpTarget = (c.value & 0xf);
    } else if (def.code === 'THO') {
      this.tableRow = (c.value & 0xf) - 1;       // hop table head (applied next advance)
    }
  };

  // ---- table playback ----
  Engine.prototype._restartTable = function () {
    if (this.tableTic === 0) { this.tableRow = (this.tableRow + 1) % this.tableLen(); }
    else { this.tableRow = 0; this.tableAcc = 0; this.tableFracRow = 0; }
    this._applyTableRow(this.tableRow);
  };
  Engine.prototype._advanceTable = function () {
    if (!this.tableEnabled || !this.voice.alive) return;
    var tic = this.tableTic;
    if (tic === 0) return;                        // advances on trigger only
    if (tic >= 0x01 && tic <= 0xfb) {
      if (++this.tableAcc >= tic) { this.tableAcc = 0; this._stepTableRow(); }
    } else if (tic === 0xff) {                     // ~200 Hz regardless of tempo
      this.tableFracRow += 200 * this.tickDur();
      while (this.tableFracRow >= 1) { this.tableFracRow -= 1; this._stepTableRow(); }
    }
    // FC/FD/FE map modes: position set once at trigger (partial) — left as-is.
  };
  Engine.prototype._stepTableRow = function () {
    this.tableRow = (this.tableRow + 1) % this.tableLen();
    this._applyTableRow(this.tableRow);
  };
  Engine.prototype._applyTableRow = function (r) {
    var row = this.table[r]; if (!row) return;
    var v = this.voice;
    v.tableTranspose = (row.n != null) ? notes.signedByte(row.n) : 0;
    v.tableVol = (row.v != null) ? row.v / 0xff : 1;
    var res = this._resolveRow(row.fx, true);
    var ctx = this._ctx();
    for (var i = res.fx.length - 1; i >= 0; i--) {
      var c = res.fx[i];
      if (c.code === 'TIC') { this.setTableTic(c.value); continue; }
      if (c.code === 'HOP') { this.tableRow = (c.value & 0xf) - 1; continue; }
      this._applyFx(v, c, ctx);
    }
  };

  // ---- output ----
  Engine.prototype._level = function () {
    var v = this.voice;
    var lvl = v.vel * (v.volCmd != null ? v.volCmd : 1) * (v.tableVol || 1) * (v.retScale || 1);
    return Math.max(0, Math.min(1, lvl)) * 0.9;
  };
  Engine.prototype._updateOutput = function () {
    var v = this.voice;
    if (this.instrument === 'hyper') { this._lastSemis = this.cChordNotes[0] || 60; return; }
    // slow integer base (note + transposes + pitch offset) is what scales quantize
    var slow = v.baseNote + this.track.transpose + (v.tableTranspose || 0) + v.mod.pit;
    if (this.track.scale && M8.scales) slow = M8.scales.quantize(slow, this.track.scale.key, this.track.scale.scale);
    var base = slow + v.mod.fin + v.mod.bend;            // fine tune + bend ride on top
    if (v.slideTicks > 0) v.playedBase += (base - v.playedBase) / Math.max(1, v.slideTicks);
    else v.playedBase = base;
    var semis = v.playedBase + v.mod.arp + v.mod.vib;    // arp/vibrato stay snappy
    this._lastSemis = semis;
    if (v.alive) { this.audio.setFreq(notes.midiToFreq(semis)); this.audio.setLevel(this._level()); }
  };

  Engine.prototype._ctx = function () {
    var self = this, v = this.voice;
    return {
      tickDur: this.tickDur(),
      track: this.track,
      audio: this.audio,
      rand: function () { return self.rng(); },
      retrig: function () { self.audio.noteOn(self._level()); },
      scheduleKill: function (t) { v.killIn = t; },
      scheduleOff: function (t) { v.offIn = t; },
      setTempo: function (b) { self.setBPM(b); },
      setGroove: function (n) { self.setGroove(n); },
      setScale: function (k, s) { self.track.scale = { key: k, scale: s }; },
      setSeed: function (s) { self.setSeed(s); },
      setTableTic: function (t) { self.setTableTic(t); }
    };
  };

  Engine.prototype._emit = function () {
    if (!this.onUpdate) return;
    var v = this.voice;
    var active = Object.keys(v.persistent).filter(function (c) {
      var e = v.persistent[c]; return e.p.value !== 0;
    });
    var hyper = this.mode === 'track' && this.instrument === 'hyper';
    var isChord = this.mode === 'chords' || hyper;
    var chordLabel = isChord ? M8.chords.nameChord(this.cRootPc, this.cChordNotes) : null;
    var sem = this._lastSemis || (isChord ? 60 : v.baseNote);
    this.onUpdate({
      mode: this.mode, instrument: this.instrument, bank: this.curBank,
      tick: this.tickCount, step: this.curStep, tableRow: this.tableEnabled ? this.tableRow : -1,
      running: this.running, alive: isChord ? this.cActive.length > 0 : v.alive,
      semis: sem, noteLabel: isChord ? (chordLabel || '---') : notes.formatNote(sem),
      freq: notes.midiToFreq(sem),
      level: isChord ? (this.cActive.length ? 0.7 : 0) : (v.alive ? this._level() : 0),
      bend: v.mod.bend, bpm: this.bpm, groove: this.grooveNum,
      activeFX: active, slide: v.slideTicks, scale: this.track.scale,
      chordLabel: chordLabel, cSlot: this.cSlot, poly: this.cActive.length
    });
  };

  Engine.GROOVES = GROOVES;
  M8.Engine = Engine;
})(window.M8 = window.M8 || {});
