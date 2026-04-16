// ---------------------------------------------------------------------------
// A lightweight static site generator.
//
// Pipeline:
//   1. Mirror src/ to .build/ (so relative imports in MDX "just work").
//   2. Compile every .mdx file in place to an ESM .mjs file via @mdx-js/mdx.
//   3. For each compiled page, dynamically import it, wrap in the Base layout,
//      and server-render to a static HTML string with react-dom/server.
//   4. Write the HTML to dist/ following the pages/ URL structure.
//   5. Copy src/styles/ and src/client/ verbatim into dist/.
//
// Output is 100% static HTML + CSS + vanilla browser JS. No client framework.
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '@mdx-js/mdx';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SRC = path.join(root, 'src');
const BUILD = path.join(root, '.build');
const DIST = path.join(root, 'dist');

// ---- helpers ---------------------------------------------------------------

async function rimraf(p) { await fs.rm(p, { recursive: true, force: true }); }

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const e of entries) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(src, dst);
    else await fs.copyFile(src, dst);
  }
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

// Rewrite a page's relative path from .build/pages/foo/bar.mjs → dist/foo/bar/index.html.
// The root page (pages/index.mjs) becomes dist/index.html.
function routeFor(relFromPages) {
  const noExt = relFromPages.replace(/\.mjs$/, '');
  if (noExt === 'index') return 'index.html';
  if (noExt.endsWith('/index')) return noExt + '.html';
  return path.join(noExt, 'index.html');
}

// ---- build steps -----------------------------------------------------------

async function prepareBuildDir() {
  await rimraf(BUILD);
  await rimraf(DIST);
  await copyDir(SRC, BUILD);
}

async function compileMdx() {
  const files = (await walk(BUILD)).filter(f => f.endsWith('.mdx'));
  for (const mdxFile of files) {
    const source = await fs.readFile(mdxFile, 'utf8');
    const compiled = await compile(source, {
      jsx: false,                 // emit JSX runtime calls
      jsxImportSource: 'react',
      outputFormat: 'program',
      format: 'mdx',
    });
    const out = mdxFile.replace(/\.mdx$/, '.mjs');
    await fs.writeFile(out, String(compiled));
    await fs.rm(mdxFile);
  }
}

async function renderPages() {
  const pagesDir = path.join(BUILD, 'pages');
  if (!await exists(pagesDir)) throw new Error('Missing src/pages/ directory.');

  const { default: Base } = await import(pathToFileURL(path.join(BUILD, 'layouts/Base.mjs')).href);

  const files = (await walk(pagesDir)).filter(f => f.endsWith('.mjs'));
  for (const mjsFile of files) {
    const rel = path.relative(pagesDir, mjsFile);
    const mod = await import(pathToFileURL(mjsFile).href);
    const Content = mod.default;
    const meta = {
      title: mod.title,
      description: mod.description,
      bodyClass: mod.bodyClass,
      pathname: '/' + routeFor(rel).replace(/index\.html$/, '').replace(/\\/g, '/'),
    };

    const element = React.createElement(
      Base,
      meta,
      React.createElement(Content, {}),
    );

    const html = '<!doctype html>\n' + renderToStaticMarkup(element);
    const outPath = path.join(DIST, routeFor(rel));
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, html);
    console.log('  rendered', path.relative(root, outPath));
  }
}

async function copyAssets() {
  for (const name of ['styles', 'client']) {
    const from = path.join(SRC, name);
    if (await exists(from)) await copyDir(from, path.join(DIST, name));
  }
}

// ---- main ------------------------------------------------------------------

export async function build() {
  const t0 = Date.now();
  console.log('> building site');
  await prepareBuildDir();
  await compileMdx();
  await copyAssets();
  await renderPages();
  console.log(`> done in ${Date.now() - t0}ms — output: ${path.relative(root, DIST)}/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch(err => { console.error(err); process.exit(1); });
}
