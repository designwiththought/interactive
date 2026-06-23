// The repository model. Everything lives in one JSON file: .track/history.json
//
// Shape:
// {
//   "version": 1,
//   "created": "<iso>",
//   "head": "<commit id | null>",
//   "commits": [
//     {
//       "id": "a1b2c3d4",
//       "parent": "<id | null>",
//       "message": "...",
//       "time": "<iso>",
//       "author": "name <email>",
//       "changes": {
//         "notes.txt": { "op": "add",    "diff": [ ...segments ] },
//         "old.txt":   { "op": "delete" },
//         "main.js":   { "op": "modify", "diff": [ ...segments ] }
//       }
//     }
//   ]
// }
//
// A file's content at any commit is rebuilt by replaying every commit's diff
// for that path, in order, starting from nothing. No blobs, no objects DB —
// just diffs referenced from a JSON file, exactly as requested.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  toLines,
  fromLines,
  diffLines,
  applyDiff,
  diffHasChanges,
} from "./diff.mjs";

export const TRACK_DIR = ".track";
const HISTORY_FILE = "history.json";
const IGNORE_FILE = ".trackignore";

// Always-ignored entries, on top of whatever .trackignore lists.
const DEFAULT_IGNORE = [TRACK_DIR, ".git", "node_modules", ".DS_Store"];

// ----- locating / loading the repo -------------------------------------------

// Walk up from `start` looking for a .track directory (like git does).
export function findRoot(start = process.cwd()) {
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

export function loadHistory(root) {
  const raw = fs.readFileSync(historyPath(root), "utf8");
  return JSON.parse(raw);
}

function saveHistory(root, history) {
  fs.writeFileSync(historyPath(root), JSON.stringify(history, null, 2) + "\n");
}

// ----- init ------------------------------------------------------------------

export function init(root = process.cwd()) {
  const dir = path.join(root, TRACK_DIR);
  if (fs.existsSync(path.join(dir, HISTORY_FILE))) {
    return { created: false, root };
  }
  fs.mkdirSync(dir, { recursive: true });
  const history = {
    version: 1,
    created: new Date().toISOString(),
    head: null,
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
export function scanWorkingTree(root) {
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
        const text = fs.readFileSync(abs, "utf8");
        files.set(rel, toLines(text));
      }
    }
  };
  walk(root);
  return new Map([...files.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// ----- reconstructing committed state ----------------------------------------

// Rebuild the full set of files as of a commit index (inclusive).
// Pass -1 for "empty" (before any commit). Returns Map<relPath, lines>.
export function reconstructAt(history, index) {
  const state = new Map();
  for (let c = 0; c <= index && c < history.commits.length; c++) {
    const { changes } = history.commits[c];
    for (const [file, change] of Object.entries(changes)) {
      if (change.op === "delete") {
        state.delete(file);
      } else if (change.op === "add") {
        state.set(file, applyDiff([], change.diff));
      } else if (change.op === "modify") {
        state.set(file, applyDiff(state.get(file) ?? [], change.diff));
      }
    }
  }
  return state;
}

export function indexOfCommit(history, id) {
  return history.commits.findIndex((c) => c.id === id);
}

export function headIndex(history) {
  if (!history.head) return -1;
  return indexOfCommit(history, history.head);
}

// Resolve a user-supplied ref: "HEAD", "head", a (possibly short) id, or a
// 1-based ordinal like "@3". Returns the commit index or -1.
export function resolveRef(history, ref) {
  if (!ref || ref.toLowerCase() === "head") return headIndex(history);
  if (/^@\d+$/.test(ref)) {
    const n = parseInt(ref.slice(1), 10);
    return n >= 1 && n <= history.commits.length ? n - 1 : -1;
  }
  // exact, then unique prefix
  let idx = indexOfCommit(history, ref);
  if (idx !== -1) return idx;
  const matches = history.commits
    .map((c, i) => [c.id, i])
    .filter(([id]) => id.startsWith(ref));
  return matches.length === 1 ? matches[0][1] : -1;
}

// ----- status ----------------------------------------------------------------

// Compare the working tree against HEAD. Returns categorized changes.
export function status(root, history) {
  const head = reconstructAt(history, headIndex(history));
  const work = scanWorkingTree(root);

  const added = [];
  const modified = [];
  const deleted = [];

  for (const [file, lines] of work) {
    if (!head.has(file)) {
      added.push(file);
    } else if (fromLines(head.get(file)) !== fromLines(lines)) {
      modified.push(file);
    }
  }
  for (const file of head.keys()) {
    if (!work.has(file)) deleted.push(file);
  }
  return { added, modified, deleted };
}

// ----- commit ----------------------------------------------------------------

function makeId(parent, changes, time) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ parent, changes, time }))
    .digest("hex")
    .slice(0, 8);
}

export function commit(root, history, message, author = "you") {
  const head = reconstructAt(history, headIndex(history));
  const work = scanWorkingTree(root);
  const changes = {};

  for (const [file, lines] of work) {
    if (!head.has(file)) {
      changes[file] = { op: "add", diff: diffLines([], lines) };
    } else {
      const diff = diffLines(head.get(file), lines);
      if (diffHasChanges(diff)) changes[file] = { op: "modify", diff };
    }
  }
  for (const file of head.keys()) {
    if (!work.has(file)) changes[file] = { op: "delete" };
  }

  if (Object.keys(changes).length === 0) return null; // nothing to commit

  const time = new Date().toISOString();
  const parent = history.head;
  const id = makeId(parent, changes, time);
  const commitObj = { id, parent, message, time, author, changes };

  history.commits.push(commitObj);
  history.head = id;
  saveHistory(root, history);
  return commitObj;
}

// ----- restore ---------------------------------------------------------------

// Write file(s) from a committed state back into the working tree.
// If `files` is empty, restore everything as of that commit (and remove tracked
// files that didn't exist then). Returns a summary of what changed on disk.
export function restore(root, history, index, files = []) {
  const state = reconstructAt(history, index);
  const written = [];
  const removed = [];

  const targets =
    files.length > 0 ? files : [...state.keys()];

  for (const file of targets) {
    const abs = path.join(root, file);
    if (state.has(file)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, fromLines(state.get(file)));
      written.push(file);
    } else if (files.length > 0) {
      // Explicitly asked to restore a file that didn't exist then: delete it.
      if (fs.existsSync(abs)) {
        fs.rmSync(abs);
        removed.push(file);
      }
    }
  }

  // Full restore also removes tracked files that postdate this commit.
  if (files.length === 0) {
    const work = scanWorkingTree(root);
    for (const file of work.keys()) {
      if (!state.has(file)) {
        fs.rmSync(path.join(root, file));
        removed.push(file);
      }
    }
  }
  return { written, removed };
}

export { fromLines } from "./diff.mjs";
