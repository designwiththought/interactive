# FX Forge — a generative step-FX sequencer for Polyend Tracker

> **One sample in. A pattern's worth of motion out.**
> FX Forge turns a single, even *boring* sample into evolving patterns by
> generatively composing Polyend Tracker's per-step effects — chance, roll,
> glide, micro-tune, reverse, arp, randomization — and writing real `.mtp`
> patterns (plus a matching `.pti` instrument and `.mt` project) you can drop
> straight onto a Tracker, Tracker Mini, or Tracker+.

Built on [`@polyend/tracker-lib`](https://github.com/polyend/tracker-lib).

---

## 1. The idea in one paragraph

On the Polyend Tracker, the most interesting sounds rarely come from the
notes — they come from the **step FX column**: a probability here, a retrigger
roll there, a glide into the next step, a micro-tuned detune, a reversed
one-shot. Programming those by hand, step by step, is slow and easy to make
*samey*. **FX Forge is the inverse workflow**: you pick a sample and a vibe, and
the tool *sequences the FX for you* — generatively, musically, and editably —
then exports a pattern file the hardware reads natively. It's a sound-design
sketchpad that treats **effects as the instrument**.

This directly matches the request: *"an effects tool that can create different
sounds in patterns based on fx sequenced."* The FX are the composition.

---

## 2. Why it's cool / why it doesn't exist yet

- **FX-first, not note-first.** Every other tracker generator throws notes at
  you. FX Forge keeps the pitch material minimal (often one note, one sample)
  and finds the variety in *modulation* — which is how the best Tracker patches
  actually sound alive.
- **Hardware-native output.** No MIDI export, no "import and reprogram." It
  writes `.mtp`/`.pti`/`.mt` that load on the device as-is, because `tracker-lib`
  models the real file formats including **step-level FX/automation commands**.
- **Deterministic + seeded.** Same seed + same recipe = same pattern. Great for
  sharing "presets" as a tiny text seed instead of a binary file.
- **Teaches the instrument.** Because each generated step shows *which* FX and
  *why*, it doubles as a way to learn what Chance/Roll/Glide/Arp actually do.

---

## 3. What `tracker-lib` gives us (grounding)

From the library's API surface:

| Capability | API (per README) | We use it to… |
|---|---|---|
| Create instrument from WAV | `Tracker.createInstrument()` | Wrap the user's sample as a `.pti` |
| Read existing instrument | `Tracker.readInstrument()` | Let users start from a `.pti` they own |
| Serialize instrument | `Tracker.writeInstrument()` | Export the `.pti` |
| WAV metadata | `AudioUtil.getWavInfo()` | Sample rate / length → slice + timing math |
| Patterns | `.mtp` read/write (tracks, steps, **step-level FX/automation**) | The core: write the FX sequence |
| Projects | `.mt` read/write (songs, headers, metadata) | Bundle pattern + instrument into a loadable project |
| Instrument detail | slices, playback modes, filters, LFOs, envelopes, granular/wavetable | Pair FX moves with matching instrument settings |

> **Open verification item:** confirm the exact pattern/step write API and the
> FX-command enum names in `src/patterns` and `src/types` before locking the
> adapter layer (see §9). The design below is structured so *all* hardware
> specifics live behind one thin module.

### The FX palette we sequence

These are the real Polyend per-step effects FX Forge composes
([reference](https://help.polyend.com/090274-What-step-effects-are-available-in-the-Polyend-Tracker)):

| Code | FX | Range | Generative use |
|---|---|---|---|
| `V` | Velocity | 0–100% | Accent patterns, ghost notes |
| `P` | Panning | L50–R50 | Ping-pong / stereo motion |
| `M` | Micro-tune | ±99 cents | Detune drift, "analog" wobble |
| `G` | Glide | 0–15s | Slides between consecutive steps |
| `T` | Tempo | 10–400 BPM | Mid-pattern tempo flips |
| `I` | Swing | 25–75% | Groove humanization |
| `m` | Micro-move | 0–100% | Off-grid nudges / flams |
| `q` | Gate length | 0–100% | Staccato vs. legato shaping |
| `C` | Chance | 0–100% | The star: probabilistic variation |
| `R` | Roll | 0–16 | Retrigger stutters / fills |
| `A` | Arp | tempo divider | Turn one step into a run |
| `n` | Random Note | ±0–100 | Controlled pitch chaos |
| `i` | Random Instrument | ±0–47 | Timbre roulette |
| `f` | Random FX value | — | Modulate the modulation |
| `v` | Random Volume | ±0–100 | Living dynamics |
| `r` | Reverse | — | Backwards one-shots |
| `!` | Off | — | Cancel a held FX |

---

## 4. The generative model — "Recipes"

The heart of FX Forge is a small, composable DSL of **FX generators** that each
decide, per step, whether to place an effect and with what value. A **Recipe** is
an ordered stack of generators evaluated against a seeded PRNG.

```ts
// conceptual — not final API
type StepCtx = { index: number; len: number; rng: Rng; bpm: number };
type FxOp    = { code: FxCode; value: number } | null;

interface Generator {
  name: string;
  apply(ctx: StepCtx): FxOp;     // returns an FX to place on this step (or null)
}
```

**Built-in generators (the fun part):**

- `everyN(n, fx)` — place an FX on a fixed grid (e.g. roll on every 4th step).
- `chance(p, fx)` — only place when `rng() < p`; or emit an actual `C` Chance FX
  so the *hardware* rolls the dice live.
- `euclid(hits, len, fx)` — Euclidean distribution of an FX across the pattern.
- `ramp(fx, from, to)` — interpolate a value across the pattern (e.g. velocity
  swell, opening gate length).
- `drift(fx, depth)` — random walk a value (perfect for micro-tune wobble).
- `burst(fx, density)` — clustered fills (rolls/arps) near phrase ends.
- `mirror(fx)` — palindrome a value sequence for call-and-response.
- `pingpong()` — alternating pan L/R, optionally widening over time.

**Recipe = stack + weights + seed:**

```ts
const recipe = forge.recipe("glassy-drift", { len: 16, seed: 0xC0FFEE, bpm: 120 })
  .add(ramp("V", 40, 100))            // swell in
  .add(drift("M", 12))               // ±12c detune wander
  .add(euclid(5, 16, "R", { roll: 3 })) // 5 stutters, evenly spread
  .add(chance(0.25, "r"))            // occasional reverse
  .add(everyN(8, "G", { glide: 30 })); // glide into the downbeat
```

**Vibe presets** ship as named recipes so a non-expert can just pick a mood:

- **Glitch Bath** — heavy Roll + Random FX + Reverse, low Chance.
- **Dub Tails** — sparse hits, long Glide, panning drift, gate-length swells.
- **Acid Wriggle** — Micro-tune drift + Glide chains + Arp bursts.
- **Ghost Choir** — Chance-gated low-velocity ghosts + ping-pong pan.
- **Broken Tape** — Random Note + Reverse + tempo flips for lo-fi wow/flutter.

Each preset is just data, so the community can share recipes as JSON or seeds.

---

## 5. Architecture

```
fx-forge/
  core/
    rng.ts            — seeded, deterministic PRNG (mulberry32 / xoshiro)
    generators.ts     — the FX generator DSL (§4)
    recipe.ts         — recipe builder + evaluation engine
    presets.ts        — named "vibe" recipes
  adapter/            — the ONLY place that touches tracker-lib internals
    instrument.ts     — WAV → .pti via Tracker.createInstrument()
    pattern.ts        — FxOp[][] → .mtp step/FX writes
    project.ts        — bundle into .mt
    fxmap.ts          — our FxCode  <->  tracker-lib's FX enum
  cli/
    index.ts          — `fxforge build sample.wav --recipe dub-tails --seed 42`
  web/                — optional browser playground (see §6)
  examples/
```

**Design rule:** the generative core is *pure* and hardware-agnostic — it emits
an abstract `FxOp[][]` grid (steps × tracks). The `adapter/` layer is the single
seam that maps that grid onto real `tracker-lib` calls. If the library's pattern
API differs from assumptions, only `adapter/` changes.

---

## 6. Surfaces

### A. CLI (MVP)
```bash
fxforge build kick.wav \
  --recipe glitch-bath --seed 1312 --len 32 --bpm 140 \
  --out ./out         # writes out/instrument.pti, out/pattern.mtp, out/project.mt
fxforge dice kick.wav --recipe dub-tails        # re-roll seeds, print the seed
fxforge explain out/pattern.mtp                 # human-readable FX-per-step table
```

### B. Browser playground (the "wow")
A single static page (this repo already ships a tiny SSG and runs `tracker-lib`
in the browser):
- Drag a WAV in, pick a vibe, hit **Forge**.
- A **step grid** lights up showing each placed FX with its code + value.
- **Web Audio preview** approximates Roll/Reverse/Glide/Chance so you can *hear*
  the pattern before exporting (preview ≠ exact hardware, and that's stated).
- **Re-roll**, **lock a track**, **nudge a generator's weight**, **download**
  the `.pti` + `.mtp` + `.mt`.
- Share button encodes `recipe+seed+sampleHash` into a URL.

---

## 7. A concrete walkthrough

1. User drops `clap.wav`. `AudioUtil.getWavInfo()` reports 44.1k / 0.3s.
2. They pick **Dub Tails**, seed `42`, 16 steps, 75 BPM.
3. Core evaluates the recipe → an `FxOp[][]` grid, e.g. step 4: `C 60` (60%
   chance), step 7: `G 40` (glide), steps 12–15: `V` ramp 30→100, step 16: `r`
   (reverse tail).
4. `adapter/instrument.ts` wraps `clap.wav` into a `.pti` with a gentle amp
   envelope + low-pass to suit the dubby vibe.
5. `adapter/pattern.ts` writes those FX onto the steps of an `.mtp`.
6. `adapter/project.ts` bundles both into `project.mt`.
7. User copies the folder to the Tracker SD card → loads → it plays, evolving on
   every loop because the `C`/`R`/random FX re-roll live on hardware.

---

## 8. Roadmap

**MVP (v0.1) — prove the seam**
- [ ] Verify `tracker-lib` pattern-write + FX enum (§9).
- [ ] `adapter/` writes a 1-track `.mtp` with hand-set FX → loads on device.
- [ ] Seeded PRNG + 4 generators (`everyN`, `chance`, `ramp`, `drift`).
- [ ] CLI `build` producing `.pti` + `.mtp` + `.mt`.
- [ ] 3 vibe presets + `explain` command.

**v0.2 — make it musical**
- [ ] Euclid/burst/pingpong/mirror generators; multi-track grids.
- [ ] Per-track locking & weighting; phrase-aware fills.
- [ ] Browser playground with step-grid visualization + downloads.

**v0.3 — make it shareable & audible**
- [ ] Web Audio preview engine (approximate Roll/Glide/Reverse/Chance).
- [ ] Shareable `recipe+seed` URLs; import others' recipes.
- [ ] Instrument-aware recipes (pair Glide with mono/legato, Reverse with slices).

**Stretch**
- [ ] "FX-ify" mode: read an existing `.mtp` and *add* generative FX to it.
- [ ] Song mode: chain pattern variants into an `.mt` arrangement.
- [ ] Wavetable/granular presets that co-modulate with the FX sequence.

---

## 9. Open questions / risks

1. **Exact pattern + FX write API.** README confirms step-level FX/automation
   exist; we must confirm the concrete functions and enum names in
   `src/patterns` + `src/types`. *Mitigation:* all specifics behind `adapter/`.
2. **FX value encoding.** Each FX's on-device value range/units must map to the
   file's stored representation. *Mitigation:* a single `fxmap.ts` table with
   round-trip tests (write → read → compare).
3. **Preview fidelity.** Browser preview can only *approximate* hardware
   behavior (especially live Chance/random). *Mitigation:* label it "preview,"
   make export the source of truth.
4. **Sample format constraints.** `.pti` likely expects specific WAV
   bit-depth/mono. *Mitigation:* validate + transcode with `getWavInfo()` up
   front; clear errors.
5. **Device version differences.** Tracker vs. Mini vs. Plus may differ in FX
   support. *Mitigation:* a capability profile per target device.

---

## 10. Why this is a good first build on `tracker-lib`

It exercises the library's three core file types (`.pti`, `.mtp`, `.mt`) and its
headline feature — **step-level FX automation** — while keeping the surface area
small (one sample, one pattern). The generative core is pure and testable with
zero hardware, and the hardware-specific risk is quarantined to one adapter
module. It's genuinely fun, demoable in a browser, and produces artifacts you
can play on real hardware the same afternoon.

---

### Sources
- Polyend Tracker library — <https://github.com/polyend/tracker-lib>
- Step effects reference — <https://help.polyend.com/090274-What-step-effects-are-available-in-the-Polyend-Tracker>
- Tracker manual — <https://polyend.com/manuals/tracker/>
