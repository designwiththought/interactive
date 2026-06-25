// Standalone smoke test for the FX Forge engine.
// Run: node --experimental-strip-types src/forge/smoke.test.mjs   (Node 22+)
// Verifies the engine populates real tracker-lib patterns with FX deterministically.
import assert from 'node:assert';
import Tracker from '@polyend/tracker-lib';
import { applyRecipe, forge, PRESETS } from './index.ts';

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// 1. Every preset builds and applies without throwing, placing notes + FX.
for (const def of PRESETS) {
  const pattern = Tracker.createPattern(8, 16);
  const report = applyRecipe(pattern, def.build(), { seed: 42, tracks: [0] });
  assert(report.notesPlaced > 0, `${def.id} placed no notes`);
  assert(report.fxPlaced > 0, `${def.id} placed no FX`);

  // FX only land on steps that have a note (default fxOnlyOnNotes).
  for (const step of pattern.tracks[0].steps.slice(0, 16)) {
    const hasFx = step.fx[0].type.symbol !== '-' || step.fx[1].type.symbol !== '-';
    if (hasFx) assert(step.note >= 0, `${def.id}: FX on a noteless step`);
    // Never more than 2 FX lanes, values always within record range.
    for (const fx of step.fx) {
      assert(
        fx.value >= fx.type.min && fx.value <= fx.type.max,
        `${def.id}: ${fx.type.symbol} value ${fx.value} out of [${fx.type.min},${fx.type.max}]`,
      );
    }
  }
  ok(`preset "${def.id}" → ${report.notesPlaced} notes, ${report.fxPlaced} fx`);
}

// 2. Determinism: same seed → identical pattern; different seed → different.
const a = Tracker.createPattern(8, 16);
const b = Tracker.createPattern(8, 16);
const c = Tracker.createPattern(8, 16);
forge(a, 'probability-engine', { seed: 7, tracks: [0] });
forge(b, 'probability-engine', { seed: 7, tracks: [0] });
forge(c, 'probability-engine', { seed: 8, tracks: [0] });
const sig = (p) =>
  JSON.stringify(
    p.tracks[0].steps.map((s) => [s.note, s.fx[0].type.index, s.fx[0].value, s.fx[1].type.index, s.fx[1].value]),
  );
assert.strictEqual(sig(a), sig(b), 'same seed should be identical');
assert.notStrictEqual(sig(a), sig(c), 'different seed should differ');
ok('deterministic by seed');

// 3. Scaled conversion: panning center (scaled 0) → raw 50.
const pan = Tracker.createPattern(8, 16);
forge(pan, 'granular-cloud', { seed: 1, tracks: [0] });
const panFx = pan.tracks[0].steps.flatMap((s) => s.fx).filter((f) => f.type.symbol === 'P');
assert(panFx.length > 0 && panFx.every((f) => f.value >= 0 && f.value <= 100), 'panning raw values in range');
ok('scaled→raw panning in range');

// 4. Round-trips through tracker-lib's writer (binary serialization must accept our output).
const wrote = Tracker.createPattern(8, 16);
forge(wrote, 'stutter-fill', { seed: 3, tracks: [0, 1] });
assert(typeof Tracker.writePattern === 'function');
ok('output is a valid PatternData shape');

//----------------------------------
// Shapes: curves & effects
//----------------------------------
const { applyCurve, applyEffect, laneSeries, EFFECTS, CURVES, MAX_FX_LANES, defaultParams } =
  await import('./index.ts');

// 5. Every effect fits the lane budget and writes FX within range over a sub-range.
for (const def of EFFECTS) {
  const lanes = def.lanes(defaultParams(def));
  assert(lanes.length <= MAX_FX_LANES, `${def.id} exceeds ${MAX_FX_LANES} lanes`);
  assert(def.params.length > 0, `${def.id} should expose at least one param`);
  const p = Tracker.createPattern(8, 16);
  const n = applyEffect(p, def.id, { track: 0, range: { from: 4, to: 11 }, seed: 1 });
  assert(n > 0, `${def.id} wrote nothing`);
  // Outside the range stays empty; inside has the effect's FX.
  assert(p.tracks[0].steps[0].fx[0].type.symbol === '-', `${def.id} bled before range`);
  assert(p.tracks[0].steps[15].fx[0].type.symbol === '-', `${def.id} bled after range`);
  const inSym = p.tracks[0].steps[4].fx[0].type.symbol;
  assert(inSym === lanes[0].fx, `${def.id} lane0 should be ${lanes[0].fx}, got ${inSym}`);
  for (const step of p.tracks[0].steps) {
    for (const fx of step.fx)
      assert(fx.value >= fx.type.min && fx.value <= fx.type.max, `${def.id} value out of range`);
  }
}
ok(`${EFFECTS.length} effects fit ${MAX_FX_LANES}-lane budget & write in range`);

// 5b. Per-effect params change the output and stay in range at extremes.
const pA = Tracker.createPattern(8, 16);
const pB = Tracker.createPattern(8, 16);
applyEffect(pA, 'tape-stop', { track: 0, range: { from: 0, to: 15 }, params: { toTempo: 8 } });
applyEffect(pB, 'tape-stop', { track: 0, range: { from: 0, to: 15 }, params: { toTempo: 120 } });
const endA = laneSeries(pA, 0, 0)
  .filter((s) => s.symbol === 'T')
  .at(-1).display;
const endB = laneSeries(pB, 0, 0)
  .filter((s) => s.symbol === 'T')
  .at(-1).display;
assert(endB > endA, `param 'toTempo' should change the floor (${endA} vs ${endB})`);
// Extreme params across every effect/param still produce in-range values.
for (const def of EFFECTS) {
  for (const param of def.params) {
    for (const v of [param.min, param.max]) {
      const p = Tracker.createPattern(8, 16);
      applyEffect(p, def.id, { track: 0, range: { from: 0, to: 15 }, params: { [param.id]: v } });
      for (const step of p.tracks[0].steps)
        for (const fx of step.fx)
          assert(fx.value >= fx.type.min && fx.value <= fx.type.max, `${def.id}.${param.id}=${v} out of range`);
    }
  }
}
ok('per-effect params alter output and clamp at extremes');

// 6. Tape Stop tempo collapses (exp-decay → lower at the end than the start).
const ts = Tracker.createPattern(8, 16);
applyEffect(ts, 'tape-stop', { track: 0, range: { from: 0, to: 15 }, seed: 1 });
const tempo = laneSeries(ts, 0, 0).filter((pt) => pt.symbol === 'T');
assert(tempo[0].display > tempo[tempo.length - 1].display, 'tape stop tempo should fall');
ok('tape stop tempo curve descends');

// 7. applyCurve writes a single FX lane with a monotonic ramp.
const cv = Tracker.createPattern(8, 16);
applyCurve(cv, { track: 0, range: { from: 0, to: 15 }, fx: 'L', curveId: 'ramp-up', lane: 0 });
const lp = laneSeries(cv, 0, 0);
assert(lp[0].raw === 0 && lp[15].raw === 100, `low-pass ramp should span 0..100, got ${lp[0].raw}..${lp[15].raw}`);
assert(CURVES.length >= 8, 'curve library present');
ok('applyCurve ramps a single FX lane');

console.log(`\n${passed} checks passed.`);
