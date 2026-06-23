// Command-line interface for `track`.
import process from "node:process";
import {
  init,
  findRoot,
  loadHistory,
  status,
  commit,
  reconstructAt,
  resolveRef,
  restore,
  scanWorkingTree,
  fromLines,
} from "./repo.mjs";
import { diffLines, renderDiff, diffStat } from "./diff.mjs";

// ----- terminal coloring (auto-off when not a TTY) ---------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const yellow = (s) => c("33", s);
const cyan = (s) => c("36", s);

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

function printDiffRows(rows) {
  for (const { sign, text } of rows) {
    if (sign === "+") out(green("+" + text));
    else if (sign === "-") out(red("-" + text));
    else out(dim(" " + text));
  }
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
  const s = status(root, history);
  const head = history.head ? history.head : "(none)";
  out(`On commit ${cyan(head)}  ${dim(`(${history.commits.length} total)`)}`);

  if (!s.added.length && !s.modified.length && !s.deleted.length) {
    out(green("Working tree clean — nothing to commit."));
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
  const fileCount = Object.keys(result.changes).length;
  out(
    `${green("✓")} committed ${cyan(result.id)}  ` +
      dim(`(${fileCount} file${fileCount === 1 ? "" : "s"})`),
  );
  out("  " + result.message);
}

function cmdLog(args) {
  const root = needRepo();
  const history = loadHistory(root);
  if (!history.commits.length) {
    out("No commits yet.");
    return;
  }
  const oneline = args.includes("--oneline");
  // newest first
  for (let i = history.commits.length - 1; i >= 0; i--) {
    const cmt = history.commits[i];
    const ordinal = dim(`@${i + 1}`);
    if (oneline) {
      out(`${cyan(cmt.id)} ${ordinal} ${cmt.message}`);
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
    out(`${bold(cyan("commit " + cmt.id))} ${ordinal}`);
    out(`  ${dim(shortTime(cmt.time))}  ` +
      green(`+${added}`) + " " + red(`-${removed}`) +
      dim(`  ${Object.keys(cmt.changes).length} file(s)`));
    out(`  ${cmt.message}`);
    if (i > 0) out("");
  }
}

function cmdShow(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const ref = args[0] || "HEAD";
  const idx = resolveRef(history, ref);
  if (idx < 0) die(`unknown commit: ${ref}`);
  const cmt = history.commits[idx];

  out(bold(cyan("commit " + cmt.id)) + dim(`  @${idx + 1}`));
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

function cmdDiff(args) {
  const root = needRepo();
  const history = loadHistory(root);
  // Compare working tree to a ref (default HEAD).
  const ref = args[0] || "HEAD";
  const idx = resolveRef(history, ref);
  if (idx < 0 && ref.toLowerCase() !== "head") die(`unknown commit: ${ref}`);

  const base = reconstructAt(history, idx);
  const work = scanWorkingTree(root);

  let any = false;
  const allFiles = new Set([...base.keys(), ...work.keys()]);
  for (const file of [...allFiles].sort()) {
    const before = base.get(file) ?? [];
    const after = work.get(file) ?? [];
    if (fromLines(before) === fromLines(after)) continue;
    any = true;
    const label = !base.has(file)
      ? green(`added: ${file}`)
      : !work.has(file)
        ? red(`deleted: ${file}`)
        : bold(`modified: ${file}`);
    const segs = diffLines(before, after);
    const st = diffStat(segs);
    out(label + dim(`  +${st.added} -${st.removed}`));
    printDiffRows(renderDiff(segs));
    out("");
  }
  if (!any) out(green("No changes against " + ref + "."));
}

function cmdLs(args) {
  const root = needRepo();
  const history = loadHistory(root);
  const ref = args[0] || "HEAD";
  const idx = resolveRef(history, ref);
  if (idx < 0 && history.commits.length) {
    if (ref.toLowerCase() !== "head") die(`unknown commit: ${ref}`);
  }
  const state = reconstructAt(history, idx);
  const files = [...state.keys()].sort();
  if (!files.length) {
    out(dim("(no tracked files at this commit)"));
    return;
  }
  for (const f of files) out(f);
}

function cmdRestore(args) {
  const root = needRepo();
  const history = loadHistory(root);
  if (!args.length) die("usage: track restore <commit> [file ...]");
  const ref = args[0];
  const idx = resolveRef(history, ref);
  if (idx < 0) die(`unknown commit: ${ref}`);
  const files = args.slice(1);

  const res = restore(root, history, idx, files);
  for (const f of res.written) out(green("restored ") + f);
  for (const f of res.removed) out(red("removed  ") + f);
  if (!res.written.length && !res.removed.length) out("Nothing to restore.");
}

async function cmdServe(args) {
  const root = needRepo();
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

${bold("Commands:")}
  init                     Start tracking the current directory
  status                   Show what changed since the last commit
  commit -m "message"      Save a snapshot of all changes
  log [--oneline]          List commits, newest first
  show [commit]            Show a commit's diff (default: HEAD)
  diff [commit]            Show working-tree changes vs a commit (default: HEAD)
  ls [commit]              List tracked files at a commit (default: HEAD)
  restore <commit> [file]  Bring file(s) back from a commit (no args = whole tree)
  serve [-p port]          Open a phone-friendly web viewer (default port 7878)
  help                     Show this message

${bold("Referring to commits:")}
  HEAD        the latest commit
  @3          the 3rd commit (see ordinals in \`track log\`)
  a1b2c3d4    a commit id, or any unique prefix of one

${dim("All history lives in .track/history.json — one JSON file of diffs.")}`);
}

// ----- dispatch --------------------------------------------------------------

export async function run(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "init":
      return cmdInit();
    case "status":
    case "st":
      return cmdStatus();
    case "commit":
    case "ci":
      return cmdCommit(args);
    case "log":
      return cmdLog(args);
    case "show":
      return cmdShow(args);
    case "diff":
      return cmdDiff(args);
    case "ls":
      return cmdLs(args);
    case "restore":
      return cmdRestore(args);
    case "serve":
      return await cmdServe(args);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return cmdHelp();
    default:
      die(`unknown command: ${cmd}\nrun \`track help\` for usage`);
  }
}
