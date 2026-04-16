# Accessibility Experience Lab

Interactive simulations that let people feel common accessibility barriers firsthand, with persona-tailored guidance for designers, developers, PMs, researchers, and content designers.

## Stack

- **Lightweight custom static site generator** — a ~100-line Node script (`scripts/build.mjs`).
- **MDX** for content pages, via `@mdx-js/mdx`.
- **React** on the server only — used by the SSG to render MDX to static HTML.
- **Vanilla HTML, CSS, and JavaScript** in the browser. No client framework is shipped.
- **Design tokens** use OKLCH for color and `rem` for type and spacing (`src/styles/tokens.css`).

## Prerequisites

- macOS (or any Unix) with **Node.js 20+**
- `npm` (ships with Node)

## Getting started

```bash
npm install
npm run dev        # builds + serves + watches → http://localhost:4321
```

Other scripts:

```bash
npm run build      # one-off production build → dist/
npm run serve      # serve the already-built dist/ directory
```

## Project layout

```
scripts/
  build.mjs        — the SSG (compiles MDX, SSRs React, writes dist/)
  dev.mjs          — build + serve + watch
  serve.mjs        — plain static file server
src/
  pages/           — .mdx files become .html routes
  layouts/         — Base.mjs wraps every page
  components/      — server-rendered components (htm + React, no JSX build)
  data/            — persona catalog, simulator list, debrief copy
  styles/          — tokens.css, base.css, components.css, motor.css
  client/          — vanilla browser JS (app.js, motor.js)
dist/              — generated output, served statically
```

## Adding a new simulator

1. Create `src/data/<yourtopic>-debrief.mjs` with persona-keyed guidance.
2. Add an entry to `src/data/simulators.mjs`.
3. Author `src/components/YourSimulator.mjs` (server DOM) and `src/client/yourtopic.js` (behavior).
4. Create `src/pages/simulators/yourtopic.mdx` that imports the component and the debrief.
