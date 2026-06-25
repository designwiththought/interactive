//---------------------------------------------------
//
//  Generators
//
//  A Generator decides, per step, what it wants to contribute to that step:
//  a note (the sound source), an instrument, and/or an FX placement. The
//  engine (recipe.ts) runs a stack of generators over every step and resolves
//  their contributions into the two FX lanes the hardware allows.
//
//  These are the composable building blocks. Presets (presets.ts) wire them
//  together into named, musical effects.
//
//---------------------------------------------------
import type { FX } from '@polyend/tracker-lib';
import { Rng } from './rng.ts';
import { makeFx, type FxOptions } from './fx.ts';

//----------------------------------
// Interfaces
//----------------------------------
export interface ForgeCtx {
  /** Step index within the track (0-based). */
  step: number;
  /** Total playable steps in the track. */
  numSteps: number;
  /** Track index (0-based). */
  track: number;
  /** Total tracks being forged. */
  numTracks: number;
  /** Steps per beat (for grid / beat-aware generators). */
  stepsPerBeat: number;
  /** Per-track seeded RNG. */
  rng: Rng;
  /** Tempo, for time-aware generators. */
  bpm: number;
}

export interface Contribution {
  note?: number;
  instrument?: number;
  fx?: FX;
  /** Higher wins when competing for the note slot or the 2 FX lanes. */
  priority?: number;
}

export interface Generator {
  readonly id: string;
  apply(ctx: ForgeCtx): Contribution | null;
  /** Called once per track before its steps are evaluated (for stateful generators). */
  reset?(): void;
}

//----------------------------------
// Helpers
//----------------------------------
/** Bjorklund / Euclidean rhythm: distribute `hits` as evenly as possible across `len` steps. */
export function euclid(hits: number, len: number): boolean[] {
  if (len <= 0) return [];
  hits = Math.max(0, Math.min(hits, len));
  const pattern: boolean[] = [];
  let bucket = 0;
  for (let i = 0; i < len; i++) {
    bucket += hits;
    if (bucket >= len) {
      bucket -= len;
      pattern.push(true);
    } else {
      pattern.push(false);
    }
  }
  return pattern;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

//----------------------------------
// Note / source generators
//----------------------------------
export interface TriggerOptions {
  note?: number; // tracker note value (48 = C4)
  instrument?: number;
  every?: number; // place a note every N steps
  offset?: number; // grid offset
  euclidHits?: number; // if set, use a euclidean distribution instead of a fixed grid
  priority?: number;
}

/** Lays down the notes that the FX will act on — the actual sound source. */
export function trigger(opts: TriggerOptions = {}): Generator {
  const { note = 48, instrument = 0, every = 4, offset = 0, euclidHits, priority = 100 } = opts;
  let mask: boolean[] | null = null;
  return {
    id: 'trigger',
    reset() {
      mask = null;
    },
    apply(ctx) {
      let hit: boolean;
      if (euclidHits != null) {
        if (!mask || mask.length !== ctx.numSteps) mask = euclid(euclidHits, ctx.numSteps);
        hit = mask[ctx.step];
      } else {
        hit = (ctx.step - offset) % every === 0 && ctx.step >= offset;
      }
      return hit ? { note, instrument, priority } : null;
    },
  };
}

//----------------------------------
// FX placement generators
//----------------------------------
export interface GridOptions extends FxOptions {
  every?: number;
  offset?: number;
  priority?: number;
}

/** Place a fixed FX value on a regular grid (e.g. a Roll on every 4th step). */
export function everyN(symbol: string, value: number, opts: GridOptions = {}): Generator {
  const { every = 4, offset = 0, priority = 50, scaled } = opts;
  return {
    id: `everyN:${symbol}`,
    apply(ctx) {
      const hit = (ctx.step - offset) % every === 0 && ctx.step >= offset;
      return hit ? { fx: makeFx(symbol, value, { scaled }), priority } : null;
    },
  };
}

/** Spread `hits` placements of an FX evenly across the track (Euclidean). */
export function euclidFx(
  symbol: string,
  value: number,
  hits: number,
  opts: FxOptions & { priority?: number } = {},
): Generator {
  const { priority = 50, scaled } = opts;
  let mask: boolean[] | null = null;
  return {
    id: `euclidFx:${symbol}`,
    reset() {
      mask = null;
    },
    apply(ctx) {
      if (!mask || mask.length !== ctx.numSteps) mask = euclid(hits, ctx.numSteps);
      return mask[ctx.step] ? { fx: makeFx(symbol, value, { scaled }), priority } : null;
    },
  };
}

/** Place an FX probabilistically — the seeded dice decide each step. */
export function chance(
  symbol: string,
  value: number,
  p: number,
  opts: FxOptions & { priority?: number } = {},
): Generator {
  const { priority = 40, scaled } = opts;
  return {
    id: `chance:${symbol}`,
    apply(ctx) {
      return ctx.rng.chance(p) ? { fx: makeFx(symbol, value, { scaled }), priority } : null;
    },
  };
}

/** Interpolate an FX value linearly across the track (e.g. a velocity swell, an opening filter). */
export function ramp(
  symbol: string,
  from: number,
  to: number,
  opts: FxOptions & { priority?: number } = {},
): Generator {
  const { priority = 45, scaled } = opts;
  return {
    id: `ramp:${symbol}`,
    apply(ctx) {
      const t = ctx.numSteps <= 1 ? 0 : ctx.step / (ctx.numSteps - 1);
      return { fx: makeFx(symbol, lerp(from, to, t), { scaled }), priority };
    },
  };
}

/** Random-walk an FX value around a center (great for analog-style micro-tune / filter drift). */
export function drift(
  symbol: string,
  center: number,
  depth: number,
  opts: FxOptions & { priority?: number } = {},
): Generator {
  const { priority = 45, scaled } = opts;
  let value = center;
  return {
    id: `drift:${symbol}`,
    reset() {
      value = center;
    },
    apply(ctx) {
      value += ctx.rng.bipolar() * depth;
      value = Math.max(center - depth * 3, Math.min(center + depth * 3, value));
      return { fx: makeFx(symbol, value, { scaled }), priority };
    },
  };
}

/** Cluster an FX into a window near the end of the track — fills, build-ups, stutters. */
export function burst(
  symbol: string,
  value: number,
  opts: FxOptions & { window?: number; density?: number; priority?: number } = {},
): Generator {
  const { window = 0.25, density = 0.6, priority = 55, scaled } = opts;
  return {
    id: `burst:${symbol}`,
    apply(ctx) {
      const pos = ctx.numSteps <= 1 ? 0 : ctx.step / (ctx.numSteps - 1);
      if (pos < 1 - window) return null;
      return ctx.rng.chance(density) ? { fx: makeFx(symbol, value, { scaled }), priority } : null;
    },
  };
}

/** Alternating panning that can widen over the track — stereo motion from a mono source. */
export function pingpong(width = 50, opts: { every?: number; priority?: number; widen?: boolean } = {}): Generator {
  const { every = 2, priority = 35, widen = false } = opts;
  return {
    id: 'pingpong',
    apply(ctx) {
      const side = Math.floor(ctx.step / every) % 2 === 0 ? -1 : 1;
      const amount = widen && ctx.numSteps > 1 ? width * (ctx.step / (ctx.numSteps - 1)) : width;
      return { fx: makeFx('P', side * amount, { scaled: true }), priority };
    },
  };
}
