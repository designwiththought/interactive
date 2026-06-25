//---------------------------------------------------
//
//  Shapes — automation curves & multi-FX audio effects
//
//  This is the foundation for the visual tools:
//   * CURVES are single-value automation shapes (ramp, decay, LFO, gate…) that
//     the line-graph view stamps onto one FX lane across a step range.
//   * EFFECTS are named audio effects (Tape Stop, Riser…) built from 1-2 FX
//     lanes, used by the effect builder. Every effect respects MAX_FX_LANES.
//
//  Everything here writes into a tracker-lib PatternData in place and is pure.
//
//---------------------------------------------------
import { PatternFX, type PatternData, type FXRecord } from '@polyend/tracker-lib';
import { fxRecord, makeFx, makeNone } from './fx.ts';
import { Rng, mixSeed } from './rng.ts';
import { MAX_FX_LANES } from './recipe.ts';

//----------------------------------
// Curves: normalized position t∈[0,1] → normalized value v∈[0,1]
//----------------------------------
export type CurveFn = (t: number, rng: Rng) => number;

const EXP_K = 3;
const expDecay = (t: number) => (Math.exp(-EXP_K * t) - Math.exp(-EXP_K)) / (1 - Math.exp(-EXP_K));

export interface CurveDef {
  id: string;
  name: string;
  description: string;
  fn: CurveFn;
}

export const CURVES: CurveDef[] = [
  { id: 'ramp-up', name: 'Ramp Up', description: 'Linear rise', fn: (t) => t },
  { id: 'ramp-down', name: 'Ramp Down', description: 'Linear fall', fn: (t) => 1 - t },
  { id: 'exp-rise', name: 'Exp Rise', description: 'Slow then fast rise', fn: (t) => 1 - expDecay(t) },
  { id: 'exp-decay', name: 'Exp Decay', description: 'Fast then slow fall', fn: (t) => expDecay(t) },
  { id: 'swell', name: 'Swell', description: 'Up then down (half sine)', fn: (t) => Math.sin(Math.PI * t) },
  { id: 's-curve', name: 'S-Curve', description: 'Smooth ease in/out', fn: (t) => t * t * (3 - 2 * t) },
  {
    id: 'sine-2',
    name: 'Sine LFO ×2',
    description: 'Two sine cycles',
    fn: (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t),
  },
  {
    id: 'sine-4',
    name: 'Sine LFO ×4',
    description: 'Four sine cycles',
    fn: (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t),
  },
  {
    id: 'gate-4',
    name: 'Gate ×4',
    description: 'Square on/off chop',
    fn: (t) => (Math.floor(t * 8) % 2 === 0 ? 1 : 0),
  },
  { id: 'random', name: 'Random', description: 'Seeded sample & hold', fn: (_t, rng) => rng.float() },
];

export const CURVES_BY_ID: Record<string, CurveDef> = Object.fromEntries(CURVES.map((c) => [c.id, c]));

/** Parametric square wave — `cycles` on/off pulses across the range. */
export const squareCurve =
  (cycles: number): CurveFn =>
  (t) =>
    Math.floor(t * cycles * 2) % 2 === 0 ? 1 : 0;

/** Parametric sine LFO — `cycles` oscillations across the range. */
export const sineCurve =
  (cycles: number): CurveFn =>
  (t) =>
    0.5 + 0.5 * Math.sin(2 * Math.PI * cycles * t);

//----------------------------------
// Automatable FX list (for the builder UI)
//----------------------------------
// FX that make sense to draw as a continuous automation curve. Excludes None/Off,
// MIDI CC, the random/break utility FX, and chord — these aren't curve-shaped.
const NON_AUTOMATABLE = new Set(['-', '!', 'a', 'b', 'c', 'd', 'e', 'f', 'x', '0']);

export interface AutomatableFx {
  symbol: string;
  name: string;
  lo: number;
  hi: number;
  scaled: boolean;
}

export const AUTOMATABLE_FX: AutomatableFx[] = PatternFX.filter((r) => !NON_AUTOMATABLE.has(r.symbol)).map((r) => {
  const dr = fxDisplayRange(r);
  return { symbol: r.symbol, name: r.name, lo: dr.lo, hi: dr.hi, scaled: dr.scaled };
});

//----------------------------------
// FX display range helper
//----------------------------------
/** The user-facing [lo, hi] range for an FX, and whether values are scaled. */
export function fxDisplayRange(rec: FXRecord): { lo: number; hi: number; scaled: boolean } {
  if (rec.scaled) return { lo: rec.scaled.min, hi: rec.scaled.max, scaled: true };
  return { lo: rec.min, hi: rec.max, scaled: false };
}

//----------------------------------
// Range type
//----------------------------------
export interface StepRange {
  /** First step (inclusive). */
  from: number;
  /** Last step (inclusive). */
  to: number;
}

function clampRange(range: StepRange, numSteps: number): StepRange {
  const from = Math.max(0, Math.min(range.from, range.to));
  const to = Math.min(numSteps - 1, Math.max(range.from, range.to));
  return { from, to };
}

//----------------------------------
// Apply a single curve to one FX lane across a range
//----------------------------------
export interface ApplyCurveOptions {
  track: number;
  range: StepRange;
  fx: string; // symbol or name
  curveId?: string;
  /** A curve function, taking precedence over curveId (used by parametric effects). */
  curveFn?: CurveFn;
  /** Which FX lane to write into (0 or 1). Default 0. */
  lane?: number;
  /** Value range in the FX's natural (display) domain. Defaults to the full FX range. */
  lo?: number;
  hi?: number;
  /** Lay a note on each step so note-based FX are audible. Default false. */
  withNotes?: boolean;
  note?: number;
  instrument?: number;
  seed?: number;
}

export function applyCurve(pattern: PatternData, opts: ApplyCurveOptions): number {
  const track = pattern.tracks[opts.track];
  if (!track) return 0;
  const numSteps = track.length + 1;
  const { from, to } = clampRange(opts.range, numSteps);
  const lane = Math.max(0, Math.min(opts.lane ?? 0, MAX_FX_LANES - 1));
  const rec = fxRecord(opts.fx);
  const dr = fxDisplayRange(rec);
  const lo = opts.lo ?? dr.lo;
  const hi = opts.hi ?? dr.hi;
  const curve = opts.curveFn ?? CURVES_BY_ID[opts.curveId ?? '']?.fn ?? CURVES_BY_ID['ramp-up'].fn;
  const rng = new Rng(mixSeed(opts.seed ?? 1, opts.track));

  let written = 0;
  const span = to - from;
  for (let s = from; s <= to; s++) {
    const step = track.steps[s];
    if (!step) continue;
    const t = span === 0 ? 0 : (s - from) / span;
    const v = lo + (hi - lo) * curve(t, rng);
    step.fx[lane] = makeFx(opts.fx, v, { scaled: dr.scaled });
    // Only seed a note on empty steps, so existing notes are never clobbered.
    if (opts.withNotes && step.note < 0) {
      step.note = opts.note ?? 48;
      step.instrument = opts.instrument ?? 0;
    }
    written++;
  }
  return written;
}

/** Clear both FX lanes across a track range (the empty/None state). */
export function clearRange(pattern: PatternData, trackIndex: number, range: StepRange): number {
  const track = pattern.tracks[trackIndex];
  if (!track) return 0;
  const { from, to } = clampRange(range, track.length + 1);
  let n = 0;
  for (let s = from; s <= to; s++) {
    const step = track.steps[s];
    if (!step) continue;
    step.fx[0] = makeNone();
    step.fx[1] = makeNone();
    n++;
  }
  return n;
}

//----------------------------------
// Effects: named, parameterized audio effects (within MAX_FX_LANES)
//----------------------------------
export interface EffectLane {
  fx: string; // symbol or name
  curveId?: string;
  curve?: CurveFn;
  /** Natural-domain start/end values. */
  lo: number;
  hi: number;
}

/** A user-tweakable knob on an effect. */
export interface EffectParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  unit?: string;
}

export interface EffectDef {
  id: string;
  name: string;
  description: string;
  /** Knobs the UI renders as sliders. */
  params: EffectParam[];
  /** Build the FX lanes for the current param values. */
  lanes: (p: Record<string, number>) => EffectLane[];
  /** Lay notes across the range so the effect is audible on an empty pattern. */
  withNotes?: boolean;
}

/** Default value for each param. */
export function defaultParams(def: EffectDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.id, p.default]));
}

/** Guard: every effect must fit MAX_FX_LANES at its default params. */
function effect(def: EffectDef): EffectDef {
  const n = def.lanes(defaultParams(def)).length;
  if (n > MAX_FX_LANES) {
    throw new Error(`Effect "${def.id}" uses ${n} FX lanes; max is ${MAX_FX_LANES}`);
  }
  return def;
}

export const EFFECTS: EffectDef[] = [
  effect({
    id: 'tape-stop',
    name: 'Tape Stop',
    description: 'Tempo collapses while pitch bends down — the classic reel grinding to a halt.',
    params: [
      { id: 'fromTempo', label: 'From', min: 60, max: 300, default: 180, unit: 'BPM' },
      { id: 'toTempo', label: 'To', min: 8, max: 120, default: 8, unit: 'BPM' },
      { id: 'pitchBend', label: 'Pitch bend', min: 0, max: 99, default: 99, unit: '¢' },
    ],
    lanes: (p) => [
      { fx: 'T', curveId: 'exp-decay', lo: p.toTempo, hi: p.fromTempo },
      { fx: 'M', curveId: 'ramp-down', lo: -p.pitchBend, hi: 0 },
    ],
    withNotes: true,
  }),
  effect({
    id: 'riser',
    name: 'Riser',
    description: 'Pitch climbs and volume swells into a hit — a build-up.',
    params: [
      { id: 'pitchRise', label: 'Pitch rise', min: 0, max: 99, default: 99, unit: '¢' },
      { id: 'volStart', label: 'Vol start', min: 0, max: 100, default: 20, unit: '%' },
    ],
    lanes: (p) => [
      { fx: 'M', curveId: 'exp-rise', lo: 0, hi: p.pitchRise },
      { fx: 'V', curveId: 'ramp-up', lo: p.volStart, hi: 100 },
    ],
    withNotes: true,
  }),
  effect({
    id: 'filter-drop',
    name: 'Filter Drop',
    description: 'Low-pass closes down to a muffle, then opens — a breakdown sweep.',
    params: [{ id: 'floor', label: 'Dip to', min: 0, max: 80, default: 0, unit: '%' }],
    lanes: (p) => [{ fx: 'L', curveId: 'swell', lo: 100, hi: p.floor }],
    withNotes: true,
  }),
  effect({
    id: 'fade-out',
    name: 'Fade Out',
    description: 'Volume rides smoothly to silence across the range.',
    params: [
      { id: 'from', label: 'From', min: 0, max: 100, default: 100, unit: '%' },
      { id: 'to', label: 'To', min: 0, max: 100, default: 0, unit: '%' },
    ],
    lanes: (p) => [{ fx: 'V', curveId: 'ramp-down', lo: p.to, hi: p.from }],
    withNotes: true,
  }),
  effect({
    id: 'pan-sweep',
    name: 'Pan Sweep',
    description: 'Sound travels across the stereo field.',
    params: [
      { id: 'fromPan', label: 'From', min: -50, max: 50, default: -50, unit: 'L/R' },
      { id: 'toPan', label: 'To', min: -50, max: 50, default: 50, unit: 'L/R' },
    ],
    lanes: (p) => [{ fx: 'P', curveId: 'ramp-up', lo: p.fromPan, hi: p.toPan }],
    withNotes: true,
  }),
  effect({
    id: 'gate-chop',
    name: 'Gate Chop',
    description: 'Gate length stutters on/off for a trance-gate rhythm.',
    params: [
      { id: 'rate', label: 'Rate', min: 1, max: 8, step: 1, default: 4, unit: '×' },
      { id: 'depth', label: 'Depth', min: 0, max: 100, default: 0, unit: '%' },
    ],
    lanes: (p) => [{ fx: 'q', curve: squareCurve(p.rate), lo: p.depth, hi: 100 }],
    withNotes: true,
  }),
  effect({
    id: 'wobble',
    name: 'Wobble',
    description: 'Low-pass cutoff oscillates — a dubstep-style LFO wobble.',
    params: [
      { id: 'rate', label: 'Rate', min: 1, max: 12, step: 1, default: 4, unit: '×' },
      { id: 'floor', label: 'Floor', min: 0, max: 80, default: 10, unit: '%' },
    ],
    lanes: (p) => [{ fx: 'L', curve: sineCurve(p.rate), lo: p.floor, hi: 100 }],
    withNotes: true,
  }),
];

export const EFFECTS_BY_ID: Record<string, EffectDef> = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

export interface ApplyEffectOptions {
  track: number;
  range: StepRange;
  seed?: number;
  /** Param values; missing keys fall back to each param's default. */
  params?: Record<string, number>;
  /** Override the effect's own withNotes default. */
  withNotes?: boolean;
  note?: number;
  instrument?: number;
}

/**
 * Drop a named effect onto a track range. Clears the step FX in range first,
 * then writes the effect's parameterized lanes — so the result is exactly the
 * dropped effect at the chosen settings.
 */
export function applyEffect(pattern: PatternData, effectId: string, opts: ApplyEffectOptions): number {
  const def = EFFECTS_BY_ID[effectId];
  if (!def) throw new Error(`Unknown effect: "${effectId}"`);
  const track = pattern.tracks[opts.track];
  if (!track) return 0;
  const numSteps = track.length + 1;
  const { from, to } = clampRange(opts.range, numSteps);
  const withNotes = opts.withNotes ?? def.withNotes ?? false;
  const params = { ...defaultParams(def), ...opts.params };
  const lanes = def.lanes(params).slice(0, MAX_FX_LANES);

  // Clear FX lanes (and optionally place notes) across the range first.
  for (let s = from; s <= to; s++) {
    const step = track.steps[s];
    if (!step) continue;
    step.fx[0] = makeNone();
    step.fx[1] = makeNone();
    if (withNotes && step.note < 0) {
      step.note = opts.note ?? 48;
      step.instrument = opts.instrument ?? 0;
    }
  }

  // Write each effect lane (note placement already done above).
  let total = 0;
  lanes.forEach((laneDef, i) => {
    total += applyCurve(pattern, {
      track: opts.track,
      range: { from, to },
      fx: laneDef.fx,
      curveId: laneDef.curveId,
      curveFn: laneDef.curve,
      lane: i,
      lo: laneDef.lo,
      hi: laneDef.hi,
      seed: opts.seed,
    });
  });
  return total;
}

//----------------------------------
// Graph data: read FX values for visualization
//----------------------------------
export interface SeriesPoint {
  step: number;
  /** Raw stored value, or null if the lane is empty (None). */
  raw: number | null;
  /** Display value (scaled if applicable), or null. */
  display: number | null;
  /** Value normalized to 0..1 across the FX's range, or null. */
  norm: number | null;
  symbol: string;
}

/** Read one FX lane of a track as a plottable series for the line graph. */
export function laneSeries(pattern: PatternData, trackIndex: number, lane: number): SeriesPoint[] {
  const track = pattern.tracks[trackIndex];
  if (!track) return [];
  const numSteps = track.length + 1;
  const out: SeriesPoint[] = [];
  for (let s = 0; s < numSteps; s++) {
    const fx = track.steps[s]?.fx[lane];
    if (!fx || fx.type.symbol === '-') {
      out.push({ step: s, raw: null, display: null, norm: null, symbol: '-' });
      continue;
    }
    const rec = fx.type;
    const range = rec.max - rec.min || 1;
    const norm = (fx.value - rec.min) / range;
    const dr = fxDisplayRange(rec);
    const display = dr.scaled ? dr.lo + (dr.hi - dr.lo) * norm : fx.value;
    out.push({ step: s, raw: fx.value, display: Math.round(display), norm, symbol: rec.symbol });
  }
  return out;
}
