/* notes.js — note <-> frequency <-> M8 string helpers, plus hex utilities.
   Attached to the global M8 namespace (no modules, so this runs from file://). */
(function (M8) {
  'use strict';

  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // We use standard MIDI numbering (C4 = 60, A4 = 69 = 440 Hz) and render the M8's
  // "C-4" style. The M8's own octave labels differ by firmware/theme; the absolute
  // pitch is what matters for the simulator.
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function formatNote(m) {
    m = Math.round(m);
    var n = ((m % 12) + 12) % 12;
    var oct = Math.floor(m / 12) - 1;
    var name = NAMES[n];
    // M8 pads naturals with a dash so columns line up: "C-4", "C#4".
    return (name.length === 1 ? name + '-' : name) + oct;
  }

  function parseNote(str) {
    if (str == null) return null;
    str = String(str).trim().toUpperCase().replace('-', '');
    var m = /^([A-G]#?)(-?\d+)$/.exec(str);
    if (!m) return null;
    var idx = NAMES.indexOf(m[1]);
    if (idx < 0) return null;
    return (parseInt(m[2], 10) + 1) * 12 + idx;
  }

  // Hex helpers — M8 values are unsigned bytes shown as two hex digits.
  function hex2(v) {
    if (v == null) return '--';
    v = v & 0xff;
    return (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
  }
  function parseHex(str) {
    if (str == null) return null;
    str = String(str).trim();
    if (str === '' || str === '--') return null;
    var v = parseInt(str, 16);
    return isNaN(v) ? null : (v & 0xff);
  }
  // Two's-complement reading of a byte as signed (-128..127). M8 uses this for
  // bipolar params like TSP, PIT, FIN, MTT.
  function signedByte(v) { v &= 0xff; return v >= 0x80 ? v - 256 : v; }

  M8.notes = {
    NAMES: NAMES,
    midiToFreq: midiToFreq,
    formatNote: formatNote,
    parseNote: parseNote,
    hex2: hex2,
    parseHex: parseHex,
    signedByte: signedByte
  };
})(window.M8 = window.M8 || {});
