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
  curveId: string;
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
  const curve = CURVES_BY_ID[opts.curveId]?.fn ?? CURVES_BY_ID['ramp-up'].fn;
  const rng = new Rng(mixSeed(opts.seed ?? 1, opts.track));

  let written = 0;
  const span = to - from;
  for (let s = from; s <= to; s++) {
    const step = track.steps[s];
    if (!step) continue;
    const t = span === 0 ? 0 : (s - from) / span;
    const v = lo + (hi - lo) * curve(t, rng);
    step.fx[lane] = makeFx(opts.fx, v, { scaled: dr.scaled });
    if (opts.withNotes) {
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
// Effects: named audio effects built from up to MAX_FX_LANES FX lanes
//----------------------------------
export interface EffectLane {
  fx: string; // symbol or name
  curveId: string;
  /** Natural-domain start/end values. */
  lo: number;
  hi: number;
}

export interface EffectDef {
  id: string;
  name: string;
  description: string;
  lanes: EffectLane[];
  /** Lay notes across the range so the effect is audible on an empty pattern. */
  withNotes?: boolean;
}

/** All effects are authored to fit within MAX_FX_LANES; this guards against regressions. */
function effect(def: EffectDef): EffectDef {
  if (def.lanes.length > MAX_FX_LANES) {
    throw new Error(`Effect "${def.id}" uses ${def.lanes.length} FX lanes; max is ${MAX_FX_LANES}`);
  }
  return def;
}

export const EFFECTS: EffectDef[] = [
  effect({
    id: 'tape-stop',
    name: 'Tape Stop',
    description: 'Tempo collapses while pitch bends down — the classic reel grinding to a halt.',
    lanes: [
      { fx: 'T', curveId: 'exp-decay', lo: 8, hi: 220 }, // Tempo: high → crawl (scaled BPM)
      { fx: 'M', curveId: 'ramp-down', lo: -99, hi: 0 }, // Micro-tune: bends down to -99c
    ],
    withNotes: true,
  }),
  effect({
    id: 'riser',
    name: 'Riser',
    description: 'Pitch climbs and volume swells into a hit — a build-up.',
    lanes: [
      { fx: 'M', curveId: 'exp-rise', lo: 0, hi: 99 },
      { fx: 'V', curveId: 'ramp-up', lo: 20, hi: 100 },
    ],
    withNotes: true,
  }),
  effect({
    id: 'filter-drop',
    name: 'Filter Drop',
    description: 'Low-pass closes down to a muffle, then opens — a breakdown sweep.',
    lanes: [{ fx: 'L', curveId: 'swell', lo: 100, hi: 0 }],
    withNotes: true,
  }),
  effect({
    id: 'fade-out',
    name: 'Fade Out',
    description: 'Volume rides smoothly to silence across the range.',
    lanes: [{ fx: 'V', curveId: 'ramp-down', lo: 100, hi: 0 }],
    withNotes: true,
  }),
  effect({
    id: 'pan-sweep',
    name: 'Pan Sweep',
    description: 'Sound travels hard left to hard right.',
    lanes: [{ fx: 'P', curveId: 'ramp-up', lo: -50, hi: 50 }],
    withNotes: true,
  }),
  effect({
    id: 'gate-chop',
    name: 'Gate Chop',
    description: 'Gate length stutters on/off for a trance-gate rhythm.',
    lanes: [{ fx: 'q', curveId: 'gate-4', lo: 0, hi: 100 }],
    withNotes: true,
  }),
  effect({
    id: 'wobble',
    name: 'Wobble',
    description: 'Low-pass cutoff oscillates — a dubstep-style LFO wobble.',
    lanes: [{ fx: 'L', curveId: 'sine-4', lo: 10, hi: 100 }],
    withNotes: true,
  }),
];

export const EFFECTS_BY_ID: Record<string, EffectDef> = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

export interface ApplyEffectOptions {
  track: number;
  range: StepRange;
  seed?: number;
  /** Override the effect's own withNotes default. */
  withNotes?: boolean;
  note?: number;
  instrument?: number;
}

/**
 * Drop a named effect onto a track range. Clears the step FX in range first,
 * then writes the effect's lanes — so the result is exactly the dropped effect.
 */
export function applyEffect(pattern: PatternData, effectId: string, opts: ApplyEffectOptions): number {
  const def = EFFECTS_BY_ID[effectId];
  if (!def) throw new Error(`Unknown effect: "${effectId}"`);
  const track = pattern.tracks[opts.track];
  if (!track) return 0;
  const numSteps = track.length + 1;
  const { from, to } = clampRange(opts.range, numSteps);
  const withNotes = opts.withNotes ?? def.withNotes ?? false;

  // Clear FX lanes (and optionally place notes) across the range first.
  for (let s = from; s <= to; s++) {
    const step = track.steps[s];
    if (!step) continue;
    step.fx[0] = makeNone();
    step.fx[1] = makeNone();
    if (withNotes) {
      step.note = opts.note ?? 48;
      step.instrument = opts.instrument ?? 0;
    }
  }

  // Write each effect lane via applyCurve (note placement already done above).
  let total = 0;
  def.lanes.forEach((laneDef, i) => {
    total += applyCurve(pattern, {
      track: opts.track,
      range: { from, to },
      fx: laneDef.fx,
      curveId: laneDef.curveId,
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
