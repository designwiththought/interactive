//---------------------------------------------------
//
//  Recipe engine
//
//  A ForgeRecipe is a stack of generators plus a little config. applyRecipe()
//  runs it over a PatternData in place: for every step it collects each
//  generator's contribution, resolves them into a note + the two FX lanes the
//  hardware supports, and writes the result back into the step.
//
//  This is the core of "populate a pattern with FX to create an effect".
//
//---------------------------------------------------
import type { PatternData } from '@polyend/tracker-lib';
import { Rng, mixSeed } from './rng.ts';
import { makeNone } from './fx.ts';
import type { Generator, Contribution, ForgeCtx } from './generators.ts';

export interface ForgeRecipe {
  id: string;
  name: string;
  description: string;
  generators: Generator[];
  /** Steps per beat used by beat-aware generators. Default 4 (16th notes). */
  stepsPerBeat?: number;
  /** Wipe existing FX lanes before applying. Default true. */
  clearFx?: boolean;
  /** Wipe existing notes before applying. Default false (lets you FX-ify an existing pattern). */
  clearNotes?: boolean;
  /** Only write FX onto steps that actually have a note (FX on empty steps do nothing). Default true. */
  fxOnlyOnNotes?: boolean;
  /** Restrict to specific track indices. Default: all tracks. */
  tracks?: number[];
}

export interface ForgeOptions {
  seed?: number;
  bpm?: number;
  /** Override the recipe's track targeting. */
  tracks?: number[];
}

export interface ForgeReport {
  notesPlaced: number;
  fxPlaced: number;
  fxDropped: number; // contributions that lost the 2-lane competition
  tracksTouched: number;
}

/** Hardware FX lanes per step. The .mtp format stores 2 (fx[0], fx[1]). */
export const MAX_FX_LANES = 2;

/** Apply a recipe to a pattern in place. Deterministic for a given (seed, recipe). */
export function applyRecipe(pattern: PatternData, recipe: ForgeRecipe, opts: ForgeOptions = {}): ForgeReport {
  const seed = opts.seed ?? 1;
  const bpm = opts.bpm ?? 120;
  const stepsPerBeat = recipe.stepsPerBeat ?? 4;
  const clearFx = recipe.clearFx ?? true;
  const clearNotes = recipe.clearNotes ?? false;
  const fxOnlyOnNotes = recipe.fxOnlyOnNotes ?? true;

  const allTracks = pattern.tracks.map((_, i) => i);
  const targets = opts.tracks ?? recipe.tracks ?? allTracks;

  const report: ForgeReport = { notesPlaced: 0, fxPlaced: 0, fxDropped: 0, tracksTouched: 0 };

  for (const t of targets) {
    const track = pattern.tracks[t];
    if (!track) continue;
    report.tracksTouched++;

    const numSteps = track.length + 1; // length is the index of the last step
    const rng = new Rng(mixSeed(seed, t));
    for (const gen of recipe.generators) gen.reset?.();

    for (let s = 0; s < numSteps; s++) {
      const stepData = track.steps[s];
      if (!stepData) continue;

      const ctx: ForgeCtx = { step: s, numSteps, track: t, numTracks: targets.length, stepsPerBeat, rng, bpm };

      // 1. Gather contributions
      const contributions: Contribution[] = [];
      for (const gen of recipe.generators) {
        const c = gen.apply(ctx);
        if (c) contributions.push(c);
      }

      // 2. Resolve note + instrument (highest priority wins; later wins ties)
      if (clearNotes) {
        stepData.note = -1;
        stepData.instrument = 0;
      }
      const noteContribs = contributions.filter((c) => c.note != null);
      if (noteContribs.length) {
        const winner = noteContribs.reduce((a, b) => ((b.priority ?? 0) >= (a.priority ?? 0) ? b : a));
        stepData.note = winner.note as number;
        if (winner.instrument != null) stepData.instrument = winner.instrument;
        report.notesPlaced++;
      }

      // 3. Decide whether this step is allowed to carry FX
      const hasNote = stepData.note >= 0;
      const canFx = !fxOnlyOnNotes || hasNote;

      // 4. Resolve FX into the two lanes
      if (clearFx) {
        stepData.fx[0] = makeNone();
        stepData.fx[1] = makeNone();
      }
      if (canFx) {
        const fxContribs = contributions.filter((c) => c.fx).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        fxContribs.forEach((c, i) => {
          if (i < MAX_FX_LANES) {
            stepData.fx[i] = c.fx!;
            report.fxPlaced++;
          } else {
            report.fxDropped++;
          }
        });
      } else {
        report.fxDropped += contributions.filter((c) => c.fx).length;
      }
    }
  }

  return report;
}
