// Three-way (diff3) merge — no dependencies. Built on the line diff engine.
//
// Given a common ancestor ("base") and two descendants ("ours"/"theirs"), it
// produces a merged file. Where only one side changed a region, that side wins.
// Where both sides changed the same region differently, it emits git-style
// conflict markers and flags the file as conflicted:
//
//   <<<<<<< ours
//   ...our lines...
//   =======
//   ...their lines...
//   >>>>>>> theirs
//
// The whole thing works in terms of lines, which is why it merges code and
// markup (HTML/CSS/JS) the way you'd expect.

import { diffLines } from "./diff.mjs";

const eq = (a, b) => a.length === b.length && a.join("\n") === b.join("\n");

// Express a side's diff against base as a list of hunks, each replacing the base
// range [start, end) with `lines`. Unchanged base lines lie between hunks.
//   pure insertion → start === end          (insert `lines` before base[start])
//   pure deletion  → lines === []           (drop base[start..end))
//   modification   → both                   (replace base[start..end) with lines)
function hunksFor(base, other) {
  const hunks = [];
  let bi = 0;
  let cur = null;
  for (const [kind, payload] of diffLines(base, other)) {
    if (kind === "=") {
      if (cur) {
        hunks.push(cur);
        cur = null;
      }
      bi += payload;
    } else {
      if (!cur) cur = { start: bi, end: bi, lines: [] };
      if (kind === "-") {
        bi += payload.length;
        cur.end = bi;
      } else {
        cur.lines.push(...payload);
      }
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

// Do two hunks touch the same base lines? (Two insertions at the same spot also
// count — their relative order is ambiguous, so we treat it as a conflict.)
function overlaps(a, b) {
  if (a.start < b.end && b.start < a.end) return true;
  if (a.start === a.end && b.start === b.end && a.start === b.start) return true;
  return false;
}
function inRange(h, s, e) {
  if (h.start < e && h.end > s) return true; // overlapping range
  if (h.start === h.end && h.start > s && h.start < e) return true; // insertion inside
  return false;
}
// Ordering for two non-overlapping hunks: earlier start first, insertion first.
function before(a, b) {
  return a.start < b.start || (a.start === b.start && a.end <= b.start);
}
// A side's text for the base range [s, e) with its hunks applied.
function applyRange(base, hunks, s, e) {
  const out = [];
  let pos = s;
  for (const h of hunks) {
    for (let k = pos; k < h.start; k++) out.push(base[k]);
    out.push(...h.lines);
    pos = Math.max(pos, h.end);
  }
  for (let k = pos; k < e; k++) out.push(base[k]);
  return out;
}

// Three-way merge (RCS/diff3 style). Two changes conflict only when they touch
// overlapping base lines; edits to different lines combine cleanly.
// Returns { lines, conflicted }.
export function merge3Lines(base, ours, theirs, labels = {}) {
  const ourLabel = labels.ours || "ours";
  const theirLabel = labels.theirs || "theirs";
  const O = hunksFor(base, ours);
  const T = hunksFor(base, theirs);

  const out = [];
  let conflicted = false;
  let bi = 0;
  let oi = 0;
  let ti = 0;
  const copyBase = (to) => {
    for (; bi < to; bi++) out.push(base[bi]);
  };

  while (oi < O.length || ti < T.length) {
    const oh = O[oi];
    const th = T[ti];

    if (oh && th && overlaps(oh, th)) {
      // Pull in every hunk from either side that overlaps the growing region.
      let s = Math.min(oh.start, th.start);
      let e = Math.max(oh.end, th.end);
      const og = [oh];
      const tg = [th];
      oi++;
      ti++;
      let grew = true;
      while (grew) {
        grew = false;
        while (oi < O.length && inRange(O[oi], s, e)) {
          s = Math.min(s, O[oi].start);
          e = Math.max(e, O[oi].end);
          og.push(O[oi++]);
          grew = true;
        }
        while (ti < T.length && inRange(T[ti], s, e)) {
          s = Math.min(s, T[ti].start);
          e = Math.max(e, T[ti].end);
          tg.push(T[ti++]);
          grew = true;
        }
      }
      copyBase(s);
      const oLines = applyRange(base, og, s, e);
      const tLines = applyRange(base, tg, s, e);
      if (eq(oLines, tLines)) {
        out.push(...oLines); // both sides made the same change
      } else {
        conflicted = true;
        out.push(`<<<<<<< ${ourLabel}`, ...oLines, "=======", ...tLines, `>>>>>>> ${theirLabel}`);
      }
      bi = e;
    } else if (oh && (!th || before(oh, th))) {
      copyBase(oh.start);
      out.push(...oh.lines);
      bi = oh.end;
      oi++;
    } else {
      copyBase(th.start);
      out.push(...th.lines);
      bi = th.end;
      ti++;
    }
  }
  copyBase(base.length);
  return { lines: out, conflicted };
}

// A conflict block for the modify/delete case (one side edited, one deleted).
function modifyDeleteBlock(ourLines, theirLines, labels) {
  return [
    `<<<<<<< ${labels.ours || "ours"}`,
    ...ourLines,
    "=======",
    ...theirLines,
    `>>>>>>> ${labels.theirs || "theirs"}`,
  ];
}

// Merge whole trees. Each *State is a Map<path, lines>. Returns:
//   { result: Map<path, lines>, conflicts: string[] }
// `result` is the complete desired working tree (paths absent from it should be
// removed on disk).
export function mergeStates(baseState, oursState, theirsState, labels = {}) {
  const files = [
    ...new Set([
      ...baseState.keys(),
      ...oursState.keys(),
      ...theirsState.keys(),
    ]),
  ].sort();

  const result = new Map();
  const conflicts = [];

  for (const file of files) {
    const b = baseState.get(file) ?? null;
    const o = oursState.get(file) ?? null;
    const t = theirsState.get(file) ?? null;

    if (!o && !t) continue; // deleted on both sides → gone

    if (!b) {
      // Added on one or both sides.
      if (o && !t) result.set(file, o);
      else if (t && !o) result.set(file, t);
      else {
        const m = merge3Lines([], o, t, labels);
        result.set(file, m.lines);
        if (m.conflicted) conflicts.push(file);
      }
      continue;
    }

    if (o && t) {
      const m = merge3Lines(b, o, t, labels);
      result.set(file, m.lines);
      if (m.conflicted) conflicts.push(file);
    } else if (o && !t) {
      // theirs deleted it
      if (eq(o, b)) {
        /* ours unchanged + theirs deleted → delete */
      } else {
        result.set(file, modifyDeleteBlock(o, [], labels));
        conflicts.push(file);
      }
    } else if (t && !o) {
      // ours deleted it
      if (eq(t, b)) {
        /* theirs unchanged + ours deleted → delete */
      } else {
        result.set(file, modifyDeleteBlock([], t, labels));
        conflicts.push(file);
      }
    }
  }
  return { result, conflicts };
}
