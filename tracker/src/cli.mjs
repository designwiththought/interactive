// Command-line interface for `track`.
import process from "node:process";
import {
  init,
  findRoot,
  loadHistory,
  status,
  statusAgainst,
  isDirty,
  commit,
  getCommit,
  headCommitId,
  reconstructCommit,
  resolveRef,
  ancestry,
  decorations,
  restoreFiles,
  checkoutTree,
  createBranch,
  deleteBranch,
  switchTo,
  createTag,
  deleteTag,
  reset,
  revert,
  mergeBranch,
  abortMerge,
  conflictMarkers,
  reachable,
  scanWorkingTree,
  fromLines,
} from "./repo.mjs";
import { diffLines, renderDiff, diffStat } from "./diff.mjs";

// Exit quietly when our output is piped to a command that closes early
// (e.g. `track log | head`) instead of crashing with an EPIPE stack trace.
process.stdout.on("error", (err) => {
  if (err && err.code === "EPIPE") process.exit(0);
});
process.stderr.on("error", () => {});

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
  // Only block on uncommitted changes if switching would actually rewrite files
  // (i.e. the target is a different commit than where we are now).
  const targetId = resolveRef(history, target);
  if (!force && isDirty(root, history) && targetId !== headCommitId(history)) {
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
  if (!create && !Object.prototype.hasOwnProperty.call(history.branches, name))
    die(`no such branch: ${name} (use \`switch -c ${name}\` to create it)`);
  // Switching only rewrites files when the target is a *different* commit.
  // If it points at the current commit (always true for `switch -c`), it's a
  // no-op for files, so uncommitted edits are safe to carry across.
  const targetId = create ? headCommitId(history) : history.branches[name];
  if (isDirty(root, history) && targetId !== headCommitId(history))
    die("you have uncommitted changes — commit them first");
  if (create) {
    createBranch(root, history, name);
    out(`Created branch ${cyan(name)}`);
  }
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
  const { serve } = await import("./server.mjs");
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

export async function run(argv) {
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
