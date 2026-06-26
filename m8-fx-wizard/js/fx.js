/* fx.js — the M8 FX command registry.
 *
 * Every command's text semantics are taken verbatim-in-spirit from the M8
 * Operation Manual (v2026-04-21), "Sequencer FX Commands" and the Table View /
 * Groove View sections. Where the simulator can only approximate the hardware
 * (e.g. exact slew curves) the entry is flagged so it's obvious what to trust.
 *
 * Each entry:
 *   code       3-letter command
 *   name       human name
 *   cat        category (used for grouping/colour)
 *   xy         what the X and Y nibbles mean (help string)
 *   manual     one-line paraphrase of the manual
 *   confidence 'high' = matches manual exactly | 'med' = sensible interpretation
 *   sim        'full'   = audibly + visually simulated
 *              'partial'= simulated with caveats
 *              'ref'    = reference only (shown, not synthesized by this toy engine)
 *   scope      ['phrase','table'] where it's typically used
 *   tick(...)  present => the command is PERSISTENT (re-evaluated every engine tick)
 *   onTrigger(voice, p, ctx, state)   fired when the row is read
 *   tick(voice, p, ctx, state)        fired every tick while active
 *
 *   p = { x, y, value }   (x/y are nibbles 0..15, value is the 0..255 byte)
 *
 * The voice exposes a `mod` bag of semitone offsets the engine sums each tick:
 *   mod.pit  mod.fin  mod.arp  mod.vib  mod.bend
 * plus voice.slideTicks (portamento), voice.retScale (retrig volume), and the
 * engine-level ctx helpers documented in engine.js.
 */
(function (M8) {
  'use strict';
  var S = M8.notes.signedByte;

  // --- small helpers -------------------------------------------------------
  function depthSemis(nib, scale) { return (nib / 15) * scale; }   // vibrato depth
  function rateHz(nib, lo, hi) { return lo + (nib / 15) * (hi - lo); } // vibrato speed

  var LIST = [
    // ===================== PITCH =====================
    {
      code: 'ARP', name: 'Arpeggio', cat: 'pitch',
      xy: 'X = 1st interval (semis), Y = 2nd interval',
      manual: 'Rapid 3-note arp: root, +X, +Y. ARP37 on C-4 → C-4, D#4, G-4.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      state: function () { return { pos: 0, counter: 0 }; },
      onTrigger: function (v, p, ctx, st) { st.notes = [0, p.x, p.y]; },
      tick: function (v, p, ctx, st) {
        if (!st.notes) st.notes = [0, p.x, p.y];
        var speed = v.arpSpeed || 1;            // ticks per arp note (see ARC)
        if (st.counter++ % speed === 0) st.pos = (st.pos + 1) % 3;
        v.mod.arp = st.notes[st.pos];
      }
    },
    {
      code: 'ARC', name: 'Arpeggio Config', cat: 'pitch',
      xy: 'X = mode, Y = speed in ticks',
      manual: 'Set arp mode (X) and speed in ticks (Y).',
      confidence: 'high', sim: 'partial', scope: ['phrase', 'table'],
      onTrigger: function (v, p) { v.arpSpeed = Math.max(1, p.y); v.arpMode = p.x; }
    },
    {
      code: 'PSL', name: 'Pitch Slide', cat: 'pitch',
      xy: 'XX = slide time in ticks',
      manual: 'Enable portamento for the playing instrument; XX is in ticks.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p) { v.slideTicks = p.value; }
    },
    {
      code: 'PBN', name: 'Pitch Bend', cat: 'pitch',
      xy: 'XX = rate: 00-7F up, 80-FF down',
      manual: 'Continuous pitch slide up (00-7F) or down (80-FF) by the amount.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      tick: function (v, p, ctx) {
        // Continuous bend: accumulate semitones each tick. Scale chosen for musical feel.
        v.mod.bend += (S(p.value) / 32) * (ctx.tickDur * 24); // ~ semis/quarter-ish
      }
    },
    {
      code: 'PVB', name: 'Vibrato', cat: 'pitch',
      xy: 'X = speed, Y = depth',
      manual: 'Apply vibrato to the playing instrument; speed X, depth Y.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      state: function () { return { phase: 0 }; },
      tick: function (v, p, ctx, st) {
        st.phase += rateHz(p.x, 0.5, 9) * ctx.tickDur * 2 * Math.PI;
        v.mod.vib = depthSemis(p.y, 1.0) * Math.sin(st.phase);
      }
    },
    {
      code: 'PVX', name: 'Extreme Vibrato', cat: 'pitch',
      xy: 'X = speed, Y = depth (wide)',
      manual: 'Like PVB but with a higher, more extreme rate and depth.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      state: function () { return { phase: 0 }; },
      tick: function (v, p, ctx, st) {
        st.phase += rateHz(p.x, 1, 16) * ctx.tickDur * 2 * Math.PI;
        v.mod.vib = depthSemis(p.y, 7.0) * Math.sin(st.phase);
      }
    },
    {
      code: 'PIT', name: 'Pitch', cat: 'pitch',
      xy: 'XX = signed semitone offset',
      manual: 'Offset the note pitch in semitones.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p) { v.mod.pit = S(p.value); }
    },
    {
      code: 'FIN', name: 'Fine Tune', cat: 'pitch',
      xy: 'XX = signed, -1..+1 semitone',
      manual: 'Offset the note pitch from -1 to +1 semitones.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p) { v.mod.fin = S(p.value) / 128; }
    },
    {
      code: 'TSP', name: 'Transpose', cat: 'pitch',
      xy: 'XX = signed semitones',
      manual: 'Global song transpose (same as Project transpose).',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { ctx.track.transpose = S(p.value); }
    },

    // ===================== TRIGGER / DYNAMICS =====================
    {
      code: 'VOL', name: 'Volume', cat: 'dynamics',
      xy: 'XX = volume (00-FF)',
      manual: 'Offset the instrument volume. (Modeled here as set 00-FF → gain.)',
      confidence: 'med', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p) { v.volCmd = p.value / 0xff; }
    },
    {
      code: 'RET', name: 'Retrig', cat: 'trigger',
      xy: 'Y = ticks between retrigs, X = volume ramp (0-7 down, 8-F up). Y=0 → single retrig after X ticks.',
      manual: 'Retrigger the row with volume ramping every Y ticks; X ramps volume.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      state: function () { return { counter: 0, done: false }; },
      onTrigger: function (v, p, ctx, st) {
        st.counter = (p.y !== 0 ? p.y : Math.max(1, p.value === 0 ? 1 : p.x));
        st.single = (p.y === 0);
        st.done = false;
        v.retScale = 1;
      },
      tick: function (v, p, ctx, st) {
        if (st.done) return;
        if (--st.counter <= 0) {
          ctx.retrig();
          if (st.single) { st.done = true; return; }
          // volume ramp per retrig
          if (p.x < 8) v.retScale *= 1 - (p.x / 16);     // 0..7 -> attenuate
          else v.retScale *= 1 + ((p.x - 8) / 16);        // 8..F -> boost
          v.retScale = Math.max(0, Math.min(2, v.retScale));
          st.counter = p.y;
        }
      }
    },
    {
      code: 'KIL', name: 'Kill Note', cat: 'trigger',
      xy: 'XX = ticks until kill',
      manual: 'Stops (hard-cuts) the playing instrument after XX ticks.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { ctx.scheduleKill(p.value); }
    },
    {
      code: 'OFF', name: 'Note Off', cat: 'trigger',
      xy: 'XX = ticks until note-off',
      manual: 'Note-off after XX ticks; triggers the envelope release stage.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { ctx.scheduleOff(p.value); }
    },
    {
      code: 'DEL', name: 'Delay', cat: 'time',
      xy: 'XX = ticks to delay the row',
      manual: 'Delays the whole row by XX ticks (highest FX priority; one at a time).',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table']
      // DEL is handled specially by the engine *before* the row is triggered.
    },
    {
      code: 'MTT', name: 'Micro-time', cat: 'time',
      xy: 'XX = signed sub-ticks (1/8 tick)',
      manual: "Nudge the row's timing in ±1/8-tick sub-ticks.",
      confidence: 'high', sim: 'partial', scope: ['phrase']
      // Engine reads this as a fractional-tick trigger offset.
    },

    // ===================== RANDOM / CONDITIONAL =====================
    {
      code: 'CHA', name: 'Chance', cat: 'random',
      xy: 'X = left-side probability, Y = right-side probability (0=never … F=always)',
      manual: 'Probability the note (left) / other FX (right) trigger. 0–F.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table']
      // Handled by the engine when resolving a row (gates the note trigger).
    },
    {
      code: 'RND', name: 'Random', cat: 'random',
      xy: 'X / Y = random range added to the command on the left (per nibble)',
      manual: 'Randomizes the previous FX command; X and Y ranges are independent.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table']
      // Handled by the engine when resolving a row (mutates the left command).
    },
    {
      code: 'RNL', name: 'Randomize Left', cat: 'random',
      xy: 'X / Y = random range for the command to the left',
      manual: 'Randomizes the FX to the left (or note/inst in the first column).',
      confidence: 'high', sim: 'partial', scope: ['phrase', 'table']
    },
    {
      code: 'NTH', name: 'Nth Trigger', cat: 'random',
      xy: 'X / Y = skip-left / skip-right based on loop count',
      manual: 'Conditional trigger based on how many times the phrase/table looped.',
      confidence: 'med', sim: 'partial', scope: ['phrase', 'table']
      // Engine gates the note using the phrase loop counter.
    },
    {
      code: 'SED', name: 'Random Seed', cat: 'random',
      xy: 'XX = seed',
      manual: 'Set the random seed for the track (resets random state).',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { ctx.setSeed(p.value); }
    },

    // ===================== FLOW =====================
    {
      code: 'HOP', name: 'Hop', cat: 'flow',
      xy: 'Phrase: jump to row Y (HOPFF stops). Table: hop to row Y, X times.',
      manual: 'Jump the play position. HOPFF stops the track.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table']
      // Engine resolves HOP for phrase + table flow control.
    },
    {
      code: 'REP', name: 'Repeat', cat: 'flow',
      xy: 'XX = increment per step',
      manual: 'Repeat the last FX, incrementing by XX each row (interpolates in tables).',
      confidence: 'high', sim: 'partial', scope: ['table']
      // Engine implements REP in the table resolver.
    },
    {
      code: 'RTO', name: 'Repeat To', cat: 'flow',
      xy: 'XX = min/max bound for REP',
      manual: 'Used after REP to set the value REP stops at.',
      confidence: 'high', sim: 'partial', scope: ['table']
    },
    {
      code: 'THO', name: 'Table Hop', cat: 'flow',
      xy: '0X = table row to hop to',
      manual: 'Hop to a specific table position (hops all columns).',
      confidence: 'high', sim: 'partial', scope: ['phrase', 'table']
    },

    // ===================== TEMPO / GROOVE / SCALE =====================
    {
      code: 'TPO', name: 'Tempo', cat: 'tempo',
      xy: 'XX = BPM (hex → decimal)',
      manual: 'Set the song tempo in BPM.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { ctx.setTempo(p.value); }
    },
    {
      code: 'GRV', name: 'Groove', cat: 'tempo',
      xy: 'XX = groove number',
      manual: 'Set the groove (ticks-per-step) for the track. Held until changed.',
      confidence: 'high', sim: 'full', scope: ['phrase'],
      onTrigger: function (v, p, ctx) { ctx.setGroove(p.value); }
    },
    {
      code: 'GGR', name: 'Global Groove', cat: 'tempo',
      xy: 'XX = groove number',
      manual: 'Set the groove for all tracks.',
      confidence: 'high', sim: 'full', scope: ['phrase'],
      onTrigger: function (v, p, ctx) { ctx.setGroove(p.value); }
    },
    {
      code: 'SCA', name: 'Track Scale', cat: 'scale',
      xy: 'X = key, Y = scale number',
      manual: 'Set the key signature (X) and scale (Y) for the track.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { ctx.setScale(p.x, p.y); }
    },
    {
      code: 'SCG', name: 'Global Scale', cat: 'scale',
      xy: 'X = key, Y = scale number',
      manual: 'Set the key signature (X) and scale (Y) for the song.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { ctx.setScale(p.x, p.y); }
    },

    // ===================== TABLE =====================
    {
      code: 'CRD', name: 'Hypersynth Chord', cat: 'pitch',
      xy: 'XX = chord number (00–0F)',
      manual: 'Select one of the Hypersynth instrument\'s 16 chords; the chord is transposed by the played note.',
      confidence: 'high', sim: 'full', scope: ['phrase', 'table']
      // handled directly by the engine in Hypersynth instrument mode
    },
    {
      code: 'TBL', name: 'Table', cat: 'table',
      xy: 'XX = table number',
      manual: 'Set the table number for the current instrument.',
      confidence: 'high', sim: 'ref', scope: ['phrase']
    },
    {
      code: 'TBX', name: 'Aux Table', cat: 'table',
      xy: 'XX = table number (00 stops)',
      manual: 'Run an auxiliary table in parallel with the track.',
      confidence: 'high', sim: 'ref', scope: ['phrase']
    },
    {
      code: 'TIC', name: 'Table Tick', cat: 'table',
      xy: '00 = per-trigger, 01-FB = ticks/row, FC octave, FD velocity, FE note, FF = 200Hz',
      manual: 'Set the table tick rate / advance mode.',
      confidence: 'high', sim: 'full', scope: ['table'],
      onTrigger: function (v, p, ctx) { ctx.setTableTic(p.value); }
    },

    // ===================== MIXER & SEND FX =====================
    mix('VMV', 'Main Volume', 'Set the main song volume.', 'full', function (a, p) { a.setMaster(p.value); }),
    mix('VDE', 'Delay Volume', 'Set the delay bus return volume.', 'full', function (a, p) { a.setDelayReturn(p.value); }),
    mix('VRE', 'Reverb Volume', 'Set the reverb bus return volume.', 'full', function (a, p) { a.setReverbReturn(p.value); }),
    mix('XDT', 'Delay Time', 'Send FX: delay time (L/R on hardware; mono here).', 'partial', function (a, p) { a.setDelayTime(p.value); }),
    mix('XDF', 'Delay Feedback', 'Send FX: delay feedback amount.', 'full', function (a, p) { a.setDelayFeedback(p.value); }),
    mix('XRS', 'Reverb Room Size', 'Send FX: reverb room size.', 'partial', function (a, p) { a.setReverbSize(p.value); }),
    mix('XRD', 'Reverb Decay', 'Send FX: reverb decay.', 'partial', function (a, p) { a.setReverbDecay(p.value); }),
    mix('XRZ', 'Reverb Freeze', 'Send FX: freeze the reverb (>00 on).', 'partial', function (a, p) { a.setReverbFreeze(p.value > 0); }),
    mix('DJC', 'DJ Filter Cutoff', 'Set the DJ filter cutoff.', 'full', function (a, p) { a.setDJCut(p.value); }),
    mix('DJR', 'DJ Filter Resonance', 'Set the DJ filter resonance.', 'full', function (a, p) { a.setDJRes(p.value); }),
    mix('DJT', 'DJ Filter Type', 'Set the DJ filter type (00 LP, 01 HP, 02 BP).', 'full', function (a, p) { a.setDJType(p.value); }),
    ref('VMX', 'ModFX Volume', 'Set the ModFX bus volume.'),
    ref('INS', 'Trigger Instrument', 'Set/trigger an instrument as an FX.'),
    ref('SNG', 'Song Hop', 'Jump to a relative song row.'),
    ref('RMX', 'Remix', 'Set the play-head of tracks to the left.'),
    ref('NXT', 'Next-Track Trigger', 'Trigger an instrument on the track to the right.')
  ];

  function ref(code, name, manual) {
    return { code: code, name: name, cat: 'mixer', xy: 'XX', manual: manual,
             confidence: 'high', sim: 'ref', scope: ['phrase'] };
  }
  // mixer/send FX that drive the audio chain via ctx.audio
  function mix(code, name, manual, sim, fn) {
    return {
      code: code, name: name, cat: 'mixer', xy: 'XX', manual: manual,
      confidence: 'high', sim: sim, scope: ['phrase', 'table'],
      onTrigger: function (v, p, ctx) { if (ctx.audio) fn(ctx.audio, p); }
    };
  }

  // Build a lookup by code and expose ordered list.
  var BY_CODE = {};
  LIST.forEach(function (d) { BY_CODE[d.code] = d; });

  M8.fx = {
    list: LIST,
    byCode: function (c) { return BY_CODE[c] || null; },
    codes: LIST.map(function (d) { return d.code; }),
    isPersistent: function (c) { var d = BY_CODE[c]; return !!(d && d.tick); }
  };
})(window.M8 = window.M8 || {});
