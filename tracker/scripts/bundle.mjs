// Build a single self-contained `dist/track.mjs` from the modules in `src/`.
//
// Why: so you can drop ONE file into any folder (or keep one copy in iCloud)
// and run `node track.mjs …` — no install, no global command, no assumptions
// about where the `tracker/` folder lives. This is the most portable way to run
// the tool inside iOS code editors.
//
// How: the source is clean ES modules that only import each other and a few
// `node:` core modules. We strip the cross-module import/export lines, hoist the
// `node:` imports once, concatenate everything in dependency order, and append a
// runner. No external bundler — just string transforms over our own code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "..", "src");
const distDir = path.join(here, "..", "dist");

// Dependency order: each file may use names declared in earlier ones.
const ORDER = ["diff.mjs", "merge.mjs", "repo.mjs", "server.mjs", "cli.mjs"];

const nodeImports = new Set();

function transform(file) {
  let text = fs.readFileSync(path.join(srcDir, file), "utf8");

  // 1. Lift `import x from "node:y";` out, collect for hoisting.
  text = text.replace(
    /^import\s+(\w+)\s+from\s+["']node:([\w/]+)["'];?[ \t]*\n/gm,
    (_m, name, mod) => {
      nodeImports.add(`import ${name} from "node:${mod}";`);
      return "";
    },
  );

  // 2. Drop cross-module static imports (single- or multi-line):
  //      import { a, b } from "./repo.mjs";
  text = text.replace(
    /^import\s+[\s\S]*?from\s+["']\.\/[\w./]+["'];?[ \t]*\n/gm,
    "",
  );

  // 3. Drop local re-exports:  export { fromLines } from "./diff.mjs";
  text = text.replace(
    /^export\s+\{[^}]*\}\s+from\s+["']\.\/[\w./]+["'];?[ \t]*\n/gm,
    "",
  );

  // 4. Drop bare named-export lists:  export { saveHistory };
  text = text.replace(/^export\s+\{[^}]*\};?[ \t]*\n/gm, "");

  // 5. Drop dynamic local imports:  const { serve } = await import("./server.mjs");
  //    (the imported names are already in scope after inlining)
  text = text.replace(/^.*await\s+import\(["']\.\/[\w./]+["']\).*\n/gm, "");

  // 6. Turn `export function/const/let/class` declarations into plain ones.
  text = text.replace(
    /^export\s+(async\s+function|function|const|let|class)\b/gm,
    "$1",
  );

  return text.trim();
}

const bodies = ORDER.map(transform);

const header = `#!/usr/bin/env node
// ============================================================================
// GENERATED FILE — do not edit by hand.
// Single-file build of \`track\`. Rebuild with \`npm run bundle\`.
// Source of truth: tracker/src/*.mjs
// Usage: node track.mjs <command>   (e.g. node track.mjs init)
// ============================================================================
`;

const runner = `
// ----- entry point -----------------------------------------------------------
run(process.argv.slice(2)).catch((err) => {
  const prefix = process.stderr.isTTY ? "\\x1b[31merror:\\x1b[0m " : "error: ";
  process.stderr.write(prefix + (err?.message || err) + "\\n");
  process.exit(1);
});
`;

const bundle =
  header +
  "\n" +
  [...nodeImports].sort().join("\n") +
  "\n\n" +
  bodies.join("\n\n") +
  "\n" +
  runner;

fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, "track.mjs");
fs.writeFileSync(outPath, bundle);

process.stdout.write(
  `Built ${path.relative(path.join(here, ".."), outPath)} ` +
    `(${(bundle.length / 1024).toFixed(1)} kB, ${bundle.split("\n").length} lines)\n`,
);
