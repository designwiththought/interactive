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
  reconstructAt,
  headIndex,
  resolveRef,
  restore,
} from "../src/repo.mjs";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n    ${err.message}\n`);
    process.exitCode = 1;
  }
}

// ----- diff engine ----------------------------------------------------------

test("toLines/fromLines round-trips trailing newline", () => {
  for (const s of ["", "a", "a\n", "a\nb", "a\nb\n", "\n\n"]) {
    assert.equal(fromLines(toLines(s)), s);
  }
});

test("applyDiff reproduces target for many random-ish cases", () => {
  const cases = [
    [[], ["a", "b"]],
    [["a", "b"], []],
    [["a", "b", "c"], ["a", "x", "c"]],
    [["a", "b", "c", "d"], ["b", "c", "d", "e"]],
    [["1", "2", "3"], ["1", "2", "3"]],
    [["keep", "old", "keep"], ["keep", "new1", "new2", "keep"]],
  ];
  for (const [a, b] of cases) {
    const segs = diffLines(a, b);
    assert.deepEqual(applyDiff(a, segs), b);
  }
});

test("diffHasChanges is false for identical input", () => {
  assert.equal(diffHasChanges(diffLines(["a", "b"], ["a", "b"])), false);
  assert.equal(diffHasChanges(diffLines(["a"], ["a", "b"])), true);
});

test("diffStat counts adds and removes", () => {
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

test("commit captures adds, then reconstructs them", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");
  fs.writeFileSync(path.join(dir, "b.txt"), "one\n");
  let h = loadHistory(dir);
  const c1 = commit(dir, h, "first");
  assert.ok(c1, "should produce a commit");

  h = loadHistory(dir);
  const state = reconstructAt(h, headIndex(h));
  assert.equal(fromLines(state.get("a.txt")), "hello\nworld\n");
  assert.equal(fromLines(state.get("b.txt")), "one\n");
});

test("status detects add / modify / delete", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  fs.writeFileSync(path.join(dir, "b.txt"), "y\n");
  let h = loadHistory(dir);
  commit(dir, h, "init");
  h = loadHistory(dir);

  fs.writeFileSync(path.join(dir, "a.txt"), "x\nmore\n"); // modify
  fs.writeFileSync(path.join(dir, "c.txt"), "z\n"); // add
  fs.rmSync(path.join(dir, "b.txt")); // delete

  const s = status(dir, h);
  assert.deepEqual(s.added, ["c.txt"]);
  assert.deepEqual(s.modified, ["a.txt"]);
  assert.deepEqual(s.deleted, ["b.txt"]);
});

test("empty commit returns null", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  let h = loadHistory(dir);
  commit(dir, h, "init");
  h = loadHistory(dir);
  assert.equal(commit(dir, h, "again"), null);
});

test("history walks several commits and reconstructs each", () => {
  const dir = tmpRepo();
  const file = path.join(dir, "log.txt");

  fs.writeFileSync(file, "v1\n");
  let h = loadHistory(dir);
  commit(dir, h, "v1");

  fs.writeFileSync(file, "v1\nv2\n");
  h = loadHistory(dir);
  commit(dir, h, "v2");

  fs.writeFileSync(file, "v2\n");
  h = loadHistory(dir);
  commit(dir, h, "v3");

  h = loadHistory(dir);
  assert.equal(fromLines(reconstructAt(h, 0).get("log.txt")), "v1\n");
  assert.equal(fromLines(reconstructAt(h, 1).get("log.txt")), "v1\nv2\n");
  assert.equal(fromLines(reconstructAt(h, 2).get("log.txt")), "v2\n");
});

test("restore brings an old version back to the working tree", () => {
  const dir = tmpRepo();
  const file = path.join(dir, "doc.txt");
  fs.writeFileSync(file, "original\n");
  let h = loadHistory(dir);
  commit(dir, h, "first");

  fs.writeFileSync(file, "changed\n");
  h = loadHistory(dir);
  commit(dir, h, "second");

  h = loadHistory(dir);
  restore(dir, h, 0); // back to first commit
  assert.equal(fs.readFileSync(file, "utf8"), "original\n");
});

test("restore removes files that postdate the target commit", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  let h = loadHistory(dir);
  commit(dir, h, "only a");

  fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
  h = loadHistory(dir);
  commit(dir, h, "add b");

  h = loadHistory(dir);
  restore(dir, h, 0); // a-only state
  assert.ok(fs.existsSync(path.join(dir, "a.txt")));
  assert.ok(!fs.existsSync(path.join(dir, "b.txt")));
});

test("resolveRef understands HEAD, ordinals, ids and prefixes", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  let h = loadHistory(dir);
  const c1 = commit(dir, h, "one");
  fs.writeFileSync(path.join(dir, "a.txt"), "2\n");
  h = loadHistory(dir);
  const c2 = commit(dir, h, "two");
  h = loadHistory(dir);

  assert.equal(resolveRef(h, "HEAD"), 1);
  assert.equal(resolveRef(h, "@1"), 0);
  assert.equal(resolveRef(h, c1.id), 0);
  assert.equal(resolveRef(h, c1.id.slice(0, 4)), 0);
  assert.equal(resolveRef(h, c2.id), 1);
});

test("nested directories are tracked", () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, "sub"));
  fs.writeFileSync(path.join(dir, "sub", "deep.txt"), "deep\n");
  let h = loadHistory(dir);
  commit(dir, h, "nested");
  h = loadHistory(dir);
  const state = reconstructAt(h, headIndex(h));
  assert.equal(fromLines(state.get("sub/deep.txt")), "deep\n");
});

test(".track itself is never tracked", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  const work = scanWorkingTree(dir);
  for (const key of work.keys()) {
    assert.ok(!key.startsWith(".track/"), `unexpected tracked path: ${key}`);
    assert.notEqual(key, "history.json");
  }
});

process.stdout.write(`\n${passed} test(s) passed.\n`);
