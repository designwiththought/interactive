//---------------------------------------------------
//
//  PatternPreview — a small Web Audio sequencer
//
//  Plays a tracker-lib PatternData at tempo and approximates the step-FX so you
//  can *hear* a forged/drawn pattern before exporting. This is a PREVIEW: it is
//  not a bit-exact model of the hardware. The exported .mtp is the source of
//  truth. Built only from standard Web Audio nodes — no external DSP, MIT-clean.
//
//  FX approximated: V (volume), P (pan), M (micro-tune), G (glide), q (gate),
//  R (roll/retrigger), r (reverse), C (chance), T (tempo), L/H/B (filter),
//  s (delay send), t (reverb send), D (overdrive). Others are ignored safely.
//
//---------------------------------------------------
import type { PatternData, StepData, FX } from '@polyend/tracker-lib';
import { fxDisplayRange } from '@/forge/index.ts';

const BASE_NOTE = 48; // 48 = C4 plays the sample at its natural rate

export interface PlayOptions {
  bpm?: number;
  stepsPerBeat?: number;
  /** Track indices to play. Default: all. */
  tracks?: number[];
  loop?: boolean;
  /** Called (slightly ahead of audio) with the step about to sound, for a playhead. */
  onStep?: (step: number) => void;
  /** Called when playback stops (end of a non-looping pattern). */
  onStop?: () => void;
}

interface FxMap {
  [symbol: string]: number; // display value
}

function readFx(step: StepData): FxMap {
  const out: FxMap = {};
  for (const fx of step.fx as FX[]) {
    if (!fx || fx.type.symbol === '-') continue;
    const dr = fxDisplayRange(fx.type);
    const range = fx.type.max - fx.type.min || 1;
    const norm = (fx.value - fx.type.min) / range;
    out[fx.type.symbol] = dr.scaled ? dr.lo + (dr.hi - dr.lo) * norm : fx.value;
  }
  return out;
}

export class PatternPreview {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private delay!: DelayNode;
  private delayFb!: GainNode;
  private reverb!: ConvolverNode;
  private buffer: AudioBuffer | null = null;
  private reversed: AudioBuffer | null = null;

  private timer: number | undefined;
  private playing = false;
  private step = 0;
  private nextTime = 0;
  private bpm = 130;
  private opts: Required<Pick<PlayOptions, 'stepsPerBeat' | 'loop'>> & PlayOptions = {
    stepsPerBeat: 4,
    loop: true,
  };
  private pattern: PatternData | null = null;
  private lastNote = new Map<number, number>(); // per-track previous note (for glide)

  private readonly LOOKAHEAD = 0.1; // seconds scheduled ahead
  private readonly TICK = 25; // ms scheduler interval

  get isPlaying() {
    return this.playing;
  }

  //----------------------------------
  // Setup
  //----------------------------------
  private ensureCtx() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);

    // Simple feedback delay (FX 's' send target)
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.25;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.35;
    this.delay.connect(this.delayFb).connect(this.delay);
    this.delay.connect(this.master);

    // Simple convolution reverb (FX 't' send target)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(ctx, 0.6);
    this.reverb.connect(this.master);

    if (!this.buffer) this.buffer = this.makeDefaultSample(ctx);
  }

  /** Decode a user-provided WAV into the playback buffer. */
  async setSample(data: ArrayBuffer): Promise<void> {
    this.ensureCtx();
    this.buffer = await this.ctx!.decodeAudioData(data.slice(0));
    this.reversed = this.makeReversed(this.buffer);
  }

  /** A short percussive blip so preview works with no sample loaded. */
  private makeDefaultSample(ctx: BaseAudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.35);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-18 * t);
      d[i] = Math.sin(2 * Math.PI * 220 * t) * env * 0.9;
    }
    this.reversed = this.makeReversed(buf);
    return buf;
  }

  private makeReversed(buf: AudioBuffer): AudioBuffer {
    const ctx = this.ctx!;
    const rev = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = rev.getChannelData(c);
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
    }
    return rev;
  }

  private makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      // Deterministic pseudo-noise (no Math.random dependency for the tail shape)
      let s = 1234.5 + c * 99;
      for (let i = 0; i < len; i++) {
        s = (s * 16807) % 2147483647;
        const noise = (s / 2147483647) * 2 - 1;
        d[i] = noise * Math.pow(1 - i / len, 2.5);
      }
    }
    return buf;
  }

  //----------------------------------
  // Transport
  //----------------------------------
  async play(pattern: PatternData, options: PlayOptions = {}): Promise<void> {
    this.ensureCtx();
    await this.ctx!.resume();
    this.stop(false);
    this.pattern = pattern;
    this.bpm = options.bpm ?? 130;
    this.opts = { stepsPerBeat: options.stepsPerBeat ?? 4, loop: options.loop ?? true, ...options };
    this.step = 0;
    this.lastNote.clear();
    this.nextTime = this.ctx!.currentTime + 0.05;
    this.playing = true;
    this.scheduler();
  }

  stop(fireCallback = true): void {
    this.playing = false;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (fireCallback) this.opts.onStop?.();
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
  }

  private numSteps(tracks: number[]): number {
    if (!this.pattern) return 0;
    return Math.max(0, ...tracks.map((t) => (this.pattern!.tracks[t]?.length ?? 0) + 1));
  }

  private targetTracks(): number[] {
    if (!this.pattern) return [];
    return this.opts.tracks ?? this.pattern.tracks.map((_, i) => i);
  }

  private stepDuration(): number {
    return 60 / this.bpm / this.opts.stepsPerBeat;
  }

  //----------------------------------
  // Scheduler (lookahead pattern)
  //----------------------------------
  private scheduler = () => {
    this.timer = window.setInterval(() => {
      if (!this.playing || !this.ctx || !this.pattern) return;
      const tracks = this.targetTracks();
      const total = this.numSteps(tracks);
      if (total === 0) return;

      while (this.nextTime < this.ctx.currentTime + this.LOOKAHEAD) {
        const s = this.step % total;
        this.opts.onStep?.(s);

        // Apply a tempo change found on this step before computing the next gap.
        for (const t of tracks) {
          const step = this.pattern.tracks[t]?.steps[s];
          if (!step) continue;
          const fx = readFx(step);
          if (fx['T'] != null) this.bpm = fx['T'];
        }

        const dur = this.stepDuration();
        for (const t of tracks) {
          const step = this.pattern.tracks[t]?.steps[s];
          if (step) this.scheduleStep(t, step, this.nextTime, dur);
        }

        this.nextTime += dur;
        this.step++;
        if (!this.opts.loop && this.step >= total) {
          // let the tail ring, then stop
          window.setTimeout(() => this.stop(), dur * 1000 + 400);
          this.playing = false;
          break;
        }
      }
    }, this.TICK);
  };

  //----------------------------------
  // Voice
  //----------------------------------
  private scheduleStep(track: number, step: StepData, time: number, dur: number) {
    if (step.note < 0) return; // empty / off
    const fx = readFx(step);

    // Chance — probabilistic, live (matches the hardware's per-loop dice).
    if (fx['C'] != null && Math.random() * 100 > fx['C']) return;

    // Roll — retrigger N times across the step.
    const rolls = fx['R'] != null ? Math.max(1, Math.min(8, Math.round(fx['R']))) : 1;
    const slice = dur / rolls;
    for (let r = 0; r < rolls; r++) {
      this.trigger(track, step, fx, time + r * slice, slice);
    }
  }

  private trigger(track: number, step: StepData, fx: FxMap, time: number, dur: number) {
    const ctx = this.ctx!;
    const useRev = fx['r'] != null && fx['r'] > 0;
    const src = ctx.createBufferSource();
    src.buffer = useRev ? this.reversed : this.buffer;

    // Pitch: note + micro-tune (cents), with optional glide from the previous note.
    const cents = (step.note - BASE_NOTE) * 100 + (fx['M'] ?? 0);
    const prev = this.lastNote.get(track);
    if (fx['G'] != null && fx['G'] > 0 && prev != null) {
      const fromCents = (prev - BASE_NOTE) * 100;
      const glideT = Math.min(dur * 0.9, (fx['G'] / 100) * dur * 2);
      src.detune.setValueAtTime(fromCents, time);
      src.detune.linearRampToValueAtTime(cents, time + glideT);
    } else {
      src.detune.setValueAtTime(cents, time);
    }
    this.lastNote.set(track, step.note);

    // Node chain: src → [overdrive] → [filter] → gain → panner → master (+sends)
    let node: AudioNode = src;

    if (fx['D'] != null && fx['D'] > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.overdriveCurve(fx['D'] / 100);
      node.connect(shaper);
      node = shaper;
    }

    const filterSym = (['L', 'H', 'B'] as const).find((s) => fx[s] != null);
    if (filterSym) {
      const filter = ctx.createBiquadFilter();
      filter.type = filterSym === 'L' ? 'lowpass' : filterSym === 'H' ? 'highpass' : 'bandpass';
      const amt = fx[filterSym] / 100; // 0..1
      filter.frequency.value = 120 * Math.pow(150, filterSym === 'H' ? 1 - amt : amt);
      filter.Q.value = filterSym === 'B' ? 6 : 1;
      node.connect(filter);
      node = filter;
    }

    // Volume (V) + gate-length (q) envelope.
    const vol = fx['V'] != null ? fx['V'] / 100 : 0.85;
    const gateFrac = fx['q'] != null ? Math.max(0.05, fx['q'] / 100) : 0.9;
    const gate = ctx.createGain();
    const end = time + dur * gateFrac;
    gate.gain.setValueAtTime(vol, time);
    gate.gain.setValueAtTime(vol, Math.max(time, end - 0.01));
    gate.gain.linearRampToValueAtTime(0.0001, end);
    node.connect(gate);

    // Panning (P).
    const panner = ctx.createStereoPanner();
    if (fx['P'] != null) panner.pan.value = Math.max(-1, Math.min(1, fx['P'] / 50));
    gate.connect(panner);

    panner.connect(this.master);
    // Sends.
    if (fx['s'] != null && fx['s'] > 0) {
      const send = ctx.createGain();
      send.gain.value = fx['s'] / 100;
      panner.connect(send).connect(this.delay);
    }
    if (fx['t'] != null && fx['t'] > 0) {
      const send = ctx.createGain();
      send.gain.value = fx['t'] / 100;
      panner.connect(send).connect(this.reverb);
    }

    src.start(time);
    src.stop(end + 0.05);
  }

  private overdriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);
    const k = amount * 60 + 1;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  dispose() {
    this.stop(false);
    this.ctx?.close();
    this.ctx = null;
  }
}
