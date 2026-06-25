//---------------------------------------------------
//
//  FX Forge — generative step-FX engine
//
//  Pure, framework-agnostic. Takes a tracker-lib PatternData and populates its
//  FX columns to create a specific effect. Usable from the Vue app, a CLI, or
//  tests — it never imports anything UI-related.
//
//---------------------------------------------------
import type { PatternData } from '@polyend/tracker-lib';
import { applyRecipe, type ForgeOptions, type ForgeReport } from './recipe.ts';
import { getPreset } from './presets.ts';

export * from './rng.ts';
export * from './fx.ts';
export * from './generators.ts';
export * from './recipe.ts';
export * from './presets.ts';

/** Convenience: forge a named preset onto a pattern in place. */
export function forge(pattern: PatternData, presetId: string, opts: ForgeOptions = {}): ForgeReport {
  return applyRecipe(pattern, getPreset(presetId).build(), opts);
}
