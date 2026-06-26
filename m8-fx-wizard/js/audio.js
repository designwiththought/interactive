/* audio.js — a small polyphonic synth (voice pool) plus a shared M8-style FX bus:
 *
 *   voice[i]: osc → amp(env) ─┐
 *                             ├─► voiceMix → instFilter(LP) → voiceOut ─┬─► (dry)
 *                             │                                          ├─ delaySend → delay ↺fb → delayRet ─┐
 *   (8 voices)                ┘                                          └─ revSend  → reverb(IR) → revRet ───┤
 *                                                                (dry + returns) → DJ filter → master → out
 *
 * Mono methods (noteOn/setFreq/…) drive voice 0 so the monophonic phrase engine
 * is unchanged; voiceOn(i,…) etc. drive the pool for chords. */
(function (M8) {
  'use strict';
  var NV = 8;

  function Audio() {
    this.ctx = null;
    this.wave = 'sawtooth';
    this.cutoff = 5000;
    this.voices = [];
    this.revDecay = 1.6; this.revSize = 0.5;
  }

  Audio.prototype.ensure = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var c = new Ctx(); this.ctx = c;

    var master = c.createGain(); master.gain.value = 0.9; master.connect(c.destination);
    var dj = c.createBiquadFilter(); dj.type = 'lowpass'; dj.frequency.value = 18000; dj.Q.value = 0.7; dj.connect(master);

    var voiceOut = c.createGain(); voiceOut.gain.value = 1;
    var instFilter = c.createBiquadFilter(); instFilter.type = 'lowpass';
    instFilter.frequency.value = this.cutoff; instFilter.Q.value = 0.8;
    var voiceMix = c.createGain(); voiceMix.gain.value = 0.5;
    voiceMix.connect(instFilter); instFilter.connect(voiceOut); voiceOut.connect(dj);

    this.voices = [];
    for (var i = 0; i < NV; i++) {
      var amp = c.createGain(); amp.gain.value = 0.0001;
      var pan = c.createStereoPanner(); pan.pan.value = 0;
      var osc = c.createOscillator(); osc.type = this.wave; osc.frequency.value = 440;
      osc.connect(amp); amp.connect(pan); pan.connect(voiceMix); osc.start();
      this.voices.push({ osc: osc, amp: amp, pan: pan, on: false });
    }

    var delaySend = c.createGain(); delaySend.gain.value = 0.32;
    var delay = c.createDelay(2.0); delay.delayTime.value = 0.25;
    var fb = c.createGain(); fb.gain.value = 0.35;
    var delayRet = c.createGain(); delayRet.gain.value = 0;
    voiceOut.connect(delaySend); delaySend.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(delayRet); delayRet.connect(dj);

    var revSend = c.createGain(); revSend.gain.value = 0.28;
    var reverb = c.createConvolver(); reverb.buffer = this._makeIR(c);
    var revRet = c.createGain(); revRet.gain.value = 0;
    voiceOut.connect(revSend); revSend.connect(reverb); reverb.connect(revRet); revRet.connect(dj);

    this.master = master; this.dj = dj; this.voiceOut = voiceOut; this.instFilter = instFilter;
    this.delay = delay; this.fb = fb; this.delayRet = delayRet; this.delaySend = delaySend;
    this.reverb = reverb; this.revRet = revRet; this.revSend = revSend;
  };

  Audio.prototype._makeIR = function (c) {
    var sr = c.sampleRate, len = Math.max(1, Math.floor(sr * (0.2 + this.revSize * 2)));
    var buf = c.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2 + this.revDecay * 2.5);
    }
    return buf;
  };

  Audio.prototype.now = function () { return this.ctx ? this.ctx.currentTime : 0; };
  Audio.prototype.setWave = function (w) { this.wave = w; this.voices.forEach(function (v) { v.osc.type = w; }); };
  Audio.prototype.setCutoff = function (hz) { this.cutoff = hz; if (this.instFilter) this.instFilter.frequency.setTargetAtTime(hz, this.now(), 0.02); };

  // ---- per-voice primitives ----
  Audio.prototype.voiceFreq = function (i, f) {
    var v = this.voices[i]; if (!v || !isFinite(f) || f <= 0) return;
    v.osc.frequency.setTargetAtTime(f, this.now(), 0.004);
  };
  Audio.prototype.voiceOn = function (i, freq, peak, detune, pan) {
    this.ensure(); var v = this.voices[i]; if (!v) return;
    if (freq) v.osc.frequency.setTargetAtTime(freq, this.now(), 0.002);
    v.osc.detune.setValueAtTime(detune || 0, this.now());
    v.pan.pan.setValueAtTime(pan || 0, this.now());
    var t = this.now(), g = v.amp.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, peak), t + 0.004); v.on = true;
  };
  Audio.prototype.voiceLevel = function (i, peak) {
    var v = this.voices[i]; if (!v || !v.on) return;
    v.amp.gain.setTargetAtTime(Math.max(0.0001, peak), this.now(), 0.01);
  };
  Audio.prototype.voiceOff = function (i, rel) {
    var v = this.voices[i]; if (!v) return;
    var t = this.now(); v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setTargetAtTime(0.0001, t, (rel || 0.1) / 3); v.on = false;
  };
  Audio.prototype.voiceKill = function (i) {
    var v = this.voices[i]; if (!v) return;
    var t = this.now(); v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setTargetAtTime(0.0001, t, 0.005); v.on = false;
  };

  // ---- mono aliases (voice 0) for the phrase engine ----
  Audio.prototype.noteOn = function (peak) { this.voiceOn(0, null, peak); };
  Audio.prototype.setFreq = function (f) { this.voiceFreq(0, f); };
  Audio.prototype.setLevel = function (p) { this.voiceLevel(0, p); };
  Audio.prototype.noteOff = function (r) { this.voiceOff(0, r); };
  Audio.prototype.kill = function () { this.voiceKill(0); };
  Audio.prototype.silence = function () { var self = this; this.voices.forEach(function (v, i) { self.voiceKill(i); }); };

  // ---- FX bus ----
  var lin = function (v) { return v / 255; };
  Audio.prototype.setMaster = function (v) { if (this.master) this.master.gain.setTargetAtTime(lin(v), this.now(), 0.02); };
  Audio.prototype.setDelayReturn = function (v) { if (this.delayRet) this.delayRet.gain.setTargetAtTime(lin(v), this.now(), 0.02); };
  Audio.prototype.setReverbReturn = function (v) { if (this.revRet) this.revRet.gain.setTargetAtTime(lin(v), this.now(), 0.02); };
  Audio.prototype.setDelayFeedback = function (v) { if (this.fb) this.fb.gain.setTargetAtTime(lin(v) * 0.95, this.now(), 0.02); };
  Audio.prototype.setDelayTime = function (v) { if (this.delay) this.delay.delayTime.setTargetAtTime(0.02 + lin(v) * 0.6, this.now(), 0.05); };
  Audio.prototype.setReverbSize = function (v) { this.revSize = lin(v); if (this.reverb) this.reverb.buffer = this._makeIR(this.ctx); };
  Audio.prototype.setReverbDecay = function (v) { this.revDecay = lin(v); if (this.reverb) this.reverb.buffer = this._makeIR(this.ctx); };
  Audio.prototype.setReverbFreeze = function (on) {
    if (!this.revSend) return;
    this.revSend.gain.setTargetAtTime(on ? 0 : 0.28, this.now(), 0.05);
    if (on) this.revRet.gain.setTargetAtTime(0.9, this.now(), 0.05);
  };
  Audio.prototype.setDJCut = function (v) { if (this.dj) this.dj.frequency.setTargetAtTime(60 * Math.pow(300, lin(v)), this.now(), 0.02); };
  Audio.prototype.setDJRes = function (v) { if (this.dj) this.dj.Q.setTargetAtTime(0.5 + lin(v) * 18, this.now(), 0.02); };
  Audio.prototype.setDJType = function (v) { if (this.dj) this.dj.type = (v === 0) ? 'lowpass' : (v === 1) ? 'highpass' : 'bandpass'; };

  Audio.prototype.resetFx = function () {
    if (!this.ctx) return; var t = this.now();
    this.delayRet.gain.setTargetAtTime(0, t, 0.01);
    this.revRet.gain.setTargetAtTime(0, t, 0.01);
    this.revSend.gain.setTargetAtTime(0.28, t, 0.01);
    this.dj.type = 'lowpass'; this.dj.frequency.setTargetAtTime(18000, t, 0.01); this.dj.Q.setTargetAtTime(0.7, t, 0.01);
    this.master.gain.setTargetAtTime(0.9, t, 0.01);
  };

  M8.Audio = Audio;
  M8.NVOICES = NV;
})(window.M8 = window.M8 || {});
