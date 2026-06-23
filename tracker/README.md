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

To get a file's contents at any commit, `track` replays every diff for that path
from the beginning. That's the whole model — "a JSON file that references diffs,"
exactly. You can open `.track/history.json` and read your history by hand.

## Install / run

No install needed. From inside the `tracker/` folder:

```bash
node bin/track.mjs <command>
```

To get a global `track` command on your Mac (optional):

```bash
cd tracker
npm link        # now `track` works anywhere
```

In the iPhone **Code** app (or a-Shell), open this folder and run
`node bin/track.mjs <command>` the same way.

## Commands

```
track init                     Start tracking the current directory
track status                   Show what changed since the last commit
track commit -m "message"      Save a snapshot of all changes
track log [--oneline]          List commits, newest first
track show [commit]            Show a commit's diff (default: HEAD)
track diff [commit]            Show working-tree changes vs a commit (default: HEAD)
track ls [commit]              List tracked files at a commit (default: HEAD)
track restore <commit> [file]  Bring file(s) back (no file args = whole tree)
track serve [-p port]          Phone-friendly web viewer (default http://localhost:7878)
track help                     Show usage
```

### Referring to commits

| Ref         | Means                                            |
|-------------|--------------------------------------------------|
| `HEAD`      | the latest commit                                |
| `@3`        | the 3rd commit (ordinals are shown in `track log`) |
| `a1b2c3d4`  | a commit id, or any unique prefix of one         |

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
```

## On your phone

Run `track serve` and open the printed `http://localhost:PORT` address in the
Code app's preview pane or Safari. You get a tappable list of commits and a
color diff for each — easier than a terminal on a small screen. The viewer is
read-only; commits are still made from the command line.

## What it deliberately does not do

No branches, no merges, no remotes, no networking, no staging area (every commit
snapshots the whole working tree). That keeps it tiny and predictable. If you
outgrow it, your history is plain JSON and easy to migrate.

## Ignoring files

A `.trackignore` file (created by `init`) lists patterns to skip, one per line.
`.track`, `.git`, `node_modules`, and `.DS_Store` are always ignored.

## Tests

```bash
npm test        # or: node test/run.mjs
```
