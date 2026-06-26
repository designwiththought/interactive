# Recreating your wizard patch on the M8

The wizard mirrors the M8, so everything you built here transcribes onto the
device. Open the **build sheet** (button in the app) — it lists every value in
M8 form — and work top to bottom through the steps below.

> **Notation.** An FX is a 3-letter command + 2 hex digits, e.g. `ARP47`,
> `RET02`, `PVB32`. Notes look like `C-4`. Chord-bank voice offsets look like
> `+0 +4 +7` (a `·` means that voice is off).

---

## 0 · Navigation primer

- **Move between views:** hold `SHIFT` + `LEFT/RIGHT` to step through
  **Song → Chain → Phrase → Table → Instrument**. Hold `SHIFT` + `UP` to reach
  **Groove/Scale** (above Phrase) and **Project** (above Song).
- **Edit a value:** `EDIT` + `LEFT/RIGHT` = small step, `EDIT` + `UP/DOWN` =
  large step. `EDIT` on an empty cell inserts one. `OPT` + `EDIT` = delete / reset
  to default.
- **Pick an FX command:** put the cursor on an FX **command** column and press
  `EDIT` + `UP/DOWN` to open the **Effect Command Help** picker, choose the
  command, then set the two hex digits as its value.

---

## 1 · Project (tempo / groove / scale)

From the build sheet's `PROJECT` line:

1. Go to **Project** view (`SHIFT`+`UP` from Song).
2. Set **TEMPO** to the sheet's BPM.
3. If the groove isn't `00`, set **GROOVE** to that number (build the groove in
   the Groove view first if it's a custom one).
4. If the sheet shows a scale, set **SCALE**.

---

## 2 · The Hypersynth instrument (if your patch uses chords)

Only the **Hypersynth** makes chords internally, and the chord lives in the
instrument as voice offsets. From the sheet's `HYPERSYNTH INSTRUMENT` block:

1. **Instrument** view → pick an empty slot (`OPT`+`LEFT/RIGHT` to navigate).
2. Set **TYPE** = `HYPERSYNTH`.
3. Set **NAME**.
4. Set the params to the sheet's values: **SWARM**, **SHIFT**, **SUBOSC**,
   **WIDTH**, and **SCALE** (the Hypersynth's own scale select).
5. Open the **CHORD** editor and, for each bank on the sheet (`00`, `01`, …):
   - Select the bank number.
   - Enter its interval offsets (e.g. `+0 +4 +7`).
   - For any voice shown as `·` (off), set that voice's offset to `00` and press
     `OPT`+`EDIT` to deactivate it.
6. If your patch used a table, set **TABLE TIC** to the sheet's `TIC` value.

> The Hypersynth holds **16 chord banks** — define as many as the sheet lists.

---

## 3 · Phrase (notes + FX)

For each non-empty step in the sheet's `PHRASE` block:

1. In **Phrase** view, go to that step row (`00`–`0F`).
2. **N** (note): set it (`EDIT`+`LEFT/RIGHT` = semitone, `EDIT`+`UP/DOWN` =
   octave).
3. **I** (instrument): set the instrument number (your Hypersynth, or whatever
   instrument you're using). Leave blank to change pitch without re-triggering.
4. **V** (velocity): set it if the sheet shows a value (default is `64`).
5. **FX1 / FX2 / FX3:** on each FX column, `EDIT`+`UP` to open the command
   picker, choose the command, then dial the two hex digits. Type them exactly as
   the sheet shows (e.g. `ARP47`).

Repeat for every listed step. Empty steps stay empty.

---

## 4 · Table (per-tick FX / envelopes / arps)

If the sheet's `TABLE` block has rows:

1. Make sure the instrument's **TABLE TIC** matches the sheet (Instrument view,
   or a `TIC` command on the table's last row).
2. Go to **Table** view (`SHIFT`+`RIGHT` from Phrase).
3. For each row: set **N** (transpose) and **V** (volume) from the sheet, then
   enter the FX columns exactly as in the phrase step above.

---

## 5 · Sequencing chord changes (root → bank)

The sheet's `sequence (root → bank)` line shows which chord plays where. How you
enter it depends on how you built the patch:

**A. One bank, just play roots** (you used a single shape / diatonic snap):
1. Set the Hypersynth to that one bank.
2. In the phrase, place the **root NOTE** on each step with the Hypersynth in the
   `I` column. Each note sounds the whole chord.

**B. Shifting banks per chord** (different shape per step):
1. In the **Instrument** view, highlight the **CHORD** parameter, then
   `SHIFT`+`RIGHT` into the phrase — the FX column's default command is now the
   **CHORD bank-select** for that instrument.
2. On each step, place the **root NOTE** and add that CHORD-bank FX with the
   **bank number** from the sheet.

> In the wizard this bank-select is written as **`HSCxx`** (an app stand-in). On
> the device it's the Hypersynth **CHORD** parameter's own FX command, set as in
> step B.1 — the `xx` value is the bank number.

---

## Quick checklist

- [ ] Project: tempo, groove, scale
- [ ] Hypersynth instrument: type, params, all chord banks
- [ ] Phrase: notes, instrument, velocity, FX
- [ ] Table: TIC, N/V, FX
- [ ] Chord sequence: roots + bank changes

Tip: keep the build sheet open beside the device. Every hex value on it is
exactly what you type — there's no conversion to do.
