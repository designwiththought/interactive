// Verifies the single-file bundle in dist/track.mjs actually works standalone,
// so it can never silently drift from the source in src/. Rebuilds first, then
// drives the bundled file as a separate process in a temp repo.
//
// (This test uses child_process to exec node on the bundle — that's a test-time
// convenience on a full Node host. The shipped tool itself never spawns
// processes, which is what keeps it iOS-safe.)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const bundle = path.join(root, "dist", "track.mjs");

// Rebuild so the test reflects current source even if run on its own.
execFileSync("node", [path.join(root, "scripts", "bundle.mjs")], { stdio: "ignore" });
assert.ok(fs.existsSync(bundle), "bundle should exist after build");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  ✓ ${name}\n`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-bundle-"));
const track = (...args) =>
  execFileSync("node", [bundle, ...args], { cwd: dir, encoding: "utf8" });
const write = (f, t) => fs.writeFileSync(path.join(dir, f), t);

check("the single file has no external imports", () => {
  const text = fs.readFileSync(bundle, "utf8");
  assert.ok(!/from\s+["']\.\//.test(text), "no relative imports remain");
  // only node: core modules may be imported
  for (const m of text.matchAll(/^import\s+.*$/gm)) {
    assert.ok(/from\s+["']node:/.test(m[0]), `unexpected import: ${m[0]}`);
  }
});

check("init + commit + log work from the bundle", () => {
  track("init");
  write("readme.txt", "hello\n");
  track("commit", "-m", "first");
  const log = track("log", "--oneline");
  assert.ok(/first/.test(log), "log shows the commit");
});

check("branch + clean merge work from the bundle", () => {
  track("switch", "-c", "feature");
  write("readme.txt", "hello\nfrom feature\n");
  track("commit", "-m", "feature line");
  track("switch", "main");
  track("merge", "feature");
  assert.equal(fs.readFileSync(path.join(dir, "readme.txt"), "utf8"), "hello\nfrom feature\n");
});

check("switch -c carries uncommitted edits onto the new branch", () => {
  // dirty the tree, then branch off — the edit should come along, not be blocked
  const current = fs.readFileSync(path.join(dir, "readme.txt"), "utf8");
  write("readme.txt", current + "WIP edit\n");
  const outText = track("switch", "-c", "wip");
  assert.ok(/Switched to branch/.test(outText), "switch -c should succeed when dirty");
  assert.equal(
    fs.readFileSync(path.join(dir, "readme.txt"), "utf8"),
    current + "WIP edit\n",
    "uncommitted edit is preserved on the new branch",
  );
  track("commit", "-m", "save wip"); // leave a clean tree for the next test
});

check("restore brings a file back from history", () => {
  write("readme.txt", "totally different\n");
  track("commit", "-m", "rewrite");
  track("restore", "@1", "readme.txt");
  assert.equal(fs.readFileSync(path.join(dir, "readme.txt"), "utf8"), "hello\n");
});

fs.rmSync(dir, { recursive: true, force: true });
process.stdout.write(`\n${passed} bundle test(s) passed.\n`);
