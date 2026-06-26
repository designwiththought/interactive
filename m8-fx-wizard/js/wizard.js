/* wizard.js — "describe an effect, get the FX commands".
 * Each recipe writes notes/FX into the phrase or table via the `api` the app
 * provides, and returns a plain-language explanation tied to the manual. */
(function (M8) {
  'use strict';
  function hx(x, y) { return ((x & 0xf) << 4) | (y & 0xf); }

  var RECIPES = [
    // ---------------- pitch movement ----------------
    {
      id: 'arp-major', group: 'Pitch movement', label: 'Bright major arpeggio',
      tags: ['arp', 'arpeggio', 'major', 'chord', 'bright', 'happy'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'ARP', hx(4, 7));
        return 'ARP47 on C-4 rips a 3-note major triad — C-4, E-4 (+4), G-4 (+7) — one note per tick. Change the two nibbles to reshape the chord.';
      }
    },
    {
      id: 'arp-minor', group: 'Pitch movement', label: 'Moody minor arpeggio',
      tags: ['arp', 'minor', 'sad', 'dark'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'ARP', hx(3, 7));
        return 'ARP37 → C-4, D#4 (+3), G-4 (+7): a minor triad arpeggio (this is the manual\'s own example).';
      }
    },
    {
      id: 'arp-oct', group: 'Pitch movement', label: 'Octave-jump arpeggio',
      tags: ['arp', 'octave', 'jump', 'wide'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-3'); a.pfx(0, 0, 'ARP', hx(0, 12)); a.pfx(0, 1, 'ARC', hx(0, 3));
        return 'ARP0C bounces root → root → +12 (octave). ARC03 slows it to every 3 ticks so the octave bounce is audible.';
      }
    },
    {
      id: 'vibrato-soft', group: 'Pitch movement', label: 'Gentle vibrato',
      tags: ['vibrato', 'wobble', 'soft', 'expressive', 'pvb'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'A-4'); a.pfx(0, 0, 'PVB', hx(3, 2));
        return 'PVB32 — speed 3, depth 2. Vibrato is continuous, so it keeps wobbling under the note. Crank X for faster, Y for deeper.';
      }
    },
    {
      id: 'vibrato-wide', group: 'Pitch movement', label: 'Seasick wide wobble',
      tags: ['vibrato', 'extreme', 'wide', 'pvx', 'seasick'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'A-4'); a.pfx(0, 0, 'PVX', hx(4, 8));
        return 'PVX is vibrato with an extreme range. PVX48 swings several semitones — great for woozy/detuned textures.';
      }
    },
    {
      id: 'bend-up', group: 'Pitch movement', label: 'Pitch rise',
      tags: ['bend', 'rise', 'up', 'pbn', 'riser'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-3'); a.pfx(0, 0, 'PBN', 0x20);
        return 'PBN with 00–7F bends continuously up (0x20 = a steady rise). Use 80–FF to dive down.';
      }
    },
    {
      id: 'bend-down', group: 'Pitch movement', label: 'Dive bomb',
      tags: ['bend', 'dive', 'down', 'drop', 'fall', 'pbn'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-5'); a.pfx(0, 0, 'PBN', 0x90);
        return 'PBN90 sits in the 80–FF range, so the pitch continuously falls — a classic dive bomb.';
      }
    },
    {
      id: 'gliss', group: 'Pitch movement', label: 'Glissando between notes',
      tags: ['slide', 'gliss', 'glissando', 'portamento', 'psl', 'legato'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-3'); a.note(4, 'G-4'); a.pfx(4, 0, 'PSL', 0x0a);
        return 'PSL enables portamento: when the G-4 hits on step 4, PSL0A glides up from the C-3 over 10 ticks instead of jumping. Lower values = faster slide.';
      }
    },
    {
      id: 'detune', group: 'Pitch movement', label: 'Microtonal detune',
      tags: ['detune', 'fine', 'fin', 'microtonal', 'quarter tone'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'FIN', 0x40);
        return 'FIN offsets pitch within ±1 semitone. FIN40 ≈ a quarter-tone up. FINC0 (signed −) nudges down.';
      }
    },

    // ---------------- rhythm / trigger ----------------
    {
      id: 'retrig-fast', group: 'Rhythm & triggers', label: 'Machine-gun retrigger',
      tags: ['retrig', 'ret', 'stutter', 'roll', 'machine gun', 'fast'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'RET', hx(0, 2));
        return 'RET02 retriggers the note every 2 ticks — a fast drum/roll stutter. The Y nibble is the tick gap.';
      }
    },
    {
      id: 'retrig-fade', group: 'Rhythm & triggers', label: 'Stutter that fades out',
      tags: ['retrig', 'fade', 'ramp', 'down', 'roll'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'RET', hx(3, 4));
        return 'RET34: Y=4 ticks between retrigs, X=3 (in the 0–7 range) ramps the volume DOWN each hit — a decaying roll.';
      }
    },
    {
      id: 'retrig-build', group: 'Rhythm & triggers', label: 'Stutter that builds up',
      tags: ['retrig', 'build', 'crescendo', 'up', 'riser'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'RET', hx(0xc, 4));
        return 'RETC4: X=C is in the 8–F range, so each retrig gets LOUDER — a building roll into the next hit.';
      }
    },
    {
      id: 'kill-tight', group: 'Rhythm & triggers', label: 'Tight, choppy notes',
      tags: ['kil', 'kill', 'choppy', 'staccato', 'tight', 'gate'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'KIL', 0x04);
        return 'KIL04 hard-cuts the note 4 ticks after it starts — instant staccato. (KIL also invalidates the amp envelope.)';
      }
    },
    {
      id: 'note-off', group: 'Rhythm & triggers', label: 'Release / let it ring then off',
      tags: ['off', 'release', 'note off', 'envelope'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'OFF', 0x0c);
        return 'OFF12 (0x0C ticks) triggers the envelope RELEASE rather than a hard cut — softer tails than KIL.';
      }
    },
    {
      id: 'delay-echo', group: 'Rhythm & triggers', label: 'Pushed / delayed hit',
      tags: ['del', 'delay', 'push', 'late', 'swing', 'echo'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.note(4, 'C-4'); a.pfx(4, 0, 'DEL', 0x03);
        return 'DEL03 delays the whole step by 3 ticks — the second hit lands late. DEL has the highest FX priority and ignores CHA/RND.';
      }
    },

    // ---------------- groove / tempo ----------------
    {
      id: 'swing', group: 'Groove & tempo', label: 'Add swing',
      tags: ['swing', 'groove', 'grv', 'shuffle'], grid: 'phrase',
      apply: function (a) {
        a.reset();
        for (var i = 0; i < 16; i += 2) a.note(i, 'C-4');
        a.pfx(0, 0, 'GRV', 0x01);
        return 'GRV01 selects a 07,05 swing groove (held until changed). Even steps get 7 ticks, odd steps 5 — that long-short feel.';
      }
    },
    {
      id: 'triplet', group: 'Groove & tempo', label: 'Triplet feel',
      tags: ['triplet', 'groove', 'grv', '3'], grid: 'phrase',
      apply: function (a) {
        a.reset();
        for (var i = 0; i < 16; i += 1) a.note(i, 'C-4');
        a.pfx(0, 0, 'GRV', 0x04);
        return 'GRV04 uses an 08,08,08 groove (8 ticks/step) for a rolling triplet feel against the 4/4 grid.';
      }
    },
    {
      id: 'tempo', group: 'Groove & tempo', label: 'Set tempo (mid-song)',
      tags: ['tempo', 'tpo', 'bpm', 'slow', 'fast', 'speed'], grid: 'phrase',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4'); a.pfx(0, 0, 'TPO', 0x5a);
        return 'TPO5A sets the tempo to 90 BPM (0x5A = 90). The help line on the M8 shows the decimal — drop a TPO anywhere to ramp speed.';
      }
    },

    // ---------------- chance / random ----------------
    {
      id: 'maybe', group: 'Chance & random', label: 'Note that plays sometimes',
      tags: ['cha', 'chance', 'probability', 'maybe', 'random', 'sometimes'], grid: 'phrase',
      apply: function (a) {
        a.reset();
        for (var i = 0; i < 16; i += 2) a.note(i, 'C-4');
        a.pfx(2, 0, 'CHA', hx(8, 0xf));
        return 'CHA8F gives the note on step 2 a ~50% (8/F) chance of triggering. Play it a few times — it won\'t always fire.';
      }
    },
    {
      id: 'glitch-pitch', group: 'Chance & random', label: 'Random pitch glitches',
      tags: ['rnd', 'random', 'glitch', 'pitch', 'chaos'], grid: 'phrase',
      apply: function (a) {
        a.reset();
        for (var i = 0; i < 16; i += 1) a.note(i, 'C-4');
        a.pfx(0, 0, 'PIT', 0x00); a.pfx(0, 1, 'RND', hx(0, 0xc));
        return 'PIT00 sets a 0-semitone offset, then RND0C (to its right) adds a random 0–12 semitones to it each trigger — random upward pitch jumps. RND is additive and per-nibble.';
      }
    },

    // ---------------- table (per-tick) ----------------
    {
      id: 'table-arp', group: 'Tables (per-tick)', label: 'Table arpeggio',
      tags: ['table', 'arp', 'tick', 'per tick'], grid: 'table',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4');
        a.tableTic(0x03);
        a.tn(0, 0); a.tn(1, 4); a.tn(2, 7); a.tn(3, 12);
        return 'The classic M8 arp: put offsets in the table\'s N (transpose) column and set the table TIC. Here TIC03 advances every 3 ticks through 0, +4, +7, +12 while the note holds.';
      }
    },
    {
      id: 'table-decay', group: 'Tables (per-tick)', label: 'Volume decay envelope',
      tags: ['table', 'envelope', 'decay', 'volume', 'fade'], grid: 'table',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4');
        a.tableTic(0x02);
        a.tv(0, 0xff); a.tv(1, 0xc0); a.tv(2, 0x80); a.tv(3, 0x50); a.tv(4, 0x28); a.tv(5, 0x10); a.tv(6, 0x00);
        a.tfx(6, 0, 'HOP', 0x06);
        return 'A custom envelope built in the V column: volume steps down each table tick (TIC02). HOP06 on the last row holds it at silence. Tables are how you shape amplitude per-tick on the M8.';
      }
    },
    {
      id: 'table-vibrato', group: 'Tables (per-tick)', label: 'Always-on table vibrato',
      tags: ['table', 'vibrato', 'free running'], grid: 'table',
      apply: function (a) {
        a.reset(); a.note(0, 'C-4');
        a.tableTic(0x06);
        a.tfx(0, 0, 'PVB', hx(4, 3));
        return 'Putting PVB in a table row means the vibrato re-arms every time the table loops, keeping it running for the life of the note — handy when you want it independent of the phrase.';
      }
    },

    // ---------------- 303 ----------------
    {
      id: 'acid', group: 'Signature sounds', label: '303 acid slide+accent',
      tags: ['303', 'acid', 'bass', 'slide', 'tb-303', 'mikey303'], grid: 'phrase',
      apply: function (a) {
        a.reset();
        a.note(0, 'C-2'); a.note(2, 'C-2'); a.note(4, 'D#2'); a.pfx(4, 0, 'PSL', 0x06);
        a.note(6, 'C-2'); a.pfx(3, 0, 'KIL', 0x03); a.pfx(5, 0, 'KIL', 0x03);
        return 'The mikey303 recipe (community doc): KIL03 on the step before any non-slide note for that 303 envelope snap, and PSL06 to slide into the accented note. Add an accent via velocity for the full acid line.';
      }
    }
  ];

  function search(text) {
    text = (text || '').toLowerCase();
    if (!text.trim()) return [];
    var scored = RECIPES.map(function (r) {
      var score = 0;
      r.tags.forEach(function (t) { if (text.indexOf(t) >= 0) score += t.length; });
      if (text.indexOf(r.label.toLowerCase()) >= 0) score += 20;
      return { r: r, score: score };
    }).filter(function (x) { return x.score > 0; });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.map(function (x) { return x.r; });
  }

  function groups() {
    var g = {};
    RECIPES.forEach(function (r) { (g[r.group] = g[r.group] || []).push(r); });
    return g;
  }

  M8.wizard = { recipes: RECIPES, byId: function (id) { return RECIPES.filter(function (r) { return r.id === id; })[0]; }, search: search, groups: groups };
})(window.M8 = window.M8 || {});
