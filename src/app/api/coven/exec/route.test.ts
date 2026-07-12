// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /doctor:\s*\[[^\]]*"--non-interactive"/,
  "coven doctor must not be invoked with --non-interactive; the CLI rejects that flag",
);

assert.match(
  source,
  /daemon:\s*\["status"\]/,
  "coven daemon slash exec should still run the status subcommand",
);

assert.match(
  source,
  /isMissingExecutableError\(e\)[\s\S]*covenCliMissingError\(\)/,
  "missing Coven CLI spawn errors should return the stable install/setup payload",
);

console.log("coven exec route.test.ts: ok");
