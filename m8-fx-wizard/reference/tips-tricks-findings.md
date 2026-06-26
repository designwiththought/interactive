# M8 Tips, Tricks & Findings — FX-relevant excerpts

Community knowledge (Discord meetups, Elektronauts, forums) distilled to the parts
that matter for the **FX Wizard**. The full manual lives at `../m8_manual.pdf`.
Source attributions are kept where given.

## FX precedence (trash80, Discord)
- FX commands execute **right → left** within a row (← ← ←).
- **Tables run first, then the phrase.**
- **DEL has the highest priority** of anything. Modifier FX (CHA, RND/RAN) do **not**
  affect DEL.
- **Groove does not apply to tables** — only to phrases.

## Tables
- Each table: 16 rows of `N` (transpose), `V` (volume, *multiplied* with phrase V),
  and 3 FX columns. Loops at the bottom while the instrument is held.
- Table TIC modes: `TIC00` advances on every note trigger; `TIC01–TICFB` = ticks per
  row; `TICFC` octave-map; `TICFD` velocity-map; `TICFE` note-map; `TICFF` runs at
  **200 Hz regardless of tempo** (great for fast envelopes/decays).
- **Tables as arps:** put offsets in the `N` column, set TIC to taste (Meetup #2).
- **Tables as envelopes:** `VOL` then `REP` to ramp at tick rate; `REP` *interpolates*
  between values; `HOP` holds a value without changing it.
- **Random note tables:** fill `N` with candidate offsets, put `HOP00` on a row and
  `RND` on the others so each trigger jumps to a random transpose (older firmware: RAN).
- A value in the instrument `I` column re-triggers the instrument, restarting the table
  and reverting any `TBL`. Leave `I` blank to change note/pitch without restarting.

## Grooves
- Default groove `00` is `06,06` → 24 PPQN, 6 ticks per 16th step, 96 ticks/phrase.
- A row of `00` **skips** that phrase step; an empty row loops the groove.
- Swing: `07,05` or `08,04`. Triplet/polyrhythm grooves: make each 4 steps total 24
  ticks (the UI shows 96). Examples for 4x-tempo polyrhythms in the source doc.

## Sequencing / pitch tricks
- **Glissando:** play a note with a blank `I` column (changes pitch without retrigger)
  combined with `PSL`. Equivalent: `PIT` + `PSL`.
- **303 bassline (mikey303):** `KIL03` on the step before any new note that isn't a
  tie/slide; `PSL06` is a good slide time (the real 303 varies with interval distance);
  add an accent behavior.
- **Tape stop / backspin:** combine `PIT` + `PSL` on a sampler; backspin adds reverse.
- **Understanding DEL:** only one active DEL at a time (an overlapping DEL replaces it);
  can delay by more than a step, even into later phrases; highest priority so CHA/RND
  don't touch it.
- **Understanding RAN/RND:** additive, relative, unipolar. In `RNDxy` the x and y
  nibbles randomize independently. `RND20` → 00/10/20 only; `RND26` → 0–2 for x and
  0–6 for y. Randomize each digit of a two-param FX independently
  (e.g. `PVB00` + `RND32` jitters vibrato speed 0–3 and depth 0–2).
- **Random quantised melodies:** `CHA` (chance) + `PIT` on a note step gives a
  probability the note fires *and* a probability the pitch changes.

## Envelope-style tricks (pre/post true-ADSR)
- Ramp the `V` column down for a release; `HOx`/`DEx` to shape hold/decay.
- `TICFF` table = ~200 Hz, ideal for snappy transients and superfast decays.
- Things that invalidate an AHD envelope: `KIL`, note retrigger (`RET`), the sound being
  shorter than the envelope, or Envelope Amount/`ETx` = 0.

> Excerpted for the FX Wizard. The original community doc also covers samplers, FM,
> Macrosynth, mixing, MIDI, and external tools — out of scope here.
