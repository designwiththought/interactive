// A tiny, dependency-free web viewer for the history. Handy on a phone, where
// a browser beats a terminal. Read-only: it shows commits and their diffs.
import http from "node:http";
import { loadHistory, resolveRef, getCommit, decorations } from "./repo.mjs";
import { renderDiff, diffStat } from "./diff.mjs";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const PAGE = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0;
         background: Canvas; color: CanvasText; }
  header { position: sticky; top: 0; background: Canvas; padding: 1rem;
           border-bottom: 1px solid color-mix(in oklab, CanvasText 15%, transparent); }
  h1 { font-size: 1.1rem; margin: 0; }
  h1 a { color: inherit; text-decoration: none; }
  main { padding: 1rem; max-width: 900px; margin: 0 auto; }
  .commit { display: block; padding: .75rem 1rem; margin: .5rem 0; text-decoration: none;
            color: inherit; border: 1px solid color-mix(in oklab, CanvasText 15%, transparent);
            border-radius: 10px; }
  .commit:hover { background: color-mix(in oklab, CanvasText 6%, transparent); }
  .id { font-family: ui-monospace, monospace; color: #2a7; }
  .meta { font-size: .8rem; opacity: .6; }
  .msg { font-weight: 600; margin-top: .15rem; }
  .stat .add { color: #2a7; } .stat .del { color: #d54; }
  pre { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px;
        overflow-x: auto; padding: .5rem .75rem; border-radius: 8px;
        background: color-mix(in oklab, CanvasText 5%, transparent); }
  .file { font-weight: 600; margin: 1rem 0 .25rem; }
  .ln.add { color: #2a7; } .ln.del { color: #d54; } .ln.ctx { opacity: .5; }
  a.back { display: inline-block; margin-bottom: .5rem; }
  .empty { opacity: .6; }
  .tag { font-size: .7rem; padding: .05rem .4rem; border-radius: 999px;
         background: color-mix(in oklab, #2a7 25%, transparent);
         color: color-mix(in oklab, CanvasText 80%, #2a7); vertical-align: middle; }
</style></head>
<body>
<header><h1><a href="/">◇ track</a></h1></header>
<main>${body}</main>
</body></html>`;

function listPage(history) {
  if (!history.commits.length) {
    return PAGE("track", `<p class="empty">No commits yet. Make one with <code>track commit -m "…"</code>.</p>`);
  }
  const rows = [];
  for (let i = history.commits.length - 1; i >= 0; i--) {
    const cmt = history.commits[i];
    let add = 0;
    let del = 0;
    for (const ch of Object.values(cmt.changes)) {
      if (ch.diff) {
        const st = diffStat(ch.diff);
        add += st.added;
        del += st.removed;
      }
    }
    const n = Object.keys(cmt.changes).length;
    const labels = decorations(history, cmt.id)
      .map((l) => `<span class="tag">${esc(l)}</span>`)
      .join(" ");
    rows.push(`<a class="commit" href="/commit/${cmt.id}">
      <div><span class="id">${cmt.id}</span> ${labels} <span class="meta">@${i + 1} · ${esc(cmt.time.replace("T", " ").replace(/\..+/, ""))}</span></div>
      <div class="msg">${esc(cmt.message.split("\n")[0])}</div>
      <div class="stat meta"><span class="add">+${add}</span> <span class="del">-${del}</span> · ${n} file(s)</div>
    </a>`);
  }
  return PAGE("track — history", rows.join("\n"));
}

function commitPage(history, ref) {
  const id = resolveRef(history, ref);
  const cmt = getCommit(history, id);
  if (!cmt) return null;
  const ordinal = history.commits.indexOf(cmt) + 1;
  const blocks = [];
  for (const [file, change] of Object.entries(cmt.changes)) {
    if (change.op === "delete") {
      blocks.push(`<div class="file">🗑 ${esc(file)} <span class="meta">(deleted)</span></div>`);
      continue;
    }
    const verb = change.op === "add" ? "added" : "modified";
    const st = diffStat(change.diff);
    const lines = renderDiff(change.diff)
      .map(({ sign, text }) => {
        const cls = sign === "+" ? "add" : sign === "-" ? "del" : "ctx";
        return `<span class="ln ${cls}">${esc(sign + text)}</span>`;
      })
      .join("\n");
    blocks.push(
      `<div class="file">${esc(file)} <span class="meta">${verb} · +${st.added} -${st.removed}</span></div>
       <pre>${lines}</pre>`,
    );
  }
  const labels = decorations(history, cmt.id)
    .map((l) => `<span class="tag">${esc(l)}</span>`)
    .join(" ");
  const body = `<a class="back" href="/">← all commits</a>
    <div><span class="id">${cmt.id}</span> ${labels} <span class="meta">@${ordinal} · ${esc(cmt.time.replace("T", " ").replace(/\..+/, ""))}</span></div>
    <div class="msg" style="margin:.25rem 0 1rem">${esc(cmt.message)}</div>
    ${blocks.join("\n") || '<p class="empty">No file changes.</p>'}`;
  return PAGE("track — " + cmt.id, body);
}

export function serve(root, port = 7878) {
  const server = http.createServer((req, res) => {
    const history = loadHistory(root); // reload each request so it stays live
    const url = new URL(req.url, "http://localhost");
    let html;
    if (url.pathname === "/") {
      html = listPage(history);
    } else if (url.pathname.startsWith("/commit/")) {
      html = commitPage(history, decodeURIComponent(url.pathname.slice("/commit/".length)));
    }
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  server.listen(port, () => {
    process.stdout.write(
      `track viewer running → http://localhost:${port}\n` +
        `On your phone: open the Code app's preview, or visit the address above.\n` +
        `Press Ctrl+C to stop.\n`,
    );
  });
}
