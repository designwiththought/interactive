#!/usr/bin/env node
// Entry point for the `track` command.
import { run } from "../src/cli.mjs";

run(process.argv.slice(2)).catch((err) => {
  process.stderr.write("\x1b[31merror:\x1b[0m " + (err?.message || err) + "\n");
  process.exit(1);
});
