# M8 FX Wizard

A browser web app that **simulates the Dirtywave M8's step FX in phrases and
tables**, and lets you **build effects by describing them in plain language**.

Edit a phrase/table grid, hit play, and watch (and hear) a single voice step
through ticks while each FX command mutates pitch, volume, and triggering exactly
as the M8 manual describes. Or type *"machine-gun stutter"* / *"slide into the
note"* / *"swing"* and the wizard writes the real FX commands into the grid and
explains them.

There's also a **Chord Lab** modelled on the M8 Hypersynth. Per the manual the
Hypersynth holds **16 chord banks of up to 6 intervals**; you define the banks in
the instrument and sequence chord changes by selecting which bank is active (the
`CHORD` parameter / its instrument FX) — the M8-native way, *not* the MIDI-only
`CHD` command (which belongs to the MIDI-Out instrument). The lab mirrors that: a
**16-bank editor** (name each bank, toggle/scrub its voice offsets, `SWARM`
detune, `SHIFT` cross-fade, `SUBOSC` sub, `WIDTH` stereo spread) and a sequencer
where each step is a **root + which bank to shift to**. Generate a progression
(pop, jazz ii–V–I, lo-fi, blues…), pick a play style (block / arp / strum), and
hear it polyphonically; optional diatonic-snap keeps everything in key. You can
also **drive the Hypersynth from a phrase** — set the phrase Instrument to
*Hypersynth chords* and each NOTE plays a chord, with the `HSC` FX
selecting/shifting the bank. And throughout you can **drag any value to hear it
change** live — voice offsets, roots, rates, gates, FX bytes.

## Run it

It's plain HTML/CSS/JS with no build step. Either:

```bash
# open directly
open index.html            # macOS  (or just double-click it)

# or serve (any static server works)
npx serve .                # then visit the printed URL
python3 -m http.server 8000
```

Click **▶ PLAY** (the first click also starts Web Audio).

## Getting it onto the M8

This is a **design + simulation** tool — it does **not** write to the M8. The
patch you build here reaches the device by **transcription**: you read the values
off the screen (they're already in M8 form — hex FX codes, Hypersynth voice
offsets, bank numbers) and key them in.

The **build sheet** button makes that fast: it opens a plain-text summary of the
whole patch — project tempo/groove, every non-empty phrase step and table row
with their FX, and the Hypersynth banks + root→bank sequence — ready to copy or
download as `.txt` and work through on the device. For the exact button-by-button
steps, see **[`reference/recreate-on-m8.md`](reference/recreate-on-m8.md)**
(formulaic: add a Hypersynth instrument, set its banks, enter the phrase FX, …).

Why no file export yet: the M8 stores songs/instruments as binary `.m8s`/`.m8i`
files. The community library [`m8-js`](https://github.com/whitlockjc/m8-js) can
write them, but the current release only covers firmware ≤ 2.7.8 and has **no
Hypersynth instrument type** (Hypersynth is a 4.x feature) — so a reliable
chord-bank `.m8i` can't be generated without a known-good reference file to
validate against. Honest transcription beats an unverifiable binary. (Web MIDI
play-through to a USB-connected M8 is a possible future live bridge.)

## What it models

- **Timing:** 24 PPQN, 6 ticks per 16th-note step, `tick = 60 / (BPM × 24)` —
  straight from the manual's Groove View math. Grooves change ticks-per-step.
- **Phrases vs tables:** the phrase grid runs at the groove's step rate; the
  table grid runs **per-tick** at its `TIC` rate alongside the held note — the
  M8's real distinction, and why arps/envelopes live in tables.
- **A monophonic synth voice + FX bus** — osc → instrument lowpass → amp
  envelope → (dry + delay send + reverb send) → master DJ filter → out. So
  retrigs, arps, slides, vibrato, kills, bends, **delay throws, reverb washes,
  and filter sweeps** are all audible. An *illustration* of an M8 signal path,
  not a clone of its synth engines.
- **Scale quantization** — `SCA`/`SCG` snap pitches into one of 14 scales
  (major, minor, modes, pentatonics, blues, whole-tone) so random/arp material
  stays in key.
- **Shareable patches** — your work autosaves to the browser; **share link**
  encodes the whole patch (grid + tempo + groove + osc + chords) into the URL,
  and **copy patch** gives you a portable code.
- **Chord Lab (Hypersynth-accurate)** — the M8 Hypersynth holds **16 chord banks
  of up to 6 intervals** (manual, p.60); you define the banks and sequence chord
  changes by switching the active `CHORD` bank via its instrument FX — *not* the
  MIDI-only `CHD` command. The lab is a 16-bank editor (name each bank,
  toggle/scrub voices, `SWARM`/`SHIFT`/`SUBOSC`) feeding a sequencer where each
  step is a **root + the bank to shift to**, with 8-voice polyphony and optional
  diatonic snap. Diatonic generators (pop, doo-wop, sad, jazz ii–V–I, lo-fi 7ths,
  epic minor, andalusian, 12-bar blues, random) populate banks and shift the
  sequence between the right ones; play styles cover block / arp
  (up/down/up-down/random) / strum, with rate, gate, and reverb/delay space — all
  live-draggable.
- **Drag-to-scrub** — vertical drag on any numeric value (FX bytes, velocity,
  table N/V, chord roots, all the chord controls) nudges it live while it plays;
  a plain click still types. Shift = coarse.

### FX coverage

Fully simulated: `ARP ARC PSL PBN PVB PVX PIT FIN TSP VOL RET KIL OFF DEL CHA
RND TPO GRV GGR HOP TIC SED SCA SCG VMV VDE VRE XDF DJC DJR DJT`. Partially
modeled: `NTH RNL THO REP RTO MTT XDT XRS XRD XRZ`. Shown for reference (not
synthesized by this toy voice): `VMX TBL TBX INS SNG RMX NXT`.

Every command in the on-page **FX reference** is tagged `full` / `partial` /
`ref` and `high` / `med` confidence so you always know what to trust.

## Accuracy & sources

FX semantics come from the **M8 Operation Manual** (`reference/m8_operation_manual.pdf`,
v2026-04-21) — "Sequencer FX Commands", Table View, and Groove View — plus the
community **Tips, Tricks & Findings** notes (`reference/tips-tricks-findings.md`)
for behaviors the manual leaves implicit (FX precedence right→left, tables-first,
DEL priority, RND being additive/per-nibble, the 303 recipe, etc.).

**To refine anything:** all FX behavior is data-driven in **`js/fx.js`** — one
entry per command with its hooks. That's the single place to correct a value
range or slew curve.

## Project layout

```
index.html          — layout + script tags (no bundler)
styles/app.css      — M8-flavoured theme
js/notes.js         — note ↔ frequency ↔ "C-4", hex/signed helpers
js/scales.js        — M8 scale tables + quantizer (SCA/SCG)
js/chords.js        — chord theory: qualities, voicings, progression generators
js/fx.js            — the FX command registry (semantics live here)
js/audio.js         — 8-voice Web Audio synth + delay/reverb/DJ-filter bus
js/engine.js        — the tick sequencer: track mode (phrase+table) + chord mode
js/wizard.js        — "describe an effect" → FX recipes
js/app.js           — UI: grid editor, Chord Lab, scrub, transport, scope, wizard
reference/          — the manual PDF + distilled community tips
test-smoke.mjs      — headless smoke test: FX, scales, share round-trip
test-chords.mjs     — headless smoke test: Chord Lab, polyphony, scrub
test-driving.mjs    — headless smoke test: phrase-driven Hypersynth + width
```

## Status

v3 — core sequencer FX, audible delay/reverb/DJ-filter bus, scale quantization,
shareable patches, the description wizard, plus a polyphonic Chord Lab and
drag-to-scrub editing. Not
affiliated with Dirtywave. Manual content © Dirtywave; Macrosynth model text is
CC BY-SA 3.0 (Mutable Instruments) where quoted.
