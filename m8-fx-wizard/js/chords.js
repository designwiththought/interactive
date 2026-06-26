/* chords.js — chord theory: qualities, voicings, diatonic harmony, and
 * progression generators that feed the Chord Lab sequencer. */
(function (M8) {
  'use strict';

  // intervals (semitones from root)
  var QUALITIES = {
    'maj': [0, 4, 7], 'min': [0, 3, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
    'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
    'maj7': [0, 4, 7, 11], 'min7': [0, 3, 7, 10], '7': [0, 4, 7, 10],
    'm7b5': [0, 3, 6, 10], 'dim7': [0, 3, 6, 9], 'add9': [0, 4, 7, 14],
    'maj9': [0, 4, 7, 11, 14], 'min9': [0, 3, 7, 10, 14], '9': [0, 4, 7, 10, 14]
  };
  var ORDER = Object.keys(QUALITIES);

  var MAJOR = [0, 2, 4, 5, 7, 9, 11];
  var MINOR = [0, 2, 3, 5, 7, 8, 10];
  // diatonic chord qualities per degree (1..7)
  var MAJ_TRIAD = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
  var MAJ_SEVEN = ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5'];
  var MIN_TRIAD = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];
  var MIN_SEVEN = ['min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7', '7'];

  function diatonic(key, mode, degree, seventh) {
    var sc = mode === 'minor' ? MINOR : MAJOR;
    var d = ((degree - 1) % 7 + 7) % 7;
    var pc = (key + sc[d]) % 12;
    var q = mode === 'minor'
      ? (seventh ? MIN_SEVEN[d] : MIN_TRIAD[d])
      : (seventh ? MAJ_SEVEN[d] : MAJ_TRIAD[d]);
    return { pc: pc, quality: q };
  }

  // build MIDI notes for a chord slot
  function notesFor(pc, oct, quality, inversion, spread) {
    var ints = (QUALITIES[quality] || QUALITIES.maj).slice();
    var root = (oct + 1) * 12 + pc;
    var notes = ints.map(function (i) { return root + i; });
    inversion = inversion || 0;
    for (var k = 0; k < inversion; k++) notes.push(notes.shift() + 12);
    notes.sort(function (a, b) { return a - b; });
    if (spread === 'open' && notes.length >= 3) notes[1] -= 12;        // drop-2-ish
    if (spread === 'wide') notes = notes.map(function (n, i) { return i % 2 ? n + 12 : n; });
    notes.sort(function (a, b) { return a - b; });
    return notes;
  }

  // name → { name, mode, degrees, seventh }
  var PROGRESSIONS = {
    pop: { name: 'Pop · I–V–vi–IV', mode: 'major', degrees: [1, 5, 6, 4], seventh: false },
    doowop: { name: 'Doo-wop · I–vi–IV–V', mode: 'major', degrees: [1, 6, 4, 5], seventh: false },
    sad: { name: 'Sad · vi–IV–I–V', mode: 'major', degrees: [6, 4, 1, 5], seventh: false },
    jazz: { name: 'Jazz · ii–V–I–vi', mode: 'major', degrees: [2, 5, 1, 6], seventh: true },
    lofi: { name: 'Lo-fi · Imaj7–vi7–ii7–V7', mode: 'major', degrees: [1, 6, 2, 5], seventh: true },
    epic: { name: 'Epic · i–VI–III–VII', mode: 'minor', degrees: [1, 6, 3, 7], seventh: false },
    andalusian: { name: 'Andalusian · i–VII–VI–V', mode: 'minor', degrees: [1, 7, 6, 5], seventh: false },
    blues: { name: '12-bar blues (dom7)', mode: 'major', degrees: [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5], seventh: true, dom: true }
  };

  function generate(name, key, oct) {
    var p = PROGRESSIONS[name]; if (!p) return [];
    oct = oct == null ? 3 : oct;
    return p.degrees.map(function (deg) {
      var c = diatonic(key, p.mode, deg, p.seventh);
      if (p.dom) c.quality = '7';            // blues: force dominant
      return { pc: c.pc, quality: c.quality, oct: oct };
    });
  }

  function randomDiatonic(key, mode, n, seventh, oct, rng) {
    rng = rng || Math.random; oct = oct == null ? 3 : oct;
    var out = [];
    // start on the tonic for grounding, then wander
    for (var i = 0; i < n; i++) {
      var deg = i === 0 ? 1 : 1 + Math.floor(rng() * 7);
      var c = diatonic(key, mode, deg, seventh);
      out.push({ pc: c.pc, quality: c.quality, oct: oct });
    }
    return out;
  }

  // progression → just the ROOT notes (the M8 Hypersynth sequences roots; the
  // chord shape lives in the instrument's voice offsets).
  function generateRoots(name, key, oct) {
    var p = PROGRESSIONS[name]; if (!p) return { roots: [], mode: 'major', seventh: false };
    oct = oct == null ? 3 : oct;
    var roots = p.degrees.map(function (deg) { return { pc: diatonic(key, p.mode, deg, false).pc, oct: oct }; });
    return { roots: roots, mode: p.mode, seventh: p.seventh || p.dom || false };
  }

  // name a set of MIDI notes relative to a root pitch-class (for the readout)
  function nameChord(rootPc, notesArr) {
    if (!notesArr || !notesArr.length) return null;
    var names = M8.notes.NAMES;
    var set = {}; notesArr.forEach(function (n) { set[(((n - rootPc) % 12) + 12) % 12] = true; });
    var ivs = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    for (var q in QUALITIES) {
      var qset = {}; QUALITIES[q].forEach(function (x) { qset[x % 12] = true; });
      var keys = Object.keys(qset).map(Number).sort(function (a, b) { return a - b; });
      if (keys.length === ivs.length && keys.every(function (x, i) { return x === ivs[i]; })) return names[rootPc] + q;
    }
    return names[rootPc] + (ivs.length > 2 ? '?' : ivs.length === 2 ? '5' : '');
  }

  // ---- Hypersynth shape bank: the chords the user has "defined in the
  // instrument". Each shape is up to 6 voices (offset + active). ----
  var DEFAULT_SHAPES = [
    ['maj', [0, 4, 7]], ['min', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]],
    ['min7', [0, 3, 7, 10]], ['dim', [0, 3, 6]], ['m7b5', [0, 3, 6, 10]],
    ['sus4', [0, 5, 7]], ['power', [0, 7, 12]]
  ];
  function shapeVoices(offs) {
    var out = []; for (var i = 0; i < 6; i++) out.push({ off: offs[i] != null ? offs[i] : 0, on: i < offs.length });
    return out;
  }
  function defaultBank() { return DEFAULT_SHAPES.map(function (s) { return { name: s[0], voices: shapeVoices(s[1]) }; }); }

  // progression → [{pc, oct, quality}] so the sequencer can shift between shapes
  function generateProgression(name, key, oct) {
    var p = PROGRESSIONS[name]; if (!p) return [];
    oct = oct == null ? 3 : oct;
    return p.degrees.map(function (deg) {
      var c = diatonic(key, p.mode, deg, p.seventh);
      if (p.dom) c.quality = '7';
      return { pc: c.pc, oct: oct, quality: c.quality };
    });
  }

  M8.chords = {
    QUALITIES: QUALITIES, ORDER: ORDER, PROGRESSIONS: PROGRESSIONS,
    notesFor: notesFor, diatonic: diatonic, generate: generate, randomDiatonic: randomDiatonic,
    generateRoots: generateRoots, nameChord: nameChord,
    DEFAULT_SHAPES: DEFAULT_SHAPES, shapeVoices: shapeVoices, defaultBank: defaultBank,
    generateProgression: generateProgression
  };
})(window.M8 = window.M8 || {});
