# M8 FX Wizard

A browser web app that **simulates the Dirtywave M8's step FX in phrases and
tables**, and lets you **build effects by describing them in plain language**.

Edit a phrase/table grid, hit play, and watch (and hear) a single voice step
through ticks while each FX command mutates pitch, volume, and triggering exactly
as the M8 manual describes. Or type *"machine-gun stutter"* / *"slide into the
note"* / *"swing"* and the wizard writes the real FX commands into the grid and
explains them.

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

## What it models

- **Timing:** 24 PPQN, 6 ticks per 16th-note step, `tick = 60 / (BPM × 24)` —
  straight from the manual's Groove View math. Grooves change ticks-per-step.
- **Phrases vs tables:** the phrase grid runs at the groove's step rate; the
  table grid runs **per-tick** at its `TIC` rate alongside the held note — the
  M8's real distinction, and why arps/envelopes live in tables.
- **A monophonic synth voice** (osc → lowpass → amp envelope) so retrigs, arps,
  slides, vibrato, kills, and bends are audible — an *illustration* of an M8
  voice, not a clone of its synth engines.

### FX coverage (v1: core sequencer FX)

Fully simulated: `ARP ARC PSL PBN PVB PVX PIT FIN TSP VOL RET KIL OFF DEL CHA
RND TPO GRV GGR HOP TIC SED`. Partially modeled: `NTH RNL THO REP RTO SCA SCG
MTT`. Shown for reference (not synthesized by this toy voice): mixer/send FX
(`VMV VMX VDE VRE XDT XDF XRS XRD XRZ DJC …`) and `TBL TBX INS SNG RMX NXT`.

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
js/fx.js            — the FX command registry (semantics live here)
js/audio.js         — one Web Audio synth voice
js/engine.js        — the tick sequencer: groove, phrase, table, FX state
js/wizard.js        — "describe an effect" → FX recipes
js/app.js           — UI: grid editor, transport, scope, wizard, reference
reference/          — the manual PDF + distilled community tips
test-smoke.mjs      — headless Chromium smoke test (needs playwright-core)
```

## Status

v1 — core sequencer FX, audible + visual, with the description wizard. Not
affiliated with Dirtywave. Manual content © Dirtywave; Macrosynth model text is
CC BY-SA 3.0 (Mutable Instruments) where quoted.
