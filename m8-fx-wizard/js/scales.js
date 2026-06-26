/* scales.js — M8-style scale tables + quantizer for SCA / SCG.
 * Scale 0 is Chromatic (no quantization). The rest snap a pitch to the nearest
 * allowed scale degree, transposed by the key. */
(function (M8) {
  'use strict';
  var SCALES = [
    { name: 'Chromatic', mask: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { name: 'Major (Ionian)', mask: [0, 2, 4, 5, 7, 9, 11] },
    { name: 'Minor (Aeolian)', mask: [0, 2, 3, 5, 7, 8, 10] },
    { name: 'Dorian', mask: [0, 2, 3, 5, 7, 9, 10] },
    { name: 'Phrygian', mask: [0, 1, 3, 5, 7, 8, 10] },
    { name: 'Lydian', mask: [0, 2, 4, 6, 7, 9, 11] },
    { name: 'Mixolydian', mask: [0, 2, 4, 5, 7, 9, 10] },
    { name: 'Locrian', mask: [0, 1, 3, 5, 6, 8, 10] },
    { name: 'Harmonic Minor', mask: [0, 2, 3, 5, 7, 8, 11] },
    { name: 'Melodic Minor', mask: [0, 2, 3, 5, 7, 9, 11] },
    { name: 'Major Pentatonic', mask: [0, 2, 4, 7, 9] },
    { name: 'Minor Pentatonic', mask: [0, 3, 5, 7, 10] },
    { name: 'Blues', mask: [0, 3, 5, 6, 7, 10] },
    { name: 'Whole Tone', mask: [0, 2, 4, 6, 8, 10] }
  ];

  // Snap `semi` (a MIDI-ish semitone) into scale `idx` with root `key` (0..11).
  function quantize(semi, key, idx) {
    var sc = SCALES[idx];
    if (!sc || idx === 0) return semi;
    var rounded = Math.round(semi);
    var pc = (((rounded - key) % 12) + 12) % 12;
    for (var d = 0; d <= 6; d++) {           // nearest scale tone; ties resolve downward
      if (sc.mask.indexOf((((pc - d) % 12) + 12) % 12) >= 0) return rounded - d;
      if (sc.mask.indexOf(((pc + d) % 12)) >= 0) return rounded + d;
    }
    return rounded;
  }

  M8.scales = { list: SCALES, quantize: quantize };
})(window.M8 = window.M8 || {});
