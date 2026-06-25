#!/usr/bin/env node
// Entry point for the `track` command.
import { run } from "../src/cli.mjs";

run(process.argv.slice(2)).catch((err) => {
  // Safety net — run() normally handles its own errors. Respect TTY for color.
  const prefix = process.stderr.isTTY ? "\x1b[31merror:\x1b[0m " : "error: ";
  process.stderr.write(prefix + (err?.message || err) + "\n");
  process.exit(1);
});
