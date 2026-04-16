// Dev mode: build once, serve dist/, rebuild on source change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { createServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');
const PORT = Number(process.env.PORT) || 4321;

let rebuilding = false;
let pending = false;

async function rebuild() {
  if (rebuilding) { pending = true; return; }
  rebuilding = true;
  try { await build(); }
  catch (err) { console.error('[build error]', err.message); }
  rebuilding = false;
  if (pending) { pending = false; rebuild(); }
}

await rebuild();

createServer().listen(PORT, () => {
  console.log(`> dev server running at http://localhost:${PORT}`);
  console.log(`> watching ${path.relative(process.cwd(), SRC)} for changes`);
});

// Debounce fs events — editors often fire multiple times per save.
let timer = null;
fs.watch(SRC, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 80);
});
