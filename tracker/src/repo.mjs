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
import { mergeStates } from "./merge.mjs";

export const TRACK_DIR = ".track";
const HISTORY_FILE = "history.json";
const IGNORE_FILE = ".trackignore";
const DEFAULT_BRANCH = "main";

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

export function loadHistory(root) {
  return migrate(JSON.parse(fs.readFileSync(historyPath(root), "utf8")));
}

function saveHistory(root, history) {
  fs.writeFileSync(historyPath(root), JSON.stringify(history, null, 2) + "\n");
}
export { saveHistory };

// ----- init ------------------------------------------------------------------

export function init(root = process.cwd()) {
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
        files.set(rel, toLines(fs.readFileSync(abs, "utf8")));
      }
    }
  };
  walk(root);
  return new Map([...files.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// ----- commit lookup & reconstruction ----------------------------------------

export function getCommit(history, id) {
  if (!id) return null;
  return history.commits.find((c) => c.id === id) || null;
}

export function currentBranch(history) {
  return history.current; // null when detached
}

// The commit id that HEAD currently points at (via branch tip or detached).
export function headCommitId(history) {
  if (history.current) return history.branches[history.current] ?? null;
  return history.detached ?? null;
}

// Commit objects from root → id (the ancestry path).
export function ancestry(history, id) {
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
export function reconstructCommit(history, id) {
  const state = new Map();
  for (const cmt of ancestry(history, id)) applyChanges(state, cmt.changes);
  return state;
}

export function reconstructHead(history) {
  return reconstructCommit(history, headCommitId(history));
}

// Resolve a ref to a commit id (or null). Understands:
//   HEAD, a branch name, a tag name, @N (1-based array ordinal),
//   a full id or unique prefix, and trailing ~N / ^ ancestor steps.
export function resolveRef(history, ref) {
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
export function decorations(history, id) {
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
export function statusAgainst(root, history, id) {
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

export function status(root, history) {
  return statusAgainst(root, history, headCommitId(history));
}

export function isDirty(root, history) {
  const s = status(root, history);
  return s.added.length + s.modified.length + s.deleted.length > 0;
}

// ----- commit ----------------------------------------------------------------

function makeId(parent, changes, time) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ parent, changes, time }))
    .digest("hex")
    .slice(0, 8);
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

export function commit(root, history, message, author = "you") {
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
export function restoreFiles(root, history, id, files) {
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
export function checkoutTree(root, history, id) {
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

export function createBranch(root, history, name, atId = undefined) {
  if (Object.prototype.hasOwnProperty.call(history.branches, name))
    throw new Error(`branch already exists: ${name}`);
  if (!/^[\w./-]+$/.test(name)) throw new Error(`invalid branch name: ${name}`);
  history.branches[name] = atId === undefined ? headCommitId(history) : atId;
  saveHistory(root, history);
}

export function deleteBranch(root, history, name) {
  if (!Object.prototype.hasOwnProperty.call(history.branches, name))
    throw new Error(`no such branch: ${name}`);
  if (history.current === name)
    throw new Error(`cannot delete the current branch: ${name}`);
  delete history.branches[name];
  saveHistory(root, history);
}

// Switch HEAD to a branch (by name) or detach onto a commit id.
export function switchTo(root, history, name) {
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

export function createTag(root, history, name, atId = undefined) {
  if (Object.prototype.hasOwnProperty.call(history.tags, name))
    throw new Error(`tag already exists: ${name}`);
  const id = atId === undefined ? headCommitId(history) : atId;
  if (!id) throw new Error("nothing to tag yet");
  history.tags[name] = id;
  saveHistory(root, history);
}

export function deleteTag(root, history, name) {
  if (!Object.prototype.hasOwnProperty.call(history.tags, name))
    throw new Error(`no such tag: ${name}`);
  delete history.tags[name];
  saveHistory(root, history);
}

// ----- reset / undo ----------------------------------------------------------

// Move the current branch to a commit. `hard` also rewrites the working tree;
// otherwise the working tree is left alone (changes resurface as uncommitted).
export function reset(root, history, id, { hard = false } = {}) {
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
export function revert(root, history, id, author = "you") {
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
export function parentsOf(commit) {
  if (!commit) return [];
  return [commit.parent, commit.parent2].filter(Boolean);
}

// Every commit reachable from `id` by following both parents.
export function reachable(history, id) {
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
export function mergeBase(history, a, b) {
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
export function mergeBranch(root, history, theirsRef) {
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
export function abortMerge(root, history) {
  if (!history.merging) throw new Error("no merge in progress");
  const tree = checkoutTree(root, history, headCommitId(history));
  delete history.merging;
  saveHistory(root, history);
  return tree;
}

// Are there leftover conflict markers in the working tree?
export function conflictMarkers(root) {
  const files = [];
  for (const [file, lines] of scanWorkingTree(root)) {
    if (lines.some((l) => l.startsWith("<<<<<<< ") || l.startsWith(">>>>>>> ")))
      files.push(file);
  }
  return files;
}

export { fromLines } from "./diff.mjs";
