#!/usr/bin/env node
// ============================================================================
// GENERATED FILE — do not edit by hand.
// Single-file build of `track`. Rebuild with `npm run bundle`.
// Source of truth: tracker/src/*.mjs
// Usage: node track.mjs <command>   (e.g. node track.mjs init)
// ============================================================================

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";

// Line-based diff engine — no dependencies.
//
// A "diff" here is a compact, self-describing list of segments that transforms
// one array of lines into another:
//
//   ["=", count]        keep `count` unchanged lines
//   ["-", [..lines]]    remove these lines
//   ["+", [..lines]]    insert these lines
//
// Because deleted/added text is carried inside the segment, a diff can be
// rendered and reverse-applied without needing the original file — which is
// exactly what lets us store the whole history in one JSON file.

// Split a file's text into lines while preserving a trailing newline.
// "a\nb\n" -> ["a", "b", ""]  (the empty tail records the final newline)
// "a\nb"   -> ["a", "b"]
function toLines(text) {
  if (text === "") return [];
  return text.split("\n");
}

// Inverse of toLines.
function fromLines(lines) {
  return lines.join("\n");
}

// Guardrail: the LCS table is O(n*m) memory. For very large files we skip the
// nice diff and just replace the whole thing. Personal files rarely hit this.
const MAX_CELLS = 4_000_000;

// Compute a diff (array of segments) turning `a` lines into `b` lines.
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return [["+", b.slice()]];
  if (m === 0) return [["-", a.slice()]];

  if ((n + 1) * (m + 1) > MAX_CELLS) {
    // Too big for an LCS table: delete everything, add everything.
    return [["-", a.slice()], ["+", b.slice()]];
  }

  // dp[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  // Backtrack to build the edit sequence, grouping runs of the same kind.
  const segs = [];
  let i = 0;
  let j = 0;
  const push = (kind, line) => {
    const last = segs[segs.length - 1];
    if (last && last[0] === kind) {
      if (kind === "=") last[1] += 1;
      else last[1].push(line);
    } else {
      segs.push(kind === "=" ? ["=", 1] : [kind, [line]]);
    }
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("=", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("-", a[i]);
      i++;
    } else {
      push("+", b[j]);
      j++;
    }
  }
  while (i < n) push("-", a[i++]);
  while (j < m) push("+", b[j++]);

  return segs;
}

// Apply a diff to `a` lines, producing the new lines.
function applyDiff(a, segs) {
  const out = [];
  let i = 0;
  for (const seg of segs) {
    const [kind, payload] = seg;
    if (kind === "=") {
      for (let k = 0; k < payload; k++) out.push(a[i++]);
    } else if (kind === "-") {
      i += payload.length; // skip over the removed lines
    } else if (kind === "+") {
      for (const line of payload) out.push(line);
    } else {
      throw new Error(`unknown diff segment: ${kind}`);
    }
  }
  return out;
}

// True if a diff actually changes anything.
function diffHasChanges(segs) {
  return segs.some((s) => s[0] !== "=");
}

// Render a diff as a unified-ish, colorable patch. `context` collapses long
// runs of unchanged lines. Returns an array of { sign, text } rows.
function renderDiff(segs, { context = 3 } = {}) {
  const rows = [];
  for (let s = 0; s < segs.length; s++) {
    const [kind, payload] = segs[s];
    if (kind === "=") {
      const count = payload;
      // We don't carry unchanged text, so show a marker instead of the lines.
      if (count <= context * 2 + 1) {
        rows.push({ sign: " ", text: `… ${count} unchanged line${count === 1 ? "" : "s"}` });
      } else {
        rows.push({ sign: " ", text: `… ${count} unchanged lines` });
      }
    } else if (kind === "-") {
      for (const line of payload) rows.push({ sign: "-", text: line });
    } else if (kind === "+") {
      for (const line of payload) rows.push({ sign: "+", text: line });
    }
  }
  return rows;
}

// Count added / removed lines in a diff.
function diffStat(segs) {
  let added = 0;
  let removed = 0;
  for (const [kind, payload] of segs) {
    if (kind === "+") added += payload.length;
    else if (kind === "-") removed += payload.length;
  }
  return { added, removed };
}

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
function merge3Lines(base, ours, theirs, labels = {}) {
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
function mergeStates(baseState, oursState, theirsState, labels = {}) {
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

// The repository model. Everything lives in one JSON file: .track/history.json
//
// Shape (version 2 — branch-aware):
// {
//   "version": 2,
//   "created": "<iso>",
//   "current": "main",            // current branch name, or null when detached
//   "detached": null,             // commit id when HEAD is detached (no branch)
//   "branches": { "main": "<commit id | null>" },   // branch tip per name
//   "tags": { "v1": "<commit id>" },
//   "commits": [                  // append-only object store (a DAG via .parent)
//     {
//       "id": "a1b2c3d4",
//       "parent": "<id | null>",
//       "message": "...",
//       "time": "<iso>",
//       "author": "name",
//       "changes": {
//         "notes.txt": { "op": "add",    "diff": [ ...segments ] },
//         "old.txt":   { "op": "delete" },
//         "main.js":   { "op": "modify", "diff": [ ...segments ] }
//       }
//     }
//   ]
// }
//
// A file's content at any commit is rebuilt by walking that commit's parent
// chain back to the root and replaying each diff in order. No blobs, no object
// store of file contents — just diffs referenced from a JSON file. Because we
// follow parent pointers (not array order), branches reconstruct correctly.


const TRACK_DIR = ".track";
const HISTORY_FILE = "history.json";
const IGNORE_FILE = ".trackignore";
const DEFAULT_BRANCH = "main";

// Always-ignored entries, on top of whatever .trackignore lists.
const DEFAULT_IGNORE = [TRACK_DIR, ".git", "node_modules", ".DS_Store"];

// ----- locating / loading the repo -------------------------------------------

// Walk up from `start` looking for a .track directory (like git does).
function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, TRACK_DIR, HISTORY_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function historyPath(root) {
  return path.join(root, TRACK_DIR, HISTORY_FILE);
}

// Bring an older history forward to the current shape. Safe to call repeatedly.
function migrate(h) {
  if (h.version === 1) {
    h.version = 2;
    h.branches = { [DEFAULT_BRANCH]: h.head ?? null };
    h.current = DEFAULT_BRANCH;
    h.detached = null;
    h.tags = {};
    delete h.head;
  }
  if (!h.branches) h.branches = { [DEFAULT_BRANCH]: null };
  if (h.current === undefined) h.current = DEFAULT_BRANCH;
  if (h.detached === undefined) h.detached = null;
  if (!h.tags) h.tags = {};
  return h;
}

function loadHistory(root) {
  return migrate(JSON.parse(fs.readFileSync(historyPath(root), "utf8")));
}

function saveHistory(root, history) {
  fs.writeFileSync(historyPath(root), JSON.stringify(history, null, 2) + "\n");
}

// ----- init ------------------------------------------------------------------

function init(root = process.cwd()) {
  const dir = path.join(root, TRACK_DIR);
  if (fs.existsSync(path.join(dir, HISTORY_FILE))) {
    return { created: false, root };
  }
  fs.mkdirSync(dir, { recursive: true });
  const history = {
    version: 2,
    created: new Date().toISOString(),
    current: DEFAULT_BRANCH,
    detached: null,
    branches: { [DEFAULT_BRANCH]: null },
    tags: {},
    commits: [],
  };
  saveHistory(root, history);

  const ignorePath = path.join(root, IGNORE_FILE);
  if (!fs.existsSync(ignorePath)) {
    fs.writeFileSync(
      ignorePath,
      "# One glob-ish pattern per line. Lines starting with # are comments.\n" +
        "# These are always ignored: .track .git node_modules .DS_Store\n",
    );
  }
  return { created: true, root };
}

// ----- ignore handling -------------------------------------------------------

function loadIgnorePatterns(root) {
  const patterns = [...DEFAULT_IGNORE];
  const ignorePath = path.join(root, IGNORE_FILE);
  if (fs.existsSync(ignorePath)) {
    for (const line of fs.readFileSync(ignorePath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) patterns.push(trimmed);
    }
  }
  return patterns;
}

// Tiny matcher: supports a leading directory name, plain substrings, and `*`.
function isIgnored(relPath, patterns) {
  const parts = relPath.split("/");
  for (const pat of patterns) {
    if (parts.includes(pat)) return true; // a path segment equals the pattern
    if (relPath === pat) return true;
    if (pat.includes("*")) {
      const re = new RegExp(
        "^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      if (re.test(relPath) || parts.some((p) => re.test(p))) return true;
    }
  }
  return false;
}

// ----- scanning the working tree ---------------------------------------------

// Return a sorted map of { relPath -> lines } for every tracked file on disk.
function scanWorkingTree(root) {
  const patterns = loadIgnorePatterns(root);
  const files = new Map();

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (isIgnored(rel, patterns)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        files.set(rel, toLines(fs.readFileSync(abs, "utf8")));
      }
    }
  };
  walk(root);
  return new Map([...files.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// ----- commit lookup & reconstruction ----------------------------------------

function getCommit(history, id) {
  if (!id) return null;
  return history.commits.find((c) => c.id === id) || null;
}

function currentBranch(history) {
  return history.current; // null when detached
}

// The commit id that HEAD currently points at (via branch tip or detached).
function headCommitId(history) {
  if (history.current) return history.branches[history.current] ?? null;
  return history.detached ?? null;
}

// Commit objects from root → id (the ancestry path).
function ancestry(history, id) {
  const chain = [];
  let cur = id;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const c = getCommit(history, cur);
    if (!c) break;
    chain.push(c);
    cur = c.parent;
  }
  return chain.reverse();
}

function applyChanges(state, changes) {
  for (const [file, change] of Object.entries(changes)) {
    if (change.op === "delete") state.delete(file);
    else if (change.op === "add") state.set(file, applyDiff([], change.diff));
    else if (change.op === "modify")
      state.set(file, applyDiff(state.get(file) ?? [], change.diff));
  }
}

// Rebuild the full set of files as of a commit id. Falsy id → empty tree.
function reconstructCommit(history, id) {
  const state = new Map();
  for (const cmt of ancestry(history, id)) applyChanges(state, cmt.changes);
  return state;
}

function reconstructHead(history) {
  return reconstructCommit(history, headCommitId(history));
}

// Resolve a ref to a commit id (or null). Understands:
//   HEAD, a branch name, a tag name, @N (1-based array ordinal),
//   a full id or unique prefix, and trailing ~N / ^ ancestor steps.
function resolveRef(history, ref) {
  if (!ref) return headCommitId(history);

  const m = ref.match(/^(.*?)((?:[~^]\d*)*)$/);
  const base = m[1];
  const steps = m[2];

  let id = resolveBase(history, base);
  for (const tok of steps.match(/[~^]\d*/g) || []) {
    const n = tok.length > 1 ? parseInt(tok.slice(1), 10) : 1;
    for (let k = 0; k < n && id; k++) id = getCommit(history, id)?.parent ?? null;
  }
  return id;
}

function resolveBase(history, ref) {
  if (!ref || ref.toLowerCase() === "head") return headCommitId(history);
  if (Object.prototype.hasOwnProperty.call(history.branches, ref))
    return history.branches[ref];
  if (Object.prototype.hasOwnProperty.call(history.tags, ref))
    return history.tags[ref];
  if (/^@\d+$/.test(ref)) {
    const n = parseInt(ref.slice(1), 10);
    return history.commits[n - 1]?.id ?? null;
  }
  if (getCommit(history, ref)) return ref;
  const matches = history.commits.filter((c) => c.id.startsWith(ref));
  return matches.length === 1 ? matches[0].id : null;
}

// Decorations (branch/tag/HEAD labels) for a commit id, for log/show output.
function decorations(history, id) {
  const labels = [];
  const head = headCommitId(history);
  if (id === head) labels.push(history.current ? `HEAD → ${history.current}` : "HEAD");
  for (const [name, tip] of Object.entries(history.branches)) {
    if (tip === id && name !== history.current) labels.push(name);
  }
  for (const [name, tip] of Object.entries(history.tags)) {
    if (tip === id) labels.push(`tag: ${name}`);
  }
  return labels;
}

// ----- status ----------------------------------------------------------------

// Compare the working tree against a commit (HEAD by default).
function statusAgainst(root, history, id) {
  const base = reconstructCommit(history, id);
  const work = scanWorkingTree(root);
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [file, lines] of work) {
    if (!base.has(file)) added.push(file);
    else if (fromLines(base.get(file)) !== fromLines(lines)) modified.push(file);
  }
  for (const file of base.keys()) if (!work.has(file)) deleted.push(file);
  return { added, modified, deleted };
}

function status(root, history) {
  return statusAgainst(root, history, headCommitId(history));
}

function isDirty(root, history) {
  const s = status(root, history);
  return s.added.length + s.modified.length + s.deleted.length > 0;
}

// ----- commit ----------------------------------------------------------------

// A short, stable id for a commit. We hash parent + changes + time so the same
// content at a different moment still gets a distinct id. This is a plain
// pure-JS hash (FNV-1a, 64-bit, folded to 8 hex chars) so the tool needs only
// `fs` and `path` — no `node:crypto`/OpenSSL, which keeps it portable to slim
// Node builds like the ones in iOS code editors.
function hashId(str) {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    h = ((h ^ BigInt(code & 0xff)) * prime) & mask;
    h = ((h ^ BigInt((code >> 8) & 0xff)) * prime) & mask;
  }
  const folded = (h ^ (h >> 32n)) & 0xffffffffn; // mix high bits into the low 32
  return folded.toString(16).padStart(8, "0");
}

function makeId(parent, changes, time) {
  return hashId(JSON.stringify({ parent, changes, time }));
}

// Build the change set between a base state and the working tree.
function changesFrom(base, work) {
  const changes = {};
  for (const [file, lines] of work) {
    if (!base.has(file)) {
      changes[file] = { op: "add", diff: diffLines([], lines) };
    } else {
      const diff = diffLines(base.get(file), lines);
      if (diffHasChanges(diff)) changes[file] = { op: "modify", diff };
    }
  }
  for (const file of base.keys()) if (!work.has(file)) changes[file] = { op: "delete" };
  return changes;
}

function commit(root, history, message, author = "you") {
  const parent = headCommitId(history);
  const base = reconstructCommit(history, parent);
  const work = scanWorkingTree(root);
  const changes = changesFrom(base, work);
  const merging = history.merging;
  if (Object.keys(changes).length === 0 && !merging) return null;

  const time = new Date().toISOString();
  const parent2 = merging ? merging.theirs : null;
  const id = makeId(parent, changes, time);
  const obj = { id, parent, message, time, author, changes };
  if (parent2) obj.parent2 = parent2;
  history.commits.push(obj);
  moveHead(history, id);
  if (merging) delete history.merging;
  saveHistory(root, history);
  return getCommit(history, id);
}

// Point the current branch (or detached HEAD) at a commit id.
function moveHead(history, id) {
  if (history.current) history.branches[history.current] = id;
  else history.detached = id;
}

// ----- writing the working tree ----------------------------------------------

// Overwrite specific files from a commit's state. Files absent at that commit
// are removed from disk. Does NOT move HEAD. Returns what changed on disk.
function restoreFiles(root, history, id, files) {
  const state = reconstructCommit(history, id);
  const written = [];
  const removed = [];
  for (const file of files) {
    const abs = path.join(root, file);
    if (state.has(file)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, fromLines(state.get(file)));
      written.push(file);
    } else if (fs.existsSync(abs)) {
      fs.rmSync(abs);
      removed.push(file);
    }
  }
  return { written, removed };
}

// Make the whole working tree match a commit's state. Does NOT move HEAD.
function checkoutTree(root, history, id) {
  const state = reconstructCommit(history, id);
  const work = scanWorkingTree(root);
  const written = [];
  const removed = [];
  for (const [file, lines] of state) {
    const abs = path.join(root, file);
    const current = work.has(file) ? fromLines(work.get(file)) : null;
    if (current !== fromLines(lines)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, fromLines(lines));
      written.push(file);
    }
  }
  for (const file of work.keys()) {
    if (!state.has(file)) {
      fs.rmSync(path.join(root, file));
      removed.push(file);
    }
  }
  return { written, removed };
}

// ----- branches --------------------------------------------------------------

function createBranch(root, history, name, atId = undefined) {
  if (Object.prototype.hasOwnProperty.call(history.branches, name))
    throw new Error(`branch already exists: ${name}`);
  if (!/^[\w./-]+$/.test(name)) throw new Error(`invalid branch name: ${name}`);
  history.branches[name] = atId === undefined ? headCommitId(history) : atId;
  saveHistory(root, history);
}

function deleteBranch(root, history, name) {
  if (!Object.prototype.hasOwnProperty.call(history.branches, name))
    throw new Error(`no such branch: ${name}`);
  if (history.current === name)
    throw new Error(`cannot delete the current branch: ${name}`);
  delete history.branches[name];
  saveHistory(root, history);
}

// Switch HEAD to a branch (by name) or detach onto a commit id.
function switchTo(root, history, name) {
  if (Object.prototype.hasOwnProperty.call(history.branches, name)) {
    history.current = name;
    history.detached = null;
    const res = checkoutTree(root, history, history.branches[name]);
    saveHistory(root, history);
    return { branch: name, ...res };
  }
  const id = resolveRef(history, name);
  if (!id) throw new Error(`no such branch or commit: ${name}`);
  history.current = null;
  history.detached = id;
  const res = checkoutTree(root, history, id);
  saveHistory(root, history);
  return { detached: id, ...res };
}

// ----- tags ------------------------------------------------------------------

function createTag(root, history, name, atId = undefined) {
  if (Object.prototype.hasOwnProperty.call(history.tags, name))
    throw new Error(`tag already exists: ${name}`);
  const id = atId === undefined ? headCommitId(history) : atId;
  if (!id) throw new Error("nothing to tag yet");
  history.tags[name] = id;
  saveHistory(root, history);
}

function deleteTag(root, history, name) {
  if (!Object.prototype.hasOwnProperty.call(history.tags, name))
    throw new Error(`no such tag: ${name}`);
  delete history.tags[name];
  saveHistory(root, history);
}

// ----- reset / undo ----------------------------------------------------------

// Move the current branch to a commit. `hard` also rewrites the working tree;
// otherwise the working tree is left alone (changes resurface as uncommitted).
function reset(root, history, id, { hard = false } = {}) {
  if (!history.current) throw new Error("cannot reset while HEAD is detached");
  moveHead(history, id);
  let tree = null;
  if (hard) tree = checkoutTree(root, history, id);
  saveHistory(root, history);
  return { id, tree };
}

// ----- revert ----------------------------------------------------------------

// Undo a single commit's changes as a NEW commit on top of HEAD (history kept).
// Files touched by the target commit are set back to their pre-commit version;
// files it added are removed. Reuses commit() to snapshot the result.
function revert(root, history, id, author = "you") {
  const target = getCommit(history, id);
  if (!target) throw new Error(`unknown commit: ${id}`);
  const before = reconstructCommit(history, target.parent);

  for (const file of Object.keys(target.changes)) {
    const abs = path.join(root, file);
    if (before.has(file)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, fromLines(before.get(file)));
    } else if (fs.existsSync(abs)) {
      fs.rmSync(abs);
    }
  }
  const summary = target.message.split("\n")[0];
  return commit(root, history, `Revert "${summary}" (${target.id})`, author);
}

// ----- graph helpers (two-parent aware) --------------------------------------

function shortId(id) {
  return id ? id.slice(0, 8) : "(none)";
}

// Both parents of a commit (a merge commit has two).
function parentsOf(commit) {
  if (!commit) return [];
  return [commit.parent, commit.parent2].filter(Boolean);
}

// Every commit reachable from `id` by following both parents.
function reachable(history, id) {
  const seen = new Set();
  const stack = id ? [id] : [];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    for (const p of parentsOf(getCommit(history, cur))) stack.push(p);
  }
  return [...seen].map((x) => getCommit(history, x)).filter(Boolean);
}

function ancestorSet(history, id) {
  const set = new Set();
  const stack = id ? [id] : [];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || set.has(cur)) continue;
    set.add(cur);
    for (const p of parentsOf(getCommit(history, cur))) stack.push(p);
  }
  return set;
}

// Lowest common ancestor of two commits (the merge base). BFS from `b` returns
// the common ancestor nearest to `b`, which is what we want for a 3-way merge.
function mergeBase(history, a, b) {
  const ancestorsA = ancestorSet(history, a);
  const queue = b ? [b] : [];
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift();
    if (ancestorsA.has(cur)) return cur;
    for (const p of parentsOf(getCommit(history, cur))) {
      if (!seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    }
  }
  return null;
}

// ----- merge -----------------------------------------------------------------

// Write a full desired tree (Map<path, lines>) to disk, removing tracked files
// that aren't part of it.
function applyState(root, stateMap) {
  for (const [file, lines] of stateMap) {
    const abs = path.join(root, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, fromLines(lines));
  }
  for (const file of scanWorkingTree(root).keys()) {
    if (!stateMap.has(file)) fs.rmSync(path.join(root, file));
  }
}

// Merge another branch/commit into the current branch. Returns a status object:
//   { status: "up-to-date" }
//   { status: "fast-forward", to }
//   { status: "merged", commit }
//   { status: "conflict", files, message }
function mergeBranch(root, history, theirsRef) {
  if (history.merging)
    throw new Error(
      "a merge is already in progress — resolve and commit, or `track merge --abort`",
    );
  if (!history.current)
    throw new Error("you must be on a branch to merge (HEAD is detached)");
  if (isDirty(root, history))
    throw new Error("commit your changes before merging");

  const oursId = headCommitId(history);
  const theirsId = resolveRef(history, theirsRef);
  if (!theirsId) throw new Error(`unknown branch or commit: ${theirsRef}`);
  if (theirsId === oursId) return { status: "up-to-date" };

  const baseId = mergeBase(history, oursId, theirsId);
  if (baseId === theirsId) return { status: "up-to-date" };

  const oursLabel = history.current;
  const theirsLabel = Object.prototype.hasOwnProperty.call(
    history.branches,
    theirsRef,
  )
    ? theirsRef
    : shortId(theirsId);

  // Fast-forward: our branch has no commits the other lacks.
  if (baseId === oursId) {
    moveHead(history, theirsId);
    const tree = checkoutTree(root, history, theirsId);
    saveHistory(root, history);
    return { status: "fast-forward", to: theirsId, tree };
  }

  const baseState = reconstructCommit(history, baseId);
  const oursState = reconstructCommit(history, oursId);
  const theirsState = reconstructCommit(history, theirsId);
  const { result, conflicts } = mergeStates(baseState, oursState, theirsState, {
    ours: oursLabel,
    theirs: theirsLabel,
  });

  applyState(root, result);
  const message = `Merge ${theirsLabel} into ${oursLabel}`;
  history.merging = {
    theirs: theirsId,
    theirsLabel,
    oursLabel,
    base: baseId,
    message,
    conflicts,
  };

  if (conflicts.length) {
    saveHistory(root, history);
    return { status: "conflict", files: conflicts, message };
  }
  const created = commit(root, history, message); // consumes merging → parent2
  return { status: "merged", commit: created };
}

// Throw away an in-progress merge and restore the current branch's tree.
function abortMerge(root, history) {
  if (!history.merging) throw new Error("no merge in progress");
  const tree = checkoutTree(root, history, headCommitId(history));
  delete history.merging;
  saveHistory(root, history);
  return tree;
}

// Are there leftover conflict markers in the working tree?
function conflictMarkers(root) {
  const files = [];
  for (const [file, lines] of scanWorkingTree(root)) {
    if (lines.some((l) => l.startsWith("<<<<<<< ") || l.startsWith(">>>>>>> ")))
      files.push(file);
  }
  return files;
}

// A tiny, dependency-free web viewer for the history. Handy on a phone, where
// a browser beats a terminal. Read-only: it shows commits and their diffs.

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const PAGE = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0;
         background: Canvas; color: CanvasText; }
  header { position: sticky; top: 0; background: Canvas; padding: 1rem;
           border-bottom: 1px solid color-mix(in oklab, CanvasText 15%, transparent); }
  h1 { font-size: 1.1rem; margin: 0; }
  h1 a { color: inherit; text-decoration: none; }
  main { padding: 1rem; max-width: 900px; margin: 0 auto; }
  .commit { display: block; padding: .75rem 1rem; margin: .5rem 0; text-decoration: none;
            color: inherit; border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
            border-radius: 10px; }
  .commit:hover { background: color-mix(in oklab, CanvasText 6%, transparent); }
  .id { font-family: ui-monospace, monospace; color: #2a7; }
  .meta { font-size: .8rem; opacity: .6; }
  .msg { font-weight: 600; margin-top: .15rem; }
  .stat .add { color: #2a7; } .stat .del { color: #d54; }
  pre { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px;
        overflow-x: auto; padding: .5rem .75rem; border-radius: 8px;
        background: color-mix(in oklab, CanvasText 5%, transparent); }
  .file { font-weight: 600; margin: 1rem 0 .25rem; }
  .ln.add { color: #2a7; } .ln.del { color: #d54; } .ln.ctx { opacity: .5; }
  a.back { display: inline-block; margin-bottom: .5rem; }
  .empty { opacity: .6; }
  .tag { font-size: .7rem; padding: .05rem .4rem; border-radius: 999px;
         background: color-mix(in oklab, #2a7 25%, transparent);
         color: color-mix(in oklab, CanvasText 80%, #2a7); vertical-align: middle; }
</style></head>
<body>
<header><h1><a href="/">◇ track</a></h1></header>
<main>${body}</main>
</body></html>`;

function listPage(history) {
  if (!history.commits.length) {
    return PAGE("track", `<p class="empty">No commits yet. Make one with <code>track commit -m "…"</code>.</p>`);
  }
  const rows = [];
  for (let i = history.commits.length - 1; i >= 0; i--) {
    const cmt = history.commits[i];
    let add = 0;
    let del = 0;
    for (const ch of Object.values(cmt.changes)) {
      if (ch.diff) {
        const st = diffStat(ch.diff);
        add += st.added;
        del += st.removed;
      }
    }
    const n = Object.keys(cmt.changes).length;
    const labels = decorations(history, cmt.id)
      .map((l) => `<span class="tag">${esc(l)}</span>`)
      .join(" ");
    rows.push(`<a class="commit" href="/commit/${cmt.id}">
      <div><span class="id">${cmt.id}</span> ${labels} <span class="meta">@${i + 1} · ${esc(cmt.time.replace("T", " ").replace(/\..+/, ""))}</span></div>
      <div class="msg">${esc(cmt.message.split("\n")[0])}</div>
      <div class="stat meta"><span class="add">+${add}</span> <span class="del">-${del}</span> · ${n} file(s)</div>
    </a>`);
  }
  return PAGE("track — history", rows.join("\n"));
}

function commitPage(history, ref) {
  const id = resolveRef(history, ref);
  const cmt = getCommit(history, id);
  if (!cmt) return null;
  const ordinal = history.commits.indexOf(cmt) + 1;
  const blocks = [];
  for (const [file, change] of Object.entries(cmt.changes)) {
    if (change.op === "delete") {
      blocks.push(`<div class="file">🗑 ${esc(file)} <span class="meta">(deleted)</span></div>`);
      continue;
    }
    const verb = change.op === "add" ? "added" : "modified";
    const st = diffStat(change.diff);
    const lines = renderDiff(change.diff)
      .map(({ sign, text }) => {
        const cls = sign === "+" ? "add" : sign === "-" ? "del" : "ctx";
        return `<span class="ln ${cls}">${esc(sign + text)}</span>`;
      })
      .join("\n");
    blocks.push(
      `<div class="file">${esc(file)} <span class="meta">${verb} · +${st.added} -${st.removed}</span></div>
       <pre>${lines}</pre>`,
    );
  }
  const labels = decorations(history, cmt.id)
    .map((l) => `<span class="tag">${esc(l)}</span>`)
    .join(" ");
  const body = `<a class="back" href="/">← all commits</a>
    <div><span class="id">${cmt.id}</span> ${labels} <span class="meta">@${ordinal} · ${esc(cmt.time.replace("T", " ").replace(/\..+/, ""))}</span></div>
    <div class="msg" style="margin:.25rem 0 1rem">${esc(cmt.message)}</div>
    ${blocks.join("\n") || '<p class="empty">No file changes.</p>'}`;
  return PAGE("track — " + cmt.id, body);
}

function serve(root, port = 7878) {
  const server = http.createServer((req, res) => {
    const history = loadHistory(root); // reload each request so it stays live
    const url = new URL(req.url, "http://localhost");
    let html;
    if (url.pathname === "/") {
      html = listPage(history);
    } else if (url.pathname.startsWith("/commit/")) {
      html = commitPage(history, decodeURIComponent(url.pathname.slice("/commit/".length)));
    }
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  server.listen(port, () => {
    process.stdout.write(
      `track viewer running → http://localhost:${port}\n` +
        `On your phone: open the Code app's preview, or visit the address above.\n` +
        `Press Ctrl+C to stop.\n`,
    );
  });
}

// Command-line interface for `track`.

// ----- terminal coloring (auto-off when not a TTY) ---------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const yellow = (s) => c("33", s);
const cyan = (s) => c("36", s);
const magenta = (s) => c("35", s);

function out(s = "") {
  process.stdout.write(s + "\n");
}
function die(msg) {
  process.stderr.write(red("error: ") + msg + "\n");
  process.exit(1);
}
function needRepo() {
  const root = findRoot();
  if (!root) die("not a track repo (run `track init` first)");
  return root;
}
function shortTime(iso) {
  return iso.replace("T", " ").replace(/\..+/, "");
}
function short(id) {
  return id ? id.slice(0, 8) : "(none)";
}
function decoStr(history, id) {
  const labels = decorations(history, id);
  return labels.length ? " " + magenta("(" + labels.join(", ") + ")") : "";
}
function printDiffRows(rows) {
  for (const { sign, text } of rows) {
    if (sign === "+") out(green("+" + text));
    else if (sign === "-") out(red("-" + text));
    else out(dim(" " + text));
  }
}
// Print a labeled file diff between two line-arrays. Returns true if it differed.
function printFileDiff(file, before, after) {
  if (fromLines(before) === fromLines(after)) return false;
  const label =
    before.length === 0
      ? green(`added: ${file}`)
      : after.length === 0
        ? red(`deleted: ${file}`)
        : bold(`modified: ${file}`);
  const segs = diffLines(before, after);
  const st = diffStat(segs);
  out(label + dim(`  +${st.added} -${st.removed}`));
  printDiffRows(renderDiff(segs));
  out("");
  return true;
}

// ----- commands --------------------------------------------------------------

function cmdInit() {
  const res = init();
  if (res.created) out(`Initialized empty track repo in ${cyan(res.root + "/.track")}`);
  else out("Already a track repo — nothing to do.");
}

function cmdStatus() {
  const root = needRepo();
  const history = loadHistory(root);
  const head = headCommitId(history);
  const where = history.current
    ? `On branch ${cyan(history.current)}`
    : `${yellow("HEAD detached")} at ${cyan(short(head))}`;
  out(`${where}  ${dim(`(${short(head)})`)}`);

  if (history.merging) {
    out("");
    out(yellow(`Merging ${history.merging.theirsLabel} into ${history.merging.oursLabel}.`));
    const stuck = conflictMarkers(root);
    if (stuck.length) {
      out(red("  Unresolved conflicts — edit these, then commit:"));
      for (const f of stuck) out("    " + red(f));
    } else {
      out(green("  All conflicts resolved — run `track commit` to finish the merge."));
    }
    out(dim("  (or `track merge --abort` to back out)"));
  }

  const s = status(root, history);
  if (!s.added.length && !s.modified.length && !s.deleted.length) {
    if (!history.merging) out(green("Working tree clean — nothing to commit."));
    return;
  }
  out("");
  out(bold("Changes since last commit:"));
  for (const f of s.added) out("  " + green("added    ") + f);
  for (const f of s.modified) out("  " + yellow("modified ") + f);
  for (const f of s.deleted) out("  " + red("deleted  ") + f);
  out("");
  out(dim('Use `track commit -m "message"` to save them.'));
}

function cmdCommit(args) {
  const root = needRepo();
  const history = loadHistory(root);
  let message = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m" || args[i] === "--message") message = args[++i];
  }
  if (!message) die('a message is required: track commit -m "what changed"');

  const result = commit(root, history, message);
  if (!result) {
    out("Nothing to commit — working tree matches the last commit.");
    return;
  }
  const n = Object.keys(result.changes).length;
  const onto = history.current ? ` to ${cyan(history.current)}` : " (detached)";
  out(`${green("✓")} committed ${cyan(result.id)}${onto}  ` + dim(`(${n} file${n === 1 ? "" : "s"})`));
  out("  " + result.message);
}

function cmdLog(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const oneline = args.includes("--oneline");
  const all = args.includes("--all");

  // Default: everything reachable from HEAD (following merges), newest first.
  const list = all
    ? [...history.commits]
    : reachable(history, headCommitId(history));
  list.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  if (!list.length) {
    out("No commits yet.");
    return;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const cmt = list[i];
    const ordinal = dim(`@${history.commits.indexOf(cmt) + 1}`);
    const deco = decoStr(history, cmt.id);
    if (oneline) {
      out(`${cyan(cmt.id)}${deco} ${ordinal} ${cmt.message.split("\n")[0]}`);
      continue;
    }
    let added = 0;
    let removed = 0;
    for (const ch of Object.values(cmt.changes)) {
      if (ch.diff) {
        const st = diffStat(ch.diff);
        added += st.added;
        removed += st.removed;
      }
    }
    out(`${bold(cyan("commit " + cmt.id))}${deco} ${ordinal}`);
    out(`  ${dim(shortTime(cmt.time))}  ` + green(`+${added}`) + " " + red(`-${removed}`) +
      dim(`  ${Object.keys(cmt.changes).length} file(s)`));
    out(`  ${cmt.message.split("\n")[0]}`);
    if (i > 0) out("");
  }
}

function cmdShow(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const ref = args[0] || "HEAD";
  const id = resolveRef(history, ref);
  if (!id) die(`unknown commit: ${ref}`);
  const cmt = getCommit(history, id);

  out(bold(cyan("commit " + cmt.id)) + decoStr(history, cmt.id));
  const parents = cmt.parent2
    ? `${short(cmt.parent)} + ${short(cmt.parent2)}  (merge)`
    : short(cmt.parent);
  out(dim("  parent " + parents));
  out(dim("  " + shortTime(cmt.time)));
  out("  " + cmt.message);
  out("");
  for (const [file, change] of Object.entries(cmt.changes)) {
    if (change.op === "delete") {
      out(red(`deleted: ${file}`));
    } else {
      const verb = change.op === "add" ? "added" : "modified";
      const st = diffStat(change.diff);
      out(bold(`${verb}: ${file}`) + dim(`  +${st.added} -${st.removed}`));
      printDiffRows(renderDiff(change.diff));
    }
    out("");
  }
}

// diff                → working tree vs HEAD
// diff <ref>          → working tree vs <ref>
// diff <refA> <refB>  → <refA> vs <refB>  (commit-to-commit)
function cmdDiff(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const refs = args.filter((a) => !a.startsWith("-"));

  let beforeState;
  let afterState;
  let label;
  if (refs.length >= 2) {
    const a = resolveRef(history, refs[0]);
    const b = resolveRef(history, refs[1]);
    if (!a && refs[0].toLowerCase() !== "head") die(`unknown commit: ${refs[0]}`);
    if (!b && refs[1].toLowerCase() !== "head") die(`unknown commit: ${refs[1]}`);
    beforeState = reconstructCommit(history, a);
    afterState = reconstructCommit(history, b);
    label = `${refs[0]} → ${refs[1]}`;
  } else {
    const ref = refs[0] || "HEAD";
    const a = resolveRef(history, ref);
    if (!a && ref.toLowerCase() !== "head") die(`unknown commit: ${ref}`);
    beforeState = reconstructCommit(history, a);
    afterState = scanWorkingTree(root);
    label = `${ref} → working tree`;
  }

  const files = [...new Set([...beforeState.keys(), ...afterState.keys()])].sort();
  let any = false;
  for (const file of files) {
    if (printFileDiff(file, beforeState.get(file) ?? [], afterState.get(file) ?? []))
      any = true;
  }
  if (!any) out(green(`No changes (${label}).`));
}

function cmdLs(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const ref = args[0] || "HEAD";
  const id = resolveRef(history, ref);
  if (!id && ref.toLowerCase() !== "head") die(`unknown commit: ${ref}`);
  const files = [...reconstructCommit(history, id).keys()].sort();
  if (!files.length) out(dim("(no tracked files at this commit)"));
  else for (const f of files) out(f);
}

// restore <ref> [file...]  — overwrite file(s) from a commit (HEAD unchanged).
// With no files, restores the whole tree to that commit's state.
function cmdRestore(args) {
  const root = needRepo();
  const history = loadHistory(root);
  if (!args.length) die("usage: track restore <commit> [file ...]");
  const id = resolveRef(history, args[0]);
  if (!id) die(`unknown commit: ${args[0]}`);
  const files = args.slice(1);
  const res = files.length
    ? restoreFiles(root, history, id, files)
    : checkoutTree(root, history, id);
  for (const f of res.written) out(green("restored ") + f);
  for (const f of res.removed) out(red("removed  ") + f);
  if (!res.written.length && !res.removed.length) out("Nothing to restore.");
}

// checkout <branch|commit>          — switch HEAD (refuses if working tree dirty)
// checkout <ref> <file...>          — restore those files (alias of restore)
function cmdCheckout(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const force = args.includes("-f") || args.includes("--force");
  const rest = args.filter((a) => a !== "-f" && a !== "--force");
  if (!rest.length) die("usage: track checkout <branch|commit> [file ...]");

  if (rest.length > 1) {
    return cmdRestore(rest); // checkout <ref> <file...> == restore
  }
  const target = rest[0];
  if (!force && isDirty(root, history)) {
    die("you have uncommitted changes — commit them, or use `checkout -f` to discard");
  }
  const res = switchTo(root, history, target);
  if (res.branch) out(`Switched to branch ${cyan(res.branch)}`);
  else out(`${yellow("HEAD detached")} at ${cyan(short(res.detached))}`);
  const touched = res.written.length + res.removed.length;
  if (touched) out(dim(`  updated ${touched} file(s) in the working tree`));
}

function cmdSwitch(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const create = args.includes("-c") || args.includes("--create");
  const rest = args.filter((a) => a !== "-c" && a !== "--create");
  const name = rest[0];
  if (!name) die("usage: track switch [-c] <branch>");
  if (create) {
    createBranch(root, history, name);
    out(`Created branch ${cyan(name)}`);
  }
  if (!Object.prototype.hasOwnProperty.call(history.branches, name))
    die(`no such branch: ${name} (use \`switch -c ${name}\` to create it)`);
  if (isDirty(root, history))
    die("you have uncommitted changes — commit them first");
  switchTo(root, history, name);
  out(`Switched to branch ${cyan(name)}`);
}

function cmdBranch(args) {
  const root = needRepo();
  const history = loadHistory(root);
  if (args[0] === "-d" || args[0] === "--delete") {
    if (!args[1]) die("usage: track branch -d <name>");
    deleteBranch(root, history, args[1]);
    out(`Deleted branch ${cyan(args[1])}`);
    return;
  }
  if (args.length === 0) {
    // list
    const names = Object.keys(history.branches).sort();
    for (const name of names) {
      const tip = history.branches[name];
      const mark = name === history.current ? green("* ") : "  ";
      out(mark + cyan(name) + dim(`  ${short(tip)}`));
    }
    return;
  }
  const name = args[0];
  const at = args[1] ? resolveRef(history, args[1]) : undefined;
  if (args[1] && !at) die(`unknown commit: ${args[1]}`);
  createBranch(root, history, name, at);
  out(`Created branch ${cyan(name)} at ${cyan(short(headCommitId(history)))}`);
}

function cmdTag(args) {
  const root = needRepo();
  const history = loadHistory(root);
  if (args[0] === "-d" || args[0] === "--delete") {
    if (!args[1]) die("usage: track tag -d <name>");
    deleteTag(root, history, args[1]);
    out(`Deleted tag ${cyan(args[1])}`);
    return;
  }
  if (args.length === 0) {
    const names = Object.keys(history.tags).sort();
    if (!names.length) out(dim("(no tags)"));
    for (const name of names) out(cyan(name) + dim(`  ${short(history.tags[name])}`));
    return;
  }
  const name = args[0];
  const at = args[1] ? resolveRef(history, args[1]) : undefined;
  if (args[1] && !at) die(`unknown commit: ${args[1]}`);
  createTag(root, history, name, at);
  out(`Tagged ${cyan(short(history.tags[name]))} as ${cyan(name)}`);
}

function cmdRevert(args) {
  const root = needRepo();
  const history = loadHistory(root);
  if (!args[0]) die("usage: track revert <commit>");
  const id = resolveRef(history, args[0]);
  if (!id) die(`unknown commit: ${args[0]}`);
  if (isDirty(root, history))
    die("commit or discard your changes before reverting");
  const res = revert(root, history, id);
  if (!res) {
    out("Nothing to revert — that commit's changes are already undone.");
    return;
  }
  out(`${green("✓")} reverted ${cyan(short(id))} in new commit ${cyan(res.id)}`);
  out("  " + res.message);
}

function cmdUndo() {
  const root = needRepo();
  const history = loadHistory(root);
  const head = headCommitId(history);
  if (!head) die("nothing to undo — no commits yet");
  if (!history.current) die("cannot undo while HEAD is detached");
  const parent = getCommit(history, head).parent;
  reset(root, history, parent, { hard: false });
  out(`Undid commit ${cyan(short(head))} — its changes are back as uncommitted edits.`);
  out(dim(`  branch ${history.current} now at ${short(parent)}`));
}

function cmdReset(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const hard = args.includes("--hard");
  const rest = args.filter((a) => !a.startsWith("-"));
  const ref = rest[0] || "HEAD~1";
  const id = resolveRef(history, ref);
  if (id === null && ref.toLowerCase() !== "head") {
    // allow resetting to the empty/root state via an explicit ancestor walk
    if (!/~|\^/.test(ref)) die(`unknown commit: ${ref}`);
  }
  reset(root, history, id, { hard });
  out(`Reset ${cyan(history.current)} to ${cyan(short(id))}${hard ? " (--hard)" : ""}`);
  if (!hard) out(dim("  working tree left as-is; run `track status` to see changes"));
}

function cmdMerge(args) {
  const root = needRepo();
  const history = loadHistory(root);

  if (args[0] === "--abort") {
    abortMerge(root, history);
    out("Merge aborted — working tree restored.");
    return;
  }
  if (args[0] === "--continue") {
    if (!history.merging) die("no merge in progress");
    const stuck = conflictMarkers(root);
    if (stuck.length) {
      die(
        "unresolved conflict markers remain in: " +
          stuck.join(", ") +
          "\n  edit them, then run `track merge --continue` again",
      );
    }
    let message = history.merging.message;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "-m" || args[i] === "--message") message = args[++i];
    }
    const c = commit(root, history, message);
    out(`${green("✓")} merge committed ${cyan(c.id)}`);
    out("  " + c.message);
    return;
  }

  const target = args.find((a) => !a.startsWith("-"));
  if (!target) die("usage: track merge <branch>   (or --abort / --continue)");

  let res;
  try {
    res = mergeBranch(root, history, target);
  } catch (err) {
    die(err.message);
  }

  if (res.status === "up-to-date") {
    out("Already up to date — nothing to merge.");
  } else if (res.status === "fast-forward") {
    out(`${green("✓")} fast-forwarded ${cyan(history.current)} to ${cyan(short(res.to))}`);
    const touched = res.tree.written.length + res.tree.removed.length;
    if (touched) out(dim(`  updated ${touched} file(s)`));
  } else if (res.status === "merged") {
    const n = Object.keys(res.commit.changes).length;
    out(`${green("✓")} merged into ${cyan(history.current)} as ${cyan(res.commit.id)}  ` +
      dim(`(${n} file${n === 1 ? "" : "s"})`));
    out("  " + res.commit.message);
  } else if (res.status === "conflict") {
    out(`${yellow("Merge has conflicts")} in ${res.files.length} file(s):`);
    for (const f of res.files) out("  " + red(f));
    out("");
    out("Edit each file to resolve the " + bold("<<<<<<< / ======= / >>>>>>>") + " markers,");
    out(`then run ${cyan("track merge --continue")}  (or ${cyan("track merge --abort")} to back out).`);
  }
}

async function cmdServe(args) {
  needRepo();
  const root = findRoot();
  let port = 7878;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p" || args[i] === "--port") port = parseInt(args[++i], 10);
  }
  serve(root, port);
}

function cmdHelp() {
  out(`${bold("track")} — a tiny local diff tracker (a minimal git replacement)

${bold("Usage:")}  track <command> [options]

${bold("Working with changes")}
  init                     Start tracking the current directory
  status                   Show what changed since the last commit
  commit -m "message"      Save a snapshot of all changes
  diff [a] [b]             Changes: working↔HEAD, working↔a, or a↔b
  log [--oneline] [--all]  List commits (default: history of current branch)
  show [ref]               Show a commit's diff (default: HEAD)
  ls [ref]                 List tracked files at a commit (default: HEAD)

${bold("Moving through history")}
  restore <ref> [file...]  Overwrite file(s)/tree from a commit (HEAD unchanged)
  checkout <ref> [file...] Switch branch/commit, or restore file(s)
  undo                     Un-commit the last commit, keep the edits
  reset <ref> [--hard]     Move the current branch to <ref> (--hard resets files)
  revert <ref>             New commit that undoes <ref>'s changes (history kept)

${bold("Branches & tags")}
  branch [name] [at]       List branches, or create one
  branch -d <name>         Delete a branch
  switch [-c] <name>       Switch branches (-c creates first)
  merge <branch>           Merge another branch into the current one (3-way)
  merge --continue         Finish a merge after resolving conflicts
  merge --abort            Cancel an in-progress merge
  tag [name] [at]          List tags, or create one
  tag -d <name>            Delete a tag

${bold("Viewing")}
  serve [-p port]          Phone-friendly web viewer (default port 7878)
  help                     Show this message

${bold("Referring to commits")}
  HEAD            the current commit          @3        the 3rd commit (see log)
  main / v1       a branch or tag name        HEAD~2    2 commits back
  a1b2c3d4        a commit id or unique prefix

${dim("All history lives in .track/history.json — one JSON file of diffs.")}`);
}

// ----- dispatch --------------------------------------------------------------

async function run(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "init": return cmdInit();
    case "status": case "st": return cmdStatus();
    case "commit": case "ci": return cmdCommit(args);
    case "log": return cmdLog(args);
    case "show": return cmdShow(args);
    case "diff": return cmdDiff(args);
    case "ls": return cmdLs(args);
    case "restore": return cmdRestore(args);
    case "checkout": case "co": return cmdCheckout(args);
    case "switch": return cmdSwitch(args);
    case "branch": return cmdBranch(args);
    case "tag": return cmdTag(args);
    case "revert": return cmdRevert(args);
    case "merge": return cmdMerge(args);
    case "undo": return cmdUndo();
    case "reset": return cmdReset(args);
    case "serve": return await cmdServe(args);
    case "help": case "--help": case "-h": case undefined: return cmdHelp();
    default:
      die(`unknown command: ${cmd}\nrun \`track help\` for usage`);
  }
}

// ----- entry point -----------------------------------------------------------
run(process.argv.slice(2)).catch((err) => {
  process.stderr.write("\x1b[31merror:\x1b[0m " + (err?.message || err) + "\n");
  process.exit(1);
});
