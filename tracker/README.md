# ◇ track — a tiny local diff tracker

A minimal, single-purpose stand-in for git that you can run anywhere Node runs —
including the **Code app on iPhone** or a terminal on your **Mac**. It has **zero
dependencies** (only Node built-ins) and stores your entire history as **diffs in
one JSON file**: `.track/history.json`.

It is intentionally small and easy to read — the whole thing is ~4 short files.

## Why / how it works

There is no object database and there are no blob files. Each commit records, per
changed file, a compact self-describing diff:

```jsonc
["=", 1]                 // keep 1 unchanged line
["-", ["line two"]]      // remove these lines
["+", ["line two CHANGED", "line three"]]  // insert these lines
```

To get a file's contents at any commit, `track` walks that commit's parent chain
back to the start and replays each diff in order. Following parent pointers (not
file order) is what lets **branches** reconstruct correctly. That's the whole
model — "a JSON file that references diffs," exactly. You can open
`.track/history.json` and read your history by hand.

## Install / run

Pick whichever fits how you work. All three are dependency-free.

**1. Single file (most portable — best for iPhone).**
`dist/track.mjs` is the whole tool inlined into one file. Copy just that file
anywhere — a project folder, iCloud Drive — and run it. Nothing else needs to be
present:

```bash
node track.mjs <command>      # e.g. node track.mjs init
```

Rebuild it after changing the source with `npm run bundle`.

**2. Global command (Mac and the iOS Code app).**
Because `track` is pure JS with no native code, it installs globally the same way
`tsc`/`prettier` do — which the Code app supports in its terminal:

```bash
cd tracker
npm install -g .              # now `track` works in any folder
track <command>
```

**3. Straight from the source folder.**

```bash
node bin/track.mjs <command>
```

## Commands

**Working with changes**
```
track init                     Start tracking the current directory
track status                   Show what changed since the last commit
track commit -m "message"      Save a snapshot of all changes
track diff [a] [b]             Changes: working↔HEAD, working↔a, or a↔b
track log [--oneline] [--all]  List commits (default: current branch's history)
track show [ref]               Show a commit's diff (default: HEAD)
track ls [ref]                 List tracked files at a commit (default: HEAD)
```

**Moving through history**
```
track restore <ref> [file...]  Overwrite file(s)/tree from a commit (HEAD unchanged)
track checkout <ref> [file...] Switch branch/commit, or restore file(s)
track undo                     Un-commit the last commit, keep the edits
track reset <ref> [--hard]     Move current branch to <ref> (--hard resets files)
track revert <ref>             New commit that undoes <ref>'s changes (history kept)
```

**Branches, merging & tags**
```
track branch [name] [at]       List branches, or create one
track branch -d <name>         Delete a branch
track switch [-c] <name>       Switch branches (-c creates first)
track merge <branch>           Merge another branch into the current one (3-way)
track merge --continue         Finish a merge after resolving conflicts
track merge --abort            Cancel an in-progress merge
track tag [name] [at]          List tags, or create one
track tag -d <name>            Delete a tag
```

**Viewing**
```
track serve [-p port]          Phone-friendly web viewer (default http://localhost:7878)
track help                     Show usage
```

### Referring to commits

| Ref         | Means                                              |
|-------------|----------------------------------------------------|
| `HEAD`      | the current commit                                 |
| `main`,`v1` | a branch or tag name                               |
| `@3`        | the 3rd commit (ordinals are shown in `track log`) |
| `HEAD~2`    | 2 commits back (also `<ref>^`)                     |
| `a1b2c3d4`  | a commit id, or any unique prefix of one           |

### How revert, undo, and reset differ

- **`revert <ref>`** keeps history: it adds a *new* commit that undoes the
  changes from `<ref>` (it resets the files that commit touched back to their
  pre-commit state). Safe to share — nothing is rewritten.
- **`undo`** removes the last commit from the branch but leaves your files
  alone, so the changes reappear as uncommitted edits you can fix and re-commit.
- **`reset <ref>`** moves the current branch to any commit. Add `--hard` to also
  rewrite the working tree to match (this discards uncommitted changes).

### Merging a branch (the visual-edits workflow)

Make changes on a branch, then bring them into `main`:

```bash
track switch -c restyle      # branch off main
# ...edit your HTML/CSS/JS in your editor...
track commit -m "new hero section"

track switch main
track merge restyle          # 3-way merge into main
```

- **Edits to different lines** combine automatically — no conflict.
- **Edits to the same lines** stop the merge and write conflict markers into the
  affected files:

  ```
  <<<<<<< main
  ...what main has...
  =======
  ...what restyle has...
  >>>>>>> restyle
  ```

  Open those files in your editor, delete the markers, keep the lines you want,
  then finish with `track merge --continue` (or bail out with
  `track merge --abort`). `track status` lists the files still needing
  attention while a merge is in progress.

A merge records a commit with **two parents**, so `track log` and the web viewer
show exactly where the branch came back together. If `main` hasn't moved since
you branched, the merge is a clean **fast-forward** (no merge commit needed).

## A quick tour

```bash
track init
echo "first note" > notes.txt
track status                       # → notes.txt is "added"
track commit -m "start notes"

echo "another note" >> notes.txt
track diff                         # see the change before saving
track commit -m "second note"

track log                          # two commits, newest first
track show @1                      # what the first commit changed
track restore @1                   # roll the whole tree back to commit 1

# branching and undoing
track switch -c draft              # new branch "draft", switch to it
echo "risky idea" >> notes.txt
track commit -m "try an idea"
track switch main                  # notes.txt reverts to main's version
track tag good HEAD                # name this commit "good"
track revert good~0                # safely undo a commit as a new commit
track undo                         # un-commit the last commit, keep the edits
```

## On your phone

Run `track serve` and open the printed `http://localhost:PORT` address in the
Code app's preview pane or Safari. You get a tappable list of commits and a
color diff for each — easier than a terminal on a small screen. The viewer is
read-only; commits are still made from the command line.

## Portability (why it runs in iOS code editors)

The whole tool is plain ES modules with **no dependencies and no native code**:

- The **core** (init/commit/diff/log/show/branch/merge/…) imports only
  `node:fs` and `node:path` — the two most universally available modules. Commit
  ids use a small pure-JS hash, so there's **no `node:crypto`/OpenSSL** requirement.
- It never spawns subprocesses (`child_process`), uses no worker threads, and
  loads no `.node` native add-ons — all of which iOS sandboxes forbid.
- The optional `track serve` viewer adds `node:http`, binding a **localhost**
  port. iOS Node editors (e.g. the Code app) allow loopback servers — you open
  `http://localhost:PORT` in the side-by-side browser. If a build ever refused
  to bind a port, every other command still works without it.

In short: if the app can run a `.mjs` file with Node at all, `track` works.

## What it deliberately does not do

No **remotes**/networking and no staging area — every commit snapshots the whole
working tree. Conflict resolution is manual (edit the markers), and the
merge-base finder assumes a single common ancestor, which is true for ordinary
branch-and-merge workflows. That keeps it tiny and predictable. Your history is
plain JSON, so it's easy to migrate if you outgrow it.

## Ignoring files

A `.trackignore` file (created by `init`) lists patterns to skip, one per line.
`.track`, `.git`, `node_modules`, and `.DS_Store` are always ignored.

## Tests

```bash
npm test        # unit tests, then rebuilds dist/track.mjs and tests the bundle
```

`npm test` also regenerates the single-file bundle and runs it end-to-end, so
`dist/track.mjs` can't silently drift from the source in `src/`.
