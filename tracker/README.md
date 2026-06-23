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

**Branches & tags**
```
track branch [name] [at]       List branches, or create one
track branch -d <name>         Delete a branch
track switch [-c] <name>       Switch branches (-c creates first)
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

## What it deliberately does not do

No **merging** of branches, no **remotes**/networking, and no staging area —
every commit snapshots the whole working tree. Branches and tags exist, but
bringing two branches back together is left to you (commit the combined files on
one branch). That keeps it tiny and predictable. Your history is plain JSON, so
it's easy to migrate if you outgrow it.

## Ignoring files

A `.trackignore` file (created by `init`) lists patterns to skip, one per line.
`.track`, `.git`, `node_modules`, and `.DS_Store` are always ignored.

## Tests

```bash
npm test        # or: node test/run.mjs
```
