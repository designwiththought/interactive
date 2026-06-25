//---------------------------------------------------
//
//  Presets — named effects
//
//  Each preset is a recipe of generators that produces a specific, recognizable
//  sonic behavior when applied to a pattern. They are the user-facing menu:
//  pick a sample on the Tracker, pick an effect here, forge, and the FX columns
//  fill in to create that sound.
//
//  Every preset stays within the 2-FX-lanes-per-step hardware limit by design.
//
//---------------------------------------------------
import type { ForgeRecipe } from './recipe.ts';
import { trigger, everyN, chance, ramp, drift, burst, pingpong, type Generator } from './generators.ts';

export interface PresetDef {
  id: string;
  name: string;
  description: string;
  /** Symbols of the FX this effect leans on — handy for UI hints. */
  fx: string[];
  build(opts?: PresetOptions): ForgeRecipe;
}

export interface PresetOptions {
  /** Tracker note value for the source trigger (48 = C4). */
  note?: number;
  /** Instrument index (0..47 sample, 64..66 synth). */
  instrument?: number;
}

function recipe(
  id: string,
  name: string,
  description: string,
  generators: Generator[],
  extra: Partial<ForgeRecipe> = {},
): ForgeRecipe {
  return { id, name, description, generators, ...extra };
}

export const PRESETS: PresetDef[] = [
  {
    id: 'stutter-fill',
    name: 'Stutter Fill',
    description: 'Four-on-the-floor hits with retrigger Rolls bursting into the bar end and a velocity swell.',
    fx: ['R', 'V', 'r'],
    build: (o = {}) =>
      recipe('stutter-fill', 'Stutter Fill', 'Retrigger rolls + velocity swell', [
        trigger({ note: o.note ?? 48, instrument: o.instrument ?? 0, every: 4 }),
        ramp('V', 20, 100, { priority: 45 }),
        burst('R', 6, { window: 0.25, density: 0.7, priority: 60 }),
        chance('r', 1, 0.12, { priority: 30 }),
      ]),
  },
  {
    id: 'tape-warble',
    name: 'Tape Warble',
    description: 'Sustained notes detuned by a slow micro-tune drift with a touch of glide — wow & flutter.',
    fx: ['M', 'G'],
    build: (o = {}) =>
      recipe('tape-warble', 'Tape Warble', 'Micro-tune drift + glide', [
        trigger({ note: o.note ?? 48, instrument: o.instrument ?? 0, every: 2 }),
        drift('M', 0, 9, { scaled: true, priority: 50 }),
        everyN('G', 18, { every: 2, priority: 40 }),
      ]),
  },
  {
    id: 'ghost-echo',
    name: 'Ghost Echo',
    description: 'Sparse euclidean hits that fade into growing delay and reverb sends — call into a cavern.',
    fx: ['s', 't'],
    build: (o = {}) =>
      recipe('ghost-echo', 'Ghost Echo', 'Delay + reverb send swells', [
        trigger({ note: o.note ?? 48, instrument: o.instrument ?? 0, euclidHits: 5 }),
        ramp('s', 15, 85, { priority: 50 }),
        ramp('t', 0, 70, { priority: 45 }),
      ]),
  },
  {
    id: 'acid-slide',
    name: 'Acid Slide',
    description: 'Every-step notes glued together by Glide, with a sweeping low-pass filter LFO — squelch.',
    fx: ['G', 'j'],
    build: (o = {}) =>
      recipe('acid-slide', 'Acid Slide', 'Glide chains + filter LFO', [
        trigger({ note: o.note ?? 48, instrument: o.instrument ?? 0, every: 1 }),
        everyN('G', 35, { every: 1, priority: 50 }),
        everyN('j', 12, { every: 4, priority: 40 }),
      ]),
  },
  {
    id: 'probability-engine',
    name: 'Probability Engine',
    description: 'Chance-gated steps with random note + volume offsets, so the pattern re-rolls live on every loop.',
    fx: ['C', 'n', 'v'],
    build: (o = {}) =>
      recipe('probability-engine', 'Probability Engine', 'Chance + randomized note/volume', [
        trigger({ note: o.note ?? 48, instrument: o.instrument ?? 0, every: 2 }),
        everyN('C', 65, { every: 2, priority: 50 }),
        chance('n', 12, 0.5, { priority: 40 }),
        chance('v', 25, 0.5, { priority: 35 }),
      ]),
  },
  {
    id: 'granular-cloud',
    name: 'Granular Cloud',
    description: 'Long sustained source scanned by a Position LFO, ping-pong panned, with occasional reverses.',
    fx: ['k', 'P', 'r'],
    build: (o = {}) =>
      recipe('granular-cloud', 'Granular Cloud', 'Position LFO + pan + reverse', [
        trigger({ note: o.note ?? 48, instrument: o.instrument ?? 0, every: 8 }),
        everyN('k', 10, { every: 8, priority: 50 }),
        pingpong(45, { every: 2, widen: true, priority: 40 }),
        chance('r', 1, 0.2, { priority: 30 }),
      ]),
  },
];

export const PRESETS_BY_ID: Record<string, PresetDef> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): PresetDef {
  const p = PRESETS_BY_ID[id];
  if (!p) throw new Error(`Unknown preset: "${id}"`);
  return p;
}
