// Line-based diff engine — no dependencies.
//
// A "diff" here is a compact, self-describing list of segments that transforms
// one array of lines into another:
//
//   ["=", count]        keep `count` unchanged lines
//   ["-", [..lines]]    remove these lines
//   ["+", [..lines]]    insert these lines
//
// Because deleted/added text is carried inside the segment, a diff can be
// rendered and reverse-applied without needing the original file — which is
// exactly what lets us store the whole history in one JSON file.

// Split a file's text into lines while preserving a trailing newline.
// "a\nb\n" -> ["a", "b", ""]  (the empty tail records the final newline)
// "a\nb"   -> ["a", "b"]
export function toLines(text) {
  if (text === "") return [];
  return text.split("\n");
}

// Inverse of toLines.
export function fromLines(lines) {
  return lines.join("\n");
}

// Guardrail: the LCS table is O(n*m) memory. For very large files we skip the
// nice diff and just replace the whole thing. Personal files rarely hit this.
const MAX_CELLS = 4_000_000;

// Compute a diff (array of segments) turning `a` lines into `b` lines.
export function diffLines(a, b) {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return [["+", b.slice()]];
  if (m === 0) return [["-", a.slice()]];

  if ((n + 1) * (m + 1) > MAX_CELLS) {
    // Too big for an LCS table: delete everything, add everything.
    return [["-", a.slice()], ["+", b.slice()]];
  }

  // dp[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  // Backtrack to build the edit sequence, grouping runs of the same kind.
  const segs = [];
  let i = 0;
  let j = 0;
  const push = (kind, line) => {
    const last = segs[segs.length - 1];
    if (last && last[0] === kind) {
      if (kind === "=") last[1] += 1;
      else last[1].push(line);
    } else {
      segs.push(kind === "=" ? ["=", 1] : [kind, [line]]);
    }
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("=", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("-", a[i]);
      i++;
    } else {
      push("+", b[j]);
      j++;
    }
  }
  while (i < n) push("-", a[i++]);
  while (j < m) push("+", b[j++]);

  return segs;
}

// Apply a diff to `a` lines, producing the new lines.
export function applyDiff(a, segs) {
  const out = [];
  let i = 0;
  for (const seg of segs) {
    const [kind, payload] = seg;
    if (kind === "=") {
      for (let k = 0; k < payload; k++) out.push(a[i++]);
    } else if (kind === "-") {
      i += payload.length; // skip over the removed lines
    } else if (kind === "+") {
      for (const line of payload) out.push(line);
    } else {
      throw new Error(`unknown diff segment: ${kind}`);
    }
  }
  return out;
}

// True if a diff actually changes anything.
export function diffHasChanges(segs) {
  return segs.some((s) => s[0] !== "=");
}

// Render a diff as a unified-ish, colorable patch. `context` collapses long
// runs of unchanged lines. Returns an array of { sign, text } rows.
export function renderDiff(segs, { context = 3 } = {}) {
  const rows = [];
  for (let s = 0; s < segs.length; s++) {
    const [kind, payload] = segs[s];
    if (kind === "=") {
      const count = payload;
      // We don't carry unchanged text, so show a marker instead of the lines.
      if (count <= context * 2 + 1) {
        rows.push({ sign: " ", text: `… ${count} unchanged line${count === 1 ? "" : "s"}` });
      } else {
        rows.push({ sign: " ", text: `… ${count} unchanged lines` });
      }
    } else if (kind === "-") {
      for (const line of payload) rows.push({ sign: "-", text: line });
    } else if (kind === "+") {
      for (const line of payload) rows.push({ sign: "+", text: line });
    }
  }
  return rows;
}

// Count added / removed lines in a diff.
export function diffStat(segs) {
  let added = 0;
  let removed = 0;
  for (const [kind, payload] of segs) {
    if (kind === "+") added += payload.length;
    else if (kind === "-") removed += payload.length;
  }
  return { added, removed };
}
