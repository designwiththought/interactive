// Plain-Node test runner — no framework. Run with: node test/run.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  toLines,
  fromLines,
  diffLines,
  applyDiff,
  diffHasChanges,
  diffStat,
} from "../src/diff.mjs";
import {
  init,
  loadHistory,
  scanWorkingTree,
  status,
  commit,
  getCommit,
  headCommitId,
  reconstructCommit,
  resolveRef,
  restoreFiles,
  checkoutTree,
  createBranch,
  switchTo,
  createTag,
  reset,
  revert,
  mergeBranch,
  abortMerge,
  mergeBase,
  conflictMarkers,
} from "../src/repo.mjs";
import { merge3Lines } from "../src/merge.mjs";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n    ${err.stack || err.message}\n`);
    process.exitCode = 1;
  }
}

// ----- diff engine ----------------------------------------------------------

test("toLines/fromLines round-trips trailing newline", () => {
  for (const s of ["", "a", "a\n", "a\nb", "a\nb\n", "\n\n"]) {
    assert.equal(fromLines(toLines(s)), s);
  }
});

test("applyDiff reproduces target for many cases", () => {
  const cases = [
    [[], ["a", "b"]],
    [["a", "b"], []],
    [["a", "b", "c"], ["a", "x", "c"]],
    [["a", "b", "c", "d"], ["b", "c", "d", "e"]],
    [["1", "2", "3"], ["1", "2", "3"]],
    [["keep", "old", "keep"], ["keep", "new1", "new2", "keep"]],
  ];
  for (const [a, b] of cases) assert.deepEqual(applyDiff(a, diffLines(a, b)), b);
});

test("diffHasChanges / diffStat", () => {
  assert.equal(diffHasChanges(diffLines(["a", "b"], ["a", "b"])), false);
  const st = diffStat(diffLines(["a", "b", "c"], ["a", "x", "y", "c"]));
  assert.equal(st.added, 2);
  assert.equal(st.removed, 1);
});

// ----- repo end-to-end ------------------------------------------------------

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-test-"));
  init(dir);
  return dir;
}
function write(dir, file, text) {
  const abs = path.join(dir, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), "utf8");
}
function reload(dir) {
  return loadHistory(dir);
}
// commit helper that reloads history first (mirrors CLI usage)
function ci(dir, msg) {
  return commit(dir, reload(dir), msg);
}

test("commit captures adds, then reconstructs them", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "hello\nworld\n");
  write(dir, "b.txt", "one\n");
  ci(dir, "first");
  const h = reload(dir);
  const state = reconstructCommit(h, headCommitId(h));
  assert.equal(fromLines(state.get("a.txt")), "hello\nworld\n");
  assert.equal(fromLines(state.get("b.txt")), "one\n");
});

test("status detects add / modify / delete", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "x\n");
  write(dir, "b.txt", "y\n");
  ci(dir, "init");
  write(dir, "a.txt", "x\nmore\n");
  write(dir, "c.txt", "z\n");
  fs.rmSync(path.join(dir, "b.txt"));
  const s = status(dir, reload(dir));
  assert.deepEqual(s.added, ["c.txt"]);
  assert.deepEqual(s.modified, ["a.txt"]);
  assert.deepEqual(s.deleted, ["b.txt"]);
});

test("empty commit returns null", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "x\n");
  ci(dir, "init");
  assert.equal(ci(dir, "again"), null);
});

test("history walks several commits and reconstructs each", () => {
  const dir = tmpRepo();
  write(dir, "log.txt", "v1\n");
  const c1 = ci(dir, "v1");
  write(dir, "log.txt", "v1\nv2\n");
  const c2 = ci(dir, "v2");
  write(dir, "log.txt", "v2\n");
  const c3 = ci(dir, "v3");
  const h = reload(dir);
  assert.equal(fromLines(reconstructCommit(h, c1.id).get("log.txt")), "v1\n");
  assert.equal(fromLines(reconstructCommit(h, c2.id).get("log.txt")), "v1\nv2\n");
  assert.equal(fromLines(reconstructCommit(h, c3.id).get("log.txt")), "v2\n");
});

test("restoreFiles brings an old version of one file back", () => {
  const dir = tmpRepo();
  write(dir, "doc.txt", "original\n");
  const c1 = ci(dir, "first");
  write(dir, "doc.txt", "changed\n");
  ci(dir, "second");
  restoreFiles(dir, reload(dir), c1.id, ["doc.txt"]);
  assert.equal(read(dir, "doc.txt"), "original\n");
});

test("checkoutTree removes files that postdate the target commit", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "a\n");
  const c1 = ci(dir, "only a");
  write(dir, "b.txt", "b\n");
  ci(dir, "add b");
  checkoutTree(dir, reload(dir), c1.id);
  assert.ok(fs.existsSync(path.join(dir, "a.txt")));
  assert.ok(!fs.existsSync(path.join(dir, "b.txt")));
});

test("resolveRef: HEAD, ordinals, ids, prefixes, ancestors", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "1\n");
  const c1 = ci(dir, "one");
  write(dir, "a.txt", "2\n");
  const c2 = ci(dir, "two");
  const h = reload(dir);
  assert.equal(resolveRef(h, "HEAD"), c2.id);
  assert.equal(resolveRef(h, "@1"), c1.id);
  assert.equal(resolveRef(h, c1.id), c1.id);
  assert.equal(resolveRef(h, c1.id.slice(0, 4)), c1.id);
  assert.equal(resolveRef(h, "HEAD~1"), c1.id);
  assert.equal(resolveRef(h, "main"), c2.id);
});

test("nested directories are tracked", () => {
  const dir = tmpRepo();
  write(dir, "sub/deep.txt", "deep\n");
  ci(dir, "nested");
  const h = reload(dir);
  assert.equal(fromLines(reconstructCommit(h, headCommitId(h)).get("sub/deep.txt")), "deep\n");
});

test(".track itself is never tracked", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "a\n");
  for (const key of scanWorkingTree(dir).keys()) {
    assert.ok(!key.startsWith(".track/"), `unexpected: ${key}`);
    assert.notEqual(key, "history.json");
  }
});

// ----- new git-style features ------------------------------------------------

test("undo (soft reset) un-commits but keeps edits", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "1\n");
  const c1 = ci(dir, "first");
  write(dir, "a.txt", "1\n2\n");
  ci(dir, "second");

  let h = reload(dir);
  reset(dir, h, c1.id, { hard: false }); // == undo
  // file unchanged on disk, but the commit is no longer HEAD
  assert.equal(read(dir, "a.txt"), "1\n2\n");
  h = reload(dir);
  assert.equal(headCommitId(h), c1.id);
  // and the dropped change now shows as uncommitted
  assert.deepEqual(status(dir, h).modified, ["a.txt"]);
});

test("reset --hard moves branch and rewrites the working tree", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "1\n");
  const c1 = ci(dir, "first");
  write(dir, "a.txt", "1\n2\n");
  ci(dir, "second");
  reset(dir, reload(dir), c1.id, { hard: true });
  assert.equal(read(dir, "a.txt"), "1\n");
  assert.equal(headCommitId(reload(dir)), c1.id);
});

test("revert undoes a commit as a new commit (history kept)", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "base\n");
  ci(dir, "base");
  write(dir, "a.txt", "base\nbad line\n");
  const bad = ci(dir, "add bad line");

  const before = reload(dir).commits.length;
  const rev = revert(dir, reload(dir), bad.id);
  assert.ok(rev, "revert should create a commit");
  assert.equal(read(dir, "a.txt"), "base\n"); // working tree fixed
  const h = reload(dir);
  assert.equal(h.commits.length, before + 1); // history preserved, new commit added
  assert.equal(fromLines(reconstructCommit(h, headCommitId(h)).get("a.txt")), "base\n");
});

test("revert of an 'add' deletes the file", () => {
  const dir = tmpRepo();
  write(dir, "keep.txt", "k\n");
  ci(dir, "base");
  write(dir, "temp.txt", "t\n");
  const added = ci(dir, "add temp");
  revert(dir, reload(dir), added.id);
  assert.ok(!fs.existsSync(path.join(dir, "temp.txt")));
  assert.ok(fs.existsSync(path.join(dir, "keep.txt")));
});

test("branches diverge and reconstruct independently", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "base\n");
  const base = ci(dir, "base");

  // make a feature branch at base, switch to it, commit there
  let h = reload(dir);
  createBranch(dir, h, "feature", base.id);
  switchTo(dir, reload(dir), "feature");
  write(dir, "a.txt", "base\nfeature work\n");
  const feat = ci(dir, "feature work");

  // back to main, commit something else
  switchTo(dir, reload(dir), "main");
  assert.equal(read(dir, "a.txt"), "base\n"); // working tree reset to main's tip
  write(dir, "a.txt", "base\nmain work\n");
  const mainC = ci(dir, "main work");

  h = reload(dir);
  assert.equal(h.branches.feature, feat.id);
  assert.equal(h.branches.main, mainC.id);
  assert.equal(fromLines(reconstructCommit(h, feat.id).get("a.txt")), "base\nfeature work\n");
  assert.equal(fromLines(reconstructCommit(h, mainC.id).get("a.txt")), "base\nmain work\n");
});

test("switching branches rewrites the working tree", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "base\n");
  ci(dir, "base");
  let h = reload(dir);
  createBranch(dir, h, "feature");
  switchTo(dir, reload(dir), "feature");
  write(dir, "feature-only.txt", "f\n");
  ci(dir, "feature file");
  switchTo(dir, reload(dir), "main");
  assert.ok(!fs.existsSync(path.join(dir, "feature-only.txt")));
  switchTo(dir, reload(dir), "feature");
  assert.ok(fs.existsSync(path.join(dir, "feature-only.txt")));
});

test("tags resolve as refs", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "1\n");
  const c1 = ci(dir, "one");
  createTag(dir, reload(dir), "v1", c1.id);
  assert.equal(resolveRef(reload(dir), "v1"), c1.id);
});

test("v1 history migrates to branch-aware v2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-mig-"));
  fs.mkdirSync(path.join(dir, ".track"));
  // hand-write a legacy v1 history
  const legacy = {
    version: 1,
    created: "2020-01-01T00:00:00.000Z",
    head: "abcd1234",
    commits: [
      {
        id: "abcd1234",
        parent: null,
        message: "legacy",
        time: "2020-01-01T00:00:00.000Z",
        author: "you",
        changes: { "a.txt": { op: "add", diff: [["+", ["legacy\n"]]] } },
      },
    ],
  };
  fs.writeFileSync(path.join(dir, ".track", "history.json"), JSON.stringify(legacy));
  const h = loadHistory(dir);
  assert.equal(h.version, 2);
  assert.equal(h.current, "main");
  assert.equal(h.branches.main, "abcd1234");
  assert.equal(headCommitId(h), "abcd1234");
  assert.equal(resolveRef(h, "HEAD"), "abcd1234");
});

// ----- merge engine ----------------------------------------------------------

const L = { ours: "ours", theirs: "theirs" };

test("merge3: non-overlapping edits combine cleanly", () => {
  const base = ["one", "two", "three"];
  const ours = ["ONE", "two", "three"]; // changed first line
  const theirs = ["one", "two", "THREE"]; // changed last line
  const m = merge3Lines(base, ours, theirs, L);
  assert.equal(m.conflicted, false);
  assert.deepEqual(m.lines, ["ONE", "two", "THREE"]);
});

test("merge3: same edit on both sides is not a conflict", () => {
  const base = ["a", "b"];
  const m = merge3Lines(base, ["a", "B"], ["a", "B"], L);
  assert.equal(m.conflicted, false);
  assert.deepEqual(m.lines, ["a", "B"]);
});

test("merge3: competing edits to the same line conflict", () => {
  const base = ["a", "b", "c"];
  const m = merge3Lines(base, ["a", "X", "c"], ["a", "Y", "c"], L);
  assert.equal(m.conflicted, true);
  assert.ok(m.lines.includes("<<<<<<< ours"));
  assert.ok(m.lines.includes("======="));
  assert.ok(m.lines.includes(">>>>>>> theirs"));
  assert.ok(m.lines.includes("X"));
  assert.ok(m.lines.includes("Y"));
});

test("merge3: insertions on one side only are kept", () => {
  const base = ["a", "c"];
  const m = merge3Lines(base, ["a", "b", "c"], ["a", "c"], L);
  assert.equal(m.conflicted, false);
  assert.deepEqual(m.lines, ["a", "b", "c"]);
});

// ----- merge end-to-end ------------------------------------------------------

function setupBranches(dir) {
  // base commit on main, then a feature branch diverges
  write(dir, "page.html", "<h1>Title</h1>\n<p>body</p>\n");
  ci(dir, "base");
  let h = reload(dir);
  createBranch(dir, h, "feature");
}

test("merge: fast-forward when main has no new commits", () => {
  const dir = tmpRepo();
  setupBranches(dir);
  switchTo(dir, reload(dir), "feature");
  write(dir, "page.html", "<h1>Title</h1>\n<p>new body</p>\n");
  ci(dir, "feature edit");
  switchTo(dir, reload(dir), "main");
  const res = mergeBranch(dir, reload(dir), "feature");
  assert.equal(res.status, "fast-forward");
  assert.equal(read(dir, "page.html"), "<h1>Title</h1>\n<p>new body</p>\n");
});

test("merge: clean 3-way merge creates a 2-parent commit", () => {
  const dir = tmpRepo();
  setupBranches(dir);

  // feature changes the <p>
  switchTo(dir, reload(dir), "feature");
  write(dir, "page.html", "<h1>Title</h1>\n<p>FEATURE body</p>\n");
  const feat = ci(dir, "feature body");

  // main changes the <h1> (different line)
  switchTo(dir, reload(dir), "main");
  write(dir, "page.html", "<h1>NEW Title</h1>\n<p>body</p>\n");
  const mainC = ci(dir, "main title");

  const res = mergeBranch(dir, reload(dir), "feature");
  assert.equal(res.status, "merged");
  // both edits present, no markers
  assert.equal(read(dir, "page.html"), "<h1>NEW Title</h1>\n<p>FEATURE body</p>\n");
  // merge commit records both parents
  assert.equal(res.commit.parent, mainC.id);
  assert.equal(res.commit.parent2, feat.id);
  // and HEAD reconstructs to the merged content
  const h = reload(dir);
  assert.equal(
    fromLines(reconstructCommit(h, headCommitId(h)).get("page.html")),
    "<h1>NEW Title</h1>\n<p>FEATURE body</p>\n",
  );
});

test("merge: conflicting edits leave markers and pause for resolution", () => {
  const dir = tmpRepo();
  setupBranches(dir);

  switchTo(dir, reload(dir), "feature");
  write(dir, "page.html", "<h1>Title</h1>\n<p>FEATURE</p>\n");
  ci(dir, "feature p");

  switchTo(dir, reload(dir), "main");
  write(dir, "page.html", "<h1>Title</h1>\n<p>MAIN</p>\n"); // same line, different
  ci(dir, "main p");

  const res = mergeBranch(dir, reload(dir), "feature");
  assert.equal(res.status, "conflict");
  assert.deepEqual(res.files, ["page.html"]);
  assert.ok(read(dir, "page.html").includes("<<<<<<< main"));
  assert.deepEqual(conflictMarkers(dir), ["page.html"]);

  // resolve, then commit completes the merge with two parents
  write(dir, "page.html", "<h1>Title</h1>\n<p>RESOLVED</p>\n");
  const h = reload(dir);
  assert.ok(h.merging, "merge state is pending");
  const c = commit(dir, h, h.merging.message);
  assert.ok(c.parent2, "completed merge has a second parent");
  assert.equal(read(dir, "page.html"), "<h1>Title</h1>\n<p>RESOLVED</p>\n");
  assert.ok(!reload(dir).merging, "merge state cleared after commit");
});

test("merge --abort restores the pre-merge tree", () => {
  const dir = tmpRepo();
  setupBranches(dir);
  switchTo(dir, reload(dir), "feature");
  write(dir, "page.html", "<h1>Title</h1>\n<p>FEATURE</p>\n");
  ci(dir, "feature p");
  switchTo(dir, reload(dir), "main");
  write(dir, "page.html", "<h1>Title</h1>\n<p>MAIN</p>\n");
  ci(dir, "main p");

  mergeBranch(dir, reload(dir), "feature");
  assert.ok(reload(dir).merging);
  abortMerge(dir, reload(dir));
  assert.ok(!reload(dir).merging);
  assert.equal(read(dir, "page.html"), "<h1>Title</h1>\n<p>MAIN</p>\n");
});

test("mergeBase finds the common ancestor", () => {
  const dir = tmpRepo();
  write(dir, "a.txt", "1\n");
  const base = ci(dir, "base");
  let h = reload(dir);
  createBranch(dir, h, "feature");
  switchTo(dir, reload(dir), "feature");
  write(dir, "a.txt", "1\n2\n");
  const feat = ci(dir, "feature");
  switchTo(dir, reload(dir), "main");
  write(dir, "a.txt", "1\n0\n");
  const mainC = ci(dir, "main");
  assert.equal(mergeBase(reload(dir), mainC.id, feat.id), base.id);
});

process.stdout.write(`\n${passed} test(s) passed.\n`);
