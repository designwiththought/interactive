/* audio.js — a single monophonic synth voice driven by the engine.
 * Deliberately simple: one oscillator → lowpass → amp envelope → master.
 * The engine sets frequency/gain every tick and re-triggers the envelope on
 * note-on / retrig. It's a sketch of an M8 voice, not a clone of its synths. */
(function (M8) {
  'use strict';

  function Audio() {
    this.ctx = null;
    this.osc = null;
    this.filter = null;
    this.amp = null;
    this.master = null;
    this.wave = 'sawtooth';
    this.cutoff = 4000;
    this._on = false;
  }

  Audio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var master = ctx.createGain(); master.gain.value = 0.0;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = this.cutoff; filter.Q.value = 0.8;
    var amp = ctx.createGain(); amp.gain.value = 0.0;
    var osc = ctx.createOscillator(); osc.type = this.wave; osc.frequency.value = 440;
    osc.connect(filter); filter.connect(amp); amp.connect(master);
    master.connect(ctx.destination);
    osc.start();
    // soft master fade-in to avoid a click on first sound
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.01);
    this.ctx = ctx; this.osc = osc; this.filter = filter; this.amp = amp; this.master = master;
  };

  Audio.prototype.now = function () { return this.ctx ? this.ctx.currentTime : 0; };

  Audio.prototype.setWave = function (w) {
    this.wave = w; if (this.osc) this.osc.type = w;
  };
  Audio.prototype.setCutoff = function (hz) {
    this.cutoff = hz; if (this.filter) this.filter.frequency.setTargetAtTime(hz, this.now(), 0.02);
  };

  Audio.prototype.setFreq = function (freq) {
    if (!this.osc || !isFinite(freq) || freq <= 0) return;
    // small smoothing keeps tick-rate updates (vibrato/arp/slide) from clicking
    this.osc.frequency.setTargetAtTime(freq, this.now(), 0.004);
  };

  // Trigger the amp envelope. peak = velocity gain (0..1).
  Audio.prototype.noteOn = function (peak) {
    this.ensure();
    var t = this.now();
    var g = this.amp.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, peak), t + 0.004); // ~4ms attack
    this._on = true;
  };

  Audio.prototype.setLevel = function (peak) {
    if (!this.amp || !this._on) return;
    this.amp.gain.setTargetAtTime(Math.max(0.0001, peak), this.now(), 0.01);
  };

  // Soft release (envelope OFF stage).
  Audio.prototype.noteOff = function (releaseSec) {
    if (!this.amp) return;
    var t = this.now();
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0.0001, t, (releaseSec || 0.08) / 3);
    this._on = false;
  };

  // Hard cut (KIL).
  Audio.prototype.kill = function () {
    if (!this.amp) return;
    var t = this.now();
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0.0001, t, 0.005);
    this._on = false;
  };

  Audio.prototype.silence = function () { this.kill(); };

  M8.Audio = Audio;
})(window.M8 = window.M8 || {});
