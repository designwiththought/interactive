# FX Forge

> **Populate a Polyend Tracker pattern with FX to create a specific effect.**

FX Forge is a browser-based pattern tool for the [Polyend Tracker](https://polyend.com/).
Pick a sample on your Tracker, pick an **effect** here — Stutter Fill, Tape Warble,
Ghost Echo, Acid Slide… — and FX Forge fills the pattern's FX columns to create that
sound. It treats **the step-FX column as the instrument**: the variety comes from
sequenced effects (Roll, Chance, Glide, Micro-tune, Reverse, LFOs, sends…), not from
notes. Output is a real `.mtp` file that loads on the hardware.

It is a fork of [`tracker-mtp-editor`](https://github.com/sandroidmusic/tracker-mtp-editor)
(MIT) with a generative **Forge** engine built on top. The familiar editor still works —
forge an effect, then hand-tweak any step. See `docs/CONCEPT.md` for the full design.

## How it works

The hardware allows **two FX per step**, drawn from tracker-lib's 43-entry FX table.
The Forge engine composes small **generators** (place an FX on a grid, ramp a value,
random-walk it, cluster it into a fill, gate it by probability…) into named **presets**,
then writes the result into the two FX lanes of every step — only on steps that carry a
note, so the effects actually do something.

```
src/forge/                 ← the engine (pure TypeScript, no Vue, no DOM)
  rng.ts          seeded PRNG — (seed + preset) is fully reproducible
  fx.ts           tracker-lib FX lookup + scaled↔raw value conversion
  generators.ts   everyN · euclidFx · chance · ramp · drift · burst · pingpong · trigger
  recipe.ts       applyRecipe(pattern, recipe) — resolves contributions into 2 FX lanes
  presets.ts      the named effects (Stutter Fill, Tape Warble, …)
  shapes.ts       automation curves + audio effects (Tape Stop, Riser…) + graph data
  index.ts        forge(pattern, presetId, { seed })
  smoke.test.mjs  runs the engine against real tracker-lib patterns
src/components/PatternEditor.vue   ← forked editor + Forge controls + Grid/Graph toggle
src/components/FxGraph.vue         ← line-graph view & interactive effect builder
```

The engine is intentionally decoupled from the UI: `applyRecipe()` mutates a tracker-lib
`PatternData` in place and is exercised headless by `smoke.test.mjs`, so it can also back a
CLI or other front-ends later.

### Presets

| Preset | What it does | FX used |
|---|---|---|
| **Stutter Fill** | Four-on-the-floor hits, retrigger Rolls bursting into the bar end, velocity swell | `R` `V` `r` |
| **Tape Warble** | Sustained notes detuned by a slow micro-tune drift + glide — wow & flutter | `M` `G` |
| **Ghost Echo** | Sparse euclidean hits fading into growing delay + reverb sends | `s` `t` |
| **Acid Slide** | Every-step notes glued by Glide with a sweeping filter LFO — squelch | `G` `j` |
| **Probability Engine** | Chance-gated steps with random note/volume — re-rolls live on every loop | `C` `n` `v` |
| **Granular Cloud** | Long source scanned by a Position LFO, ping-pong panned, occasional reverse | `k` `P` `r` |

"Re-roll" bumps the seed for a fresh variation of the same effect. Same seed + same preset
always reproduces the exact same pattern.

## Visual tools (Graph view)

Toggle **View → Graph** for an alternate, automation-style view of a track: the two FX
lanes drawn as line graphs over the steps. Click two steps to set a range, then:

- **Drop an effect** — pick a named audio effect and drop it onto the range. Each effect
  declares which FX lanes it uses, shown as a live budget (e.g. Tape Stop = `T + M (2/2)`):

  | Effect | What it does | FX |
  |---|---|---|
  | **Tape Stop** | Tempo collapses while pitch bends down | `T` `M` |
  | **Riser** | Pitch climbs + volume swells into a hit | `M` `V` |
  | **Filter Drop** | Low-pass closes to a muffle then opens | `L` |
  | **Fade Out** | Volume rides to silence | `V` |
  | **Pan Sweep** | Travels hard left → right | `P` |
  | **Gate Chop** | Trance-gate on/off stutter | `q` |
  | **Wobble** | Dubstep-style filter LFO | `L` |

- **Build a custom effect** — assign an automation **curve** (Ramp, Exp Decay, Swell,
  Sine LFO, Gate, Random…) to each FX lane. The builder enforces the **2-FX-per-step**
  limit: lane 2 is the budget ceiling, and applying clears the range first so the result
  is exactly what you drew.

> **FX-per-step limit.** The `.mtp` format stores **two** FX per step (`fx[0]`, `fx[1]`),
> which is what `MAX_FX_LANES` encodes. If your firmware/device supports more, bump that one
> constant in `src/forge/recipe.ts` and the budget propagates everywhere.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173

npm run test:forge   # run the engine smoke test against real tracker-lib
npm test             # format check + lint + typecheck + forge test
npm run build        # production build → dist/
```

In the app: **Forge FX** populates the current pattern (creating an 8×16 one if none is
loaded), the dropdown picks the effect, **Re-roll** varies the seed, and **Save Pattern**
writes the `.mtp`.

## Status

Working and verified against tracker-lib `0.1.2` (12-check smoke test + a browser run):

- Generative engine — 6 forge presets + the recipe/generator stack.
- Graph view — line-graph of the two FX lanes, range selection, 7 drop-in audio effects,
  and a lane-budget-aware custom effect builder.

Next on the roadmap (`docs/CONCEPT.md`): a Web Audio preview, per-effect parameter knobs,
`.pti`/`.mt` bundling, and shareable `preset+seed` URLs.

## License & attribution

MIT. Forked from [`tracker-mtp-editor`](https://github.com/sandroidmusic/tracker-mtp-editor)
by Sandro "Sandroid" Ducceschi — original license preserved in `LICENSE.upstream`. Powered
by [`@polyend/tracker-lib`](https://github.com/polyend/tracker-lib).
